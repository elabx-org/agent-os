import AppKit
import WebKit

/// --self-test [names…]: the window's checks, in its own app with a
/// non-persistent store. It only reads: it never changes a setting, answers,
/// starts or stops anything.
enum SelfTest {
  static func run(_ only: [String]) -> Never {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    Task { @MainActor in
      let runner = SelfTestRunner(only: only)
      let code = await runner.runAll()
      exit(code)
    }
    app.run()
    exit(1)
  }
}

@MainActor
final class SelfTestRunner: WindowHost {
  enum Verdict {
    case pass(String?)
    case fail(String)
    case skip(String)
  }

  let only: Set<String>
  let port = Backend.portNumber
  var passed = 0
  var failed = 0
  var skipped = 0
  var controller: MainWindowController?
  var opened: [URL] = []
  var locked = false

  init(only: [String]) { self.only = Set(only) }

  func updatePolicy() { AppPolicy.apply(controller?.window) }

  private func report(_ name: String, _ v: Verdict) {
    switch v {
    case .pass(let note):
      passed += 1
      print("PASS \(name)" + (note.map { ": \($0)" } ?? ""))
    case .fail(let why):
      failed += 1
      print("FAIL \(name): \(why)")
    case .skip(let why):
      skipped += 1
      print("SKIP \(name): \(why)")
    }
    fflush(stdout)
  }

  private func check(_ name: String, _ body: () async -> Verdict) async {
    guard only.isEmpty || only.contains(name) else { return }
    report(name, await body())
  }

  // MARK: Helpers

  private func sleep(_ seconds: Double) async {
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
  }

