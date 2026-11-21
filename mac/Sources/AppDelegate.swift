import AppKit
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WindowHost, StatusMenuHost, CommandTarget, NotifierHost,
  PanelHost
{
  let opts: AppOptions
  let poller = Poller()
  private var status: StatusMenu!
  private var main: MainWindowController?
  private var listener: CommandChannel.Listener?
  private(set) var notifier: Notifier?
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
    // The delegate and categories are set before launch ends, so a click on
    // a notification that launched the app still arrives
    let n = Notifier(poster: SystemPoster())
    n.host = self
    n.setUp()
    notifier = n
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = MainMenu.build(target: self)
    activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiatedAllowingIdleSystemSleep], reason: "Watching sessions")
    status = StatusMenu(host: self)
    poller.observe { [weak self] snap in self?.polled(snap) }
    poller.onEvents = { [weak self] entries, prompts in self?.notifier?.consider(entries, prompts: prompts) }
    poller.eventsSince = { [weak self] in self?.notifier?.cursor ?? 0 }
    poller.onDetails = { [weak self] in self?.status.detailsChanged() }
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
    // The first time the window shows, macOS may ask about notifications
    notifier?.refreshStatus { [weak self] in self?.notifier?.askIfUndetermined() }
  }

  var snapshot: Snapshot { poller.snapshot }
  var details: [String: SessionDetails] { poller.details }
  var appIsActive: Bool { NSApp.isActive }

  var keyWindowSession: String? {
    guard let main, main.window?.isKeyWindow == true else { return nil }
    return windowShowingSession
  }

  func openPanel(_ kind: PanelKind) {
    switch kind {
    case .newSession: Panels.showNewSession(host: self)
    default: Panels.showReply(kind, host: self)
    }
  }

  func menuOpened() {
    notifier?.refreshStatus { [weak self] in
      self?.notifier?.askIfUndetermined()
      self?.status.render()
    }
    let ids = poller.snapshot.sessions.filter { $0.state == "waiting" || $0.state == "running" }.map(\.id)
    poller.fetchDetails(ids)
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
    notifier?.reconcile(snap, details: poller.details)
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

  /// File › New Session… (⌘N): the New session panel
  @objc func newSession(_ sender: Any?) { Panels.showNewSession(host: self) }

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
      "notifications": [
        "authorization": notifier?.authorization ?? null as Any,
        "posted": Notifier.posted.sorted { $0.key < $1.key }.map {
          ["id": $0.key, "category": $0.value.category, "fingerprint": $0.value.fingerprint == nil ? null : "present"]
            as [String: Any]
        },
        "lastActions": Notifier.lastActions.map {
          ["action": $0.action, "sessionId": $0.sessionId, "outcome": $0.outcome, "at": iso.string(from: $0.at)]
        },
      ] as [String: Any],
      "update": null, "login": null,
    ]
  }

  func channelDumpMenu() -> String { status.modelText() }

  /// What the item at `path` under a session's row would send; never sends
  func channelPlan(session id: String, path: String) -> [String: Any] {
    guard let row = status.model().first(where: { $0.action == .open(id: id) }) else { return ["error": "no session"] }
    guard let entry = MenuModel.entry(row.children, path: path) else { return ["error": "no item"] }
    guard let action = entry.action else { return ["error": "no action"] }
    guard let r = Requests.request(for: action) else { return ["title": entry.title, "request": NSNull(), "action": action.tag] }
    var out: [String: Any] = [
      "title": entry.title, "enabled": entry.enabled, "method": r.method, "path": r.path, "proof": r.needsProof,
    ]
    if let body = r.body { out["body"] = body }
    return out
  }

  func channelNotifyStatus(_ done: @escaping ([String: Any]) -> Void) {
    guard let notifier else { return done(["error": "not ready"]) }
    notifier.status { s in DispatchQueue.main.async { done(s) } }
  }

  func channelDelivered(_ done: @escaping ([String: Any]) -> Void) {
    guard let notifier else { return done(["error": "not ready"]) }
    notifier.delivered { list in DispatchQueue.main.async { done(["delivered": list]) } }
  }

  func channelNotifyTest(_ done: @escaping ([String: Any]) -> Void) {
    guard let notifier else { return done(["error": "not ready"]) }
    notifier.postTest { ok in done(ok ? ["posted": true] : ["error": "not allowed"]) }
  }

  func channelCapture(_ name: String, done: @escaping ([String]) -> Void) {
    let controller = window()
    let wasShown = controller.isShown
    controller.open(.home, activate: false)
    var files: [String] = []
    var finished = false
    let finish: @MainActor () -> Void = { [weak self] in
      // Once: a page that never answers must not hold the channel (and so
      // every menu Click) forever; after 8 s the reply goes without it
      guard !finished else { return }
      finished = true
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
      // A hidden or locked screen draws no frames: wait for one at most 0.5 s
      "await new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 500); })", arguments: [:],
      in: nil, in: .page
    ) { _ in
      webView.takeSnapshot(with: nil) { image, _ in
        guard !finished else { return }
        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]),
          let url = TestFiles.write(name: "\(name)-window.png", data: png)
        {
          files.append(url.path)
        }
        finish()
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { finish() }
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
