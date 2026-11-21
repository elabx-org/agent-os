import AppKit
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WindowHost, StatusMenuHost, CommandTarget {
  let opts: AppOptions
  let poller = Poller()
  private var status: StatusMenu!
  private var main: MainWindowController?
  private var listener: CommandChannel.Listener?
  private var activity: NSObjectProtocol?
  private let work = DispatchQueue(label: "agentos.app.work")
  /// Read once at launch: `defaults write com.agentos.mac inspectable -bool true`
  private let inspectable = UserDefaults.standard.bool(forKey: "inspectable")

  init(_ opts: AppOptions) {
    self.opts = opts
    super.init()
  }

  // MARK: Launch

  func applicationWillFinishLaunching(_ notification: Notification) {
    // Stage 2 sets the notification delegate and categories here
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = MainMenu.build(target: self)
    activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiatedAllowingIdleSystemSleep], reason: "Watching sessions")
    status = StatusMenu(host: self)
    poller.observe { [weak self] snap in self?.polled(snap) }
    poller.start()
    let listener = CommandChannel.Listener(target: self)
    listener.start()
    self.listener = listener
    SMAppServiceCleanup.runOnce()

    let quiet = opts.atLogin || (opts.afterUpdate && !opts.restoreWindow)
    if !quiet {
      if opts.afterUpdate, let path = opts.restorePath, let clean = WindowMemory.sanitize(path: path) {
        window().pane.load(path: clean)
      }
      open(.home, activate: false)
    }
    if let id = opts.openSession, SessionLink.isValidId(id) { open(.session(id), activate: false) }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    open(.home, activate: true)
    return false
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationWillTerminate(_ notification: Notification) {
    if let main, main.isShown { WindowMemory.save(path: main.pane.currentPath) }
  }

  // MARK: Window

  private func window() -> MainWindowController {
    if let main { return main }
    let made = MainWindowController(
      port: Backend.portNumber, persistent: true, inspectable: inspectable, autosaveName: "AgentOSMain", host: self)
    made.pane.offlineKind = { [weak self] in self?.offlineKind() ?? .notAnswering }
    made.pane.onOverlayChange = { [weak self] kind in
      self?.poller.fast = kind != nil
      if kind != nil { self?.poller.refreshNow() }
    }
    made.pane.onTurnOn = { [weak self] in
      self?.turnOn(then: nil)
    }
    main = made
    return made
  }

  /// `activate: true` only from our menu items, the Dock and notification clicks
  func open(_ d: Destination, activate: Bool) {
    window().open(d, activate: activate)
  }

  var windowShowingSession: String? {
    guard let main, main.isShown else { return nil }
    return main.pane.showingSession
  }

  var isRegular: Bool { NSApp.activationPolicy() == .regular }

  func updatePolicy() {
    AppPolicy.apply(main?.window)
    NSApp.dockTile.badgeLabel = isRegular && poller.snapshot.waiting > 0 ? "\(poller.snapshot.waiting)" : nil
  }

  private func offlineKind() -> OfflineView.Kind {
    switch poller.snapshot.iconState() {
    case .notInstalled: return .notInstalled
    case .off: return .off
    case .updating: return .updating
    case .starting: return .starting
    default: return .notAnswering
    }
  }

  private func polled(_ snap: Snapshot) {
    status.update(snap)
    main?.pane.serverChanged(answering: snap.facts.answering)
    updatePolicy()
  }

  func refreshNow() { poller.refreshNow() }

  /// Today's turn-on action, off the main thread
  func turnOn(then: (() -> Void)?) {
    work.async { [weak self] in
      _ = Backend.machine("on")
      // The server takes a few seconds to answer
      for _ in 0..<20 where Backend.request("/api/build", timeout: 2) == nil { Thread.sleep(forTimeInterval: 1) }
      DispatchQueue.main.async {
        then?()
        self?.poller.refreshNow()
      }
    }
  }

  // MARK: Main menu actions

  @objc func showAbout(_ sender: Any?) {
    let credits = NSAttributedString(
      string: Strings.aboutCredits(AppInfo.short),
      attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.labelColor])
    NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
  }

  /// Stage 1: the window on its home page. Stage 2 opens the New session panel.
  @objc func newSession(_ sender: Any?) {
    window().pane.load(path: "/")
    open(.home, activate: true)
  }

  @objc func showMainWindow(_ sender: Any?) { open(.home, activate: true) }

  // MARK: Command channel

  func channelShow() { open(.home, activate: false) }

  func channelHide() { main?.hide() }

  func channelOpen(session id: String) { open(.session(id), activate: false) }

  func channelReload() { main?.pane.reload() }

  func channelQuit() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
  }

  func channelDumpState() -> [String: Any] {
    let snap = poller.snapshot
    let iso = ISO8601DateFormatter()
    let w = main?.window
    let frame = w?.frame ?? .zero
    let state = status.iconState
    let null = NSNull()
    return [
      "app": [
        "version": AppInfo.short, "commit": AppInfo.commit, "hash": AppInfo.sourceHash,
        "pid": Int(getpid()), "atLogin": opts.atLogin, "afterUpdate": opts.afterUpdate,
        "policy": AppPolicy.name(NSApp.activationPolicy()),
        "lastPollAt": snap.lastPollAt == .distantPast ? null : iso.string(from: snap.lastPollAt) as Any,
        "pollAgeSec": snap.lastPollAt == .distantPast
          ? null : (Date().timeIntervalSince(snap.lastPollAt) * 10).rounded() / 10 as Any,
      ] as [String: Any],
      "window": [
        "exists": main != nil, "visible": w?.isVisible ?? false, "key": w?.isKeyWindow ?? false,
        "frame": [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height].map { Double($0) },
        "path": main?.pane.currentPath ?? null as Any, "title": w?.title ?? null as Any,
        "overlay": main?.pane.overlay?.rawValue ?? "none",
        "showingSession": windowShowingSession ?? null as Any,
      ] as [String: Any],
      "icon": [
        "state": state.name, "count": state.count, "linkDown": status.linkDown, "tooltip": status.tooltip,
        "dockBadge": NSApp.dockTile.badgeLabel ?? null as Any,
      ] as [String: Any],
      "service": [
        "installed": snap.facts.installed, "answering": snap.facts.answering, "loaded": snap.facts.serviceLoaded,
        "updating": snap.facts.updating, "link": snap.facts.linkStatus ?? null as Any,
      ] as [String: Any],
      "sessions": snap.sessions.map { ["id": $0.id, "name": $0.name, "state": $0.state] },
      "notifications": null, "update": null, "login": null,
    ]
  }

  func channelCapture(_ name: String, done: @escaping ([String]) -> Void) {
    let controller = window()
    let wasShown = controller.isShown
    controller.open(.home, activate: false)
    var files: [String] = []
    let finish: @MainActor () -> Void = { [weak self] in
      guard let self else { return done(files) }
      for (variant, appearanceName, highlight) in [
        ("light", NSAppearance.Name.aqua, false), ("dark", .darkAqua, false), ("highlight", .aqua, true),
      ] {
        guard let appearance = NSAppearance(named: appearanceName) else { continue }
        let data = IconRenderer.png(
          for: self.status.iconState, linkDown: self.status.linkDown, appearance: appearance, highlight: highlight)
        if let url = TestFiles.write(name: "\(name)-icon-\(variant).png", data: data) { files.append(url.path) }
      }
      self.status.render()
      if let url = TestFiles.write(name: "\(name)-menu.txt", data: Data(self.status.dumpText().utf8)) {
        files.append(url.path)
      }
      if !wasShown { controller.hide() }
      done(files)
    }
    let webView = controller.pane.webView
    webView.callAsyncJavaScript(
      "await new Promise(r => requestAnimationFrame(() => r()))", arguments: [:], in: nil, in: .page
    ) { _ in
      webView.takeSnapshot(with: nil) { image, _ in
        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]),
          let url = TestFiles.write(name: "\(name)-window.png", data: png)
        {
          files.append(url.path)
        }
        finish()
      }
    }
  }
}

/// Earlier builds offered "Show this menu at login" through SMAppService.
/// Stage 3 moves that to the service's own flag file; this clears the old
/// registration once. Only the installed app does it, so a build run from a
/// build folder never changes the person's login items.
@MainActor
enum SMAppServiceCleanup {
  static func runOnce() {
    guard Bundle.main.bundlePath == "/Applications/AgentOS.app" else { return }
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: "smCleared") else { return }
    try? SMAppService.mainApp.unregister()
    defaults.set(true, forKey: "smCleared")
  }
}