  private func until(_ timeout: Double, _ condition: () -> Bool) async -> Bool {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if condition() { return true }
      await sleep(0.1)
    }
    return condition()
  }

  private var pane: WebPane? { controller?.pane }

  /// Runs fixed test code in the page; nil on error or after `timeout`
  private func js(_ body: String, timeout: Double = 5) async -> Any? {
    guard let webView = pane?.webView else { return nil }
    return await withCheckedContinuation { (cont: CheckedContinuation<Any?, Never>) in
      var done = false
      let finish: @MainActor (Any?) -> Void = { value in
        guard !done else { return }
        done = true
        cont.resume(returning: value)
      }
      webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
        MainActor.assumeIsolated {
          switch result {
          case .success(let value): finish(value)
          case .failure(let error): finish("error: \(error.localizedDescription)")
          }
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { finish(nil) }
    }
  }

  private func jsBool(_ body: String) async -> Bool { (await js(body) as? Bool) == true }

  private func loadAndWait(_ url: URL, timeout: Double = 20) async -> Bool {
    guard let pane else { return false }
    let before = pane.finishCount
    pane.load(url)
    return await until(timeout) { pane.finishCount > before }
  }

  private func firstSessionId() async -> String? {
    if let id = ProcessInfo.processInfo.environment["AGENTOS_SELFTEST_SESSION"], SessionLink.isValidId(id) {
      return id
    }
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/sessions"),
      let (data, _) = try? await URLSession.shared.data(from: url),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let list = json["sessions"] as? [[String: Any]]
    else { return nil }
    return list.compactMap { $0["id"] as? String }.first(where: SessionLink.isValidId)
  }

  private func makeController(autosave: String = "AgentOSSelfTest") -> MainWindowController {
    let made = MainWindowController(
      port: port, persistent: false, inspectable: false, autosaveName: autosave, host: self)
    made.pane.opener = { [weak self] url in self?.opened.append(url) }
    return made
  }

  private func placeWindow(_ window: NSWindow?) {
    guard let window, let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let area = screen.visibleFrame
    window.setFrame(NSRect(x: area.minX, y: area.minY, width: 1100, height: 700), display: true)
    window.orderFrontRegardless()
  }

  private static func screenLocked() -> Bool {
    if let info = CGSessionCopyCurrentDictionary() as? [String: Any],
      (info["CGSSessionScreenIsLocked"] as? Bool) == true || (info["CGSSessionScreenIsLocked"] as? Int) == 1
    {
      return true
    }
    return CGDisplayIsAsleep(CGMainDisplayID()) != 0
  }

  // MARK: The run

  func runAll() async -> Int32 {
    locked = Self.screenLocked()
    NSApp.mainMenu = MainMenu.build(target: nil)

    await check("pure") {
      let bad = (SelfChecks.linkPolicy(port: port) + SelfChecks.sessionLink(port: port)).filter { !$0.ok }
      return bad.isEmpty ? .pass(nil) : .fail(bad.map { "\($0.name) \($0.detail)" }.joined(separator: "; "))
    }

    await check("menu") {
      let items = MainMenu.allItems(NSApp.mainMenu ?? NSMenu())
      let want: [(String, String, NSEvent.ModifierFlags)] = [
        ("copy:", "c", .command), ("paste:", "v", .command), ("selectAll:", "a", .command),
        ("undo:", "z", .command), ("reload:", "r", .command), ("performClose:", "w", .command),
        ("toggleFullScreen:", "f", [.command, .control]),
      ]
      let missing = want.filter { sel, key, mods in
        !items.contains {
          $0.action.map(NSStringFromSelector) == sel && $0.keyEquivalent == key
            && $0.keyEquivalentModifierMask.intersection(.deviceIndependentFlagsMask) == mods
        }
      }
      return missing.isEmpty ? .pass(nil) : .fail("missing " + missing.map(\.0).joined(separator: ", "))
    }

    await check("icon") {
      var count = 0
      for state in IconState.samples {
        for (variant, name, highlight) in [
          ("light", NSAppearance.Name.aqua, false), ("dark", .darkAqua, false), ("highlight", .aqua, true),
        ] {
          guard let appearance = NSAppearance(named: name) else { continue }
          let data = IconRenderer.png(for: state, linkDown: false, appearance: appearance, highlight: highlight)
          if !data.isEmpty, TestFiles.write(name: "selftest-icon-\(state.name)-\(variant).png", data: data) != nil {
            count += 1
          }
        }
      }
      let want = IconState.samples.count * 3
      return count == want ? .pass("\(count) files") : .fail("wrote \(count) of \(want)")
    }

    let controller = makeController()
    self.controller = controller
    placeWindow(controller.window)

    await check("load") {
      guard await loadAndWait(SessionLink.home(port: port)) else { return .fail("no didFinish in 20 s") }
      let url = pane?.webView.url?.absoluteString ?? "nil"
      return url == "http://127.0.0.1:\(port)/" ? .pass(nil) : .fail("at \(url)")
    }

    await check("proof") {
      guard let store = pane?.webView.configuration.websiteDataStore.httpCookieStore else { return .fail("no store") }
      let cookies = await withCheckedContinuation { (c: CheckedContinuation<[HTTPCookie], Never>) in
        store.getAllCookies { c.resume(returning: $0) }
      }
      guard cookies.contains(where: { $0.name == "agentos_u" && $0.isHTTPOnly }) else {
        return .fail("agentos_u missing or not HttpOnly")
      }
      let status = await js("const r = await fetch('/api/build'); return r.status;") as? Int
      return status == 200 ? .pass("present") : .fail("/api/build from the page gave \(status.map(String.init) ?? "nothing")")
    }

    await check("no-bridge") {
      await jsBool(
        "return typeof window.agentosNative === 'undefined' && !(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.agentos);"
      ) ? .pass(nil) : .fail("a native bridge is visible to the page")
    }

    await check("desktop-layout") {
      let fine = await jsBool("return matchMedia('(pointer: fine)').matches;")
      let native = await jsBool("return !!document.querySelector('[data-native-layout]');")
      let nav = await jsBool("return !!document.querySelector('nav');")
      if !fine { return .fail("pointer is not fine") }
      if native { return .fail("the page has a native-layout marker") }
      return nav ? .pass(nil) : .fail("no nav element")
    }

    await check("visible") {
      if locked { return .skip("screen-locked") }
      let state = await js("return document.visibilityState;") as? String
      return state == "visible" ? .pass(nil) : .fail("visibilityState \(state ?? "nil")")
    }

    let sessionId = await firstSessionId()

    await check("open-in-place") {
      guard let id = sessionId else { return .skip("no sessions") }
      _ = await js("window.__agentosMarker = 1; return true;")
      pane?.open(.session(id))
      // The open script keeps focus out of the terminal for 1.5 s
      await sleep(2)
      let marker = await jsBool("return window.__agentosMarker === 1;")
      let path = await js("return location.pathname;") as? String
      let inTerm = await jsBool(
        "return !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.xterm'));")
      if !marker { return .fail("the page reloaded") }
      if path != "/" { return .fail("path \(path ?? "nil")") }
      return inTerm ? .fail("focus is in the terminal") : .pass(nil)
    }

    await check("open-by-url") {
      guard let id = sessionId else { return .skip("no sessions") }
      guard await loadAndWait(SessionLink.url(port: port, id: id)) else { return .fail("no didFinish") }
      await sleep(3)
      let search = await js("return location.search;") as? String ?? "nil"
      return search.contains("session=") ? .fail("search still \(search)") : .pass(nil)
    }

    await check("links") {
      opened.removeAll()
      await sleep(1.1)
      _ = await js("window.open('https://example.com/'); return true;")
      await sleep(1.2)
      _ = await js("location.href = 'https://example.com/'; return true;")
      await sleep(1.2)
      guard opened.count == 2 else { return .fail("expected 2 opens, got \(opened.count)") }
      let path = await js("return location.origin + location.pathname;") as? String
      guard path == "http://127.0.0.1:\(port)/" else { return .fail("page moved to \(path ?? "nil")") }
      _ = await js("location.href = '/proxy/1/'; return true;")
      await sleep(1.2)
      guard opened.count == 3, opened.last?.path.hasPrefix("/proxy/1") == true else {
        return .fail("the proxy link wasn't sent to the browser (\(opened.count) opens)")
      }
      _ = await js("window.open('vscode://x'); return true;")
      await sleep(1.2)
      guard opened.count == 3 else { return .fail("vscode: was opened") }
      _ = await js("location.href = 'data:text/html,hello'; return true;")
      await sleep(0.8)
      let still = pane?.webView.url?.absoluteString ?? "nil"
      guard still.hasPrefix("http://127.0.0.1:\(port)/"), opened.count == 3 else {
        return .fail("data: navigation went through (\(still))")
      }
      return .pass(nil)
    }

    await check("rate-limit") {
      await sleep(1.2)
      let before = opened.count
      _ = await js("for (let i = 0; i < 5; i++) window.open('https://example.com/' + i); return true;")
      await sleep(0.5)
      let n = opened.count - before
      return n == 1 ? .pass(nil) : .fail("\(n) opens")
    }

    await check("foreign-alert") {
      _ = await js(
        "const f = document.createElement('iframe'); f.id = '__agentosFrame'; f.srcdoc = '<p>x</p>'; document.body.appendChild(f); await new Promise(r => { f.onload = r; setTimeout(r, 2000); }); return true;"
      )
      let answer = await js("return document.getElementById('__agentosFrame').contentWindow.confirm('Delete?');", timeout: 3)
      let sheet = controller.window?.attachedSheet
      if let sheet { controller.window?.endSheet(sheet) }
      _ = await js("document.getElementById('__agentosFrame')?.remove(); return true;")
      if sheet != nil { return .fail("a sheet appeared") }
      return (answer as? Bool) == false ? .pass(nil) : .fail("confirm gave \(String(describing: answer))")
    }

    await check("copy") {
      let board = NSPasteboard.general
      let saved: [[NSPasteboard.PasteboardType: Data]] = (board.pasteboardItems ?? []).map { item in
        var out: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types { if let data = item.data(forType: type) { out[type] = data } }
        return out
      }
      defer {
        board.clearContents()
        let items = saved.map { entry -> NSPasteboardItem in
          let item = NSPasteboardItem()
          for (type, data) in entry { item.setData(data, forType: type) }
          return item
        }
        if !items.isEmpty { board.writeObjects(items) }
      }
      board.clearContents()
      _ = await js(
        "const t = document.createElement('textarea'); t.id = '__agentosCopy'; t.value = 'agentos-self-test'; document.body.appendChild(t); t.focus(); t.select(); return true;"
      )
      if let webView = pane?.webView {
        controller.window?.makeFirstResponder(webView)
        NSApp.sendAction(#selector(NSText.copy(_:)), to: webView, from: nil)
      }
      await sleep(0.5)
      let got = board.string(forType: .string)
      _ = await js("document.getElementById('__agentosCopy')?.remove(); return true;")
      return got == "agentos-self-test" ? .pass(nil) : .fail("pasteboard has \(got.map { "\"\($0)\"" } ?? "nothing")")
    }

    await check("policy") {
      controller.show(activate: false)
      let shown = NSApp.activationPolicy()
      controller.hide()
      let hidden = NSApp.activationPolicy()
      controller.window?.orderFrontRegardless()
      updatePolicy()
      return shown == .regular && hidden == .accessory
        ? .pass(nil) : .fail("shown \(AppPolicy.name(shown)), hidden \(AppPolicy.name(hidden))")
    }

    await check("hidden") {
      if locked { return .skip("screen-locked") }
      controller.hide()
      await sleep(1)
      let state = await js("return document.visibilityState;") as? String
      controller.window?.orderFrontRegardless()
      updatePolicy()
      return state == "hidden" ? .pass(nil) : .fail("visibilityState \(state ?? "nil")")
    }

    await check("frame") {
      guard let window = controller.window, let screen = window.screen ?? NSScreen.main else { return .fail("no window") }
      let area = screen.visibleFrame
      let want = NSRect(x: area.minX + 40, y: area.minY + 30, width: 900, height: 600)
      window.setFrame(want, display: true)
      window.saveFrame(usingName: "AgentOSSelfTest")
      window.setFrameAutosaveName("")
      controller.hide()
      let again = makeController()
      let got = again.window?.frame ?? .zero
      again.window?.setFrameAutosaveName("")
      again.close()
      window.setFrameAutosaveName("AgentOSSelfTest")
      return got.equalTo(want) ? .pass(nil) : .fail("got \(NSStringFromRect(got)), want \(NSStringFromRect(want))")
    }

    await check("offline") {
      let freePort = Self.unusedPort()
      let spare = WebPane(port: freePort, persistent: false, inspectable: false)
      spare.offlineKind = { .notAnswering }
      spare.frame = NSRect(x: 0, y: 0, width: 600, height: 400)
      spare.load(path: "/")
      let shown = await until(8) { spare.overlay == .notAnswering }
      let title = spare.offline.titleLabel.stringValue
      return shown && title == Strings.offlineNotAnswering.title
        ? .pass(nil) : .fail("overlay \(spare.overlay?.rawValue ?? "none"), title \"\(title)\"")
    }

    controller.window?.setFrameAutosaveName("")
    controller.hide()
    controller.close()
    print("selftest \(passed) passed, \(failed) failed, \(skipped) skipped")
    fflush(stdout)
    return failed > 0 ? 1 : 0
  }

  /// A loopback port nothing listens on
  static func unusedPort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return 1 }
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafeMutablePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) == 0 && getsockname(fd, $0, &len) == 0 }
    }
    return bound ? Int(UInt16(bigEndian: addr.sin_port)) : 1
  }
}
