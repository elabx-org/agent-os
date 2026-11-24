import AppKit
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WindowHost, StatusMenuHost, CommandTarget, NotifierHost,
  PanelHost, UpdaterHost, GlanceHost, NSMenuItemValidation
{
  let opts: AppOptions
  let poller = Poller()
  private var status: StatusMenu!
  private var main: MainWindowController?
  /// Chats opened in windows of their own (tabs of one another)
  private var chats: [MainWindowController] = []
  private var watch: WatchPanel?
  /// The Dock menu as last shown (its items carry an index into it)
  private var dockEntries: [Glance.DockEntry] = []
  private var quick: QuickAsk?
  private(set) var quickKey = QuickKey.stored(UserDefaults.standard.string(forKey: QuickKey.defaultsKey))
  private var listener: CommandChannel.Listener?
  private(set) var notifier: Notifier?
  private(set) var updater: AppUpdater?
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
    let updater = AppUpdater()
    updater.host = self
    // --apply-update: swap now, since no window shows at such a launch
    if opts.applyUpdate { updater.requested = true }
    self.updater = updater
    status = StatusMenu(host: self)
    poller.observe { [weak self] snap in self?.polled(snap) }
    poller.onEvents = { [weak self] entries, prompts in self?.notifier?.consider(entries, prompts: prompts) }
    poller.eventsSince = { [weak self] in self?.notifier?.cursor ?? 0 }
    poller.onDetails = { [weak self] in
      self?.status.detailsChanged()
      self?.watch?.update()
      self?.quick?.update()
    }
    poller.start()
    HotKey.onPress = { [weak self] in self?.toggleQuickAsk() }
    HotKey.set(quickKey)
    // The watch panel comes back as the person left it
    if UserDefaults.standard.bool(forKey: WatchPanel.defaultsKey) { setWatch(true, remember: false) }
    let listener = CommandChannel.Listener(target: self)
    listener.start()
    self.listener = listener
    SMAppServiceCleanup.runOnce()

    let quiet = opts.atLogin || opts.applyUpdate || (opts.afterUpdate && !opts.restoreWindow)
    // Opened by the person with an update waiting: it goes in first, and the
    // new copy shows the window
    if UpdateDecision.swapOnOpen(quiet: quiet, afterUpdate: opts.afterUpdate, hasLink: opts.openSession != nil),
      updater.swapOnOpen()
    {
      return
    }
    if !quiet {
      if opts.afterUpdate, let path = opts.restorePath, let clean = WindowMemory.sanitize(path: path) {
        window().pane.load(path: clean)
      }
      open(.home, activate: false)
    }
    if let id = opts.openSession, SessionLink.isValidId(id) { open(.session(id), activate: false) }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    // A click on our Dock icon brings the window in front. Any other
    // process's `open` of the running app arrives as the same reopen event:
    // that one only shows the window, and never in front of another app (D5).
    open(.home, activate: reopenIsFromDock())
    return false
  }

  /// The reopen Apple event was sent by the Dock
  private func reopenIsFromDock() -> Bool { eventSender() == "com.apple.dock" }

  /// The app that sent the Apple event being handled
  private func eventSender() -> String? {
    guard let event = NSAppleEventManager.shared().currentAppleEvent,
      let sender = event.attributeDescriptor(forKeyword: AEKeyword(keySenderPIDAttr))
    else { return nil }
    let pid = pid_t(sender.int32Value)
    guard pid > 0 else { return nil }
    return NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationWillTerminate(_ notification: Notification) {
    if let main, main.isShown { WindowMemory.save(path: main.pane.currentPath) }
  }

  // MARK: Window

  private func window() -> MainWindowController {
    if let main { return main }
    let made = makeWindow(autosaveName: "AgentOSMain", secondary: false)
    main = made
    return made
  }

  private var controllers: [MainWindowController] { [main].compactMap { $0 } + chats }

  private func makeWindow(autosaveName: String, secondary: Bool) -> MainWindowController {
    let made = MainWindowController(
      port: Backend.portNumber, persistent: true, inspectable: inspectable, autosaveName: autosaveName, host: self,
      secondary: secondary)
    made.pane.offlineKind = { [weak self] in self?.offlineKind() ?? .notAnswering }
    made.pane.onOverlayChange = { [weak self] kind in
      self?.poller.fast = kind != nil
      if kind != nil { self?.poller.refreshNow() }
    }
    made.pane.onTurnOn = { [weak self] in
      self?.turnOn(then: nil)
    }
    return made
  }

  /// File › Open Chat in New Window (⇧⌘N): the chat in front, or the home
  /// page, in a window of its own. More of them become its tabs.
  @objc func openChatWindow(_ sender: Any?) { newChatWindow(activate: true) }

  private func newChatWindow(activate: Bool) {
    let front = controllers.first { $0.window?.isKeyWindow == true } ?? main
    let made = makeWindow(autosaveName: "AgentOSChat", secondary: true)
    made.onClosed = { [weak self, weak made] in
      guard let self else { return }
      self.chats.removeAll { $0 === made }
      self.updatePolicy()
    }
    // A tab of the chat windows already open, also when none of them is in front
    if let first = chats.first?.window, let window = made.window, first.isVisible {
      first.addTabbedWindow(window, ordered: .above)
    }
    chats.append(made)
    if let id = front?.pane.state?.session {
      made.open(.session(id), activate: activate)
    } else {
      made.open(.home, activate: activate)
    }
  }

  /// The + of the tab bar
  @objc func newWindowForTab(_ sender: Any?) { openChatWindow(sender) }

  /// `activate: true` only from our menu items, the Dock and notification clicks
  func open(_ d: Destination, activate: Bool) {
    window().open(d, activate: activate)
    // The first time the person opens the window, macOS may ask about
    // notifications. Not for the channel, a second launch or a flag: those
    // never bring anything in front of another app.
    if activate { notifier?.refreshStatus { [weak self] in self?.notifier?.askIfUndetermined() } }
  }

  var snapshot: Snapshot { poller.snapshot }
  var details: [String: SessionDetails] { poller.details }
  var appIsActive: Bool { NSApp.isActive }

  var keyWindowSession: String? {
    controllers.first { $0.isShown && $0.window?.isKeyWindow == true }?.pane.showingSession
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
    poller.refreshDetailsForMenu(ids)
    status.render()
  }

  var windowShowingSession: String? {
    let shown = controllers.filter(\.isShown)
    return (shown.first { $0.window?.isKeyWindow == true } ?? shown.first)?.pane.showingSession
  }

  var isRegular: Bool { NSApp.activationPolicy() == .regular }

  func updatePolicy() {
    AppPolicy.apply(inUse: controllers.contains { $0.inUse })
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
    for controller in controllers { controller.pane.serverChanged(answering: snap.facts.answering) }
    updatePolicy()
    // The panels show what each waiting session asks: read it while they show
    if watching || quick?.isShown == true {
      poller.fetchDetails(snap.sessions.filter { $0.state == "waiting" }.map(\.id))
    }
    watch?.update()
    quick?.update()
    notifier?.reconcile(snap, details: poller.details)
    updater?.poll()
  }

  // MARK: Updater

  /// Shown, minimised or hidden with the app (⌘H): the same test as the
  /// Dock icon's, so a window the person will come back to is never lost
  /// to a swap, and a forced swap brings it back
  var windowVisible: Bool { controllers.contains { $0.inUse } }
  var menuIsOpen: Bool { status?.isOpen ?? false }
  var isBusy: Bool {
    // An open panel counts even while it has stepped aside for another app
    (status?.isBusy ?? false) || Panels.reply != nil || Panels.newSession != nil || quick?.isShown == true
      // An alert or open panel (runModal) or a sheet is up: the person's
      // answer to it would be lost to a swap
      || NSApp.modalWindow != nil || NSApp.windows.contains { $0.attachedSheet != nil }
  }
  var windowPath: String? { main?.pane.currentPath }
  func updaterChanged() { status?.render() }
  func swapOnOpenFailed() { open(.home, activate: false) }

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

  /// AgentOS › Settings… (⌘,): the page's own settings
  @objc func showSettings(_ sender: Any?) {
    open(.home, activate: true)
    window().actWhenReady(.settings)
  }

  @objc func showQuickAskPanel(_ sender: Any?) { showQuickAsk() }

  @objc func toggleWatchPanel(_ sender: Any?) { toggleWatch() }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(toggleWatchPanel(_:)) { item.state = watching ? .on : .off }
    return true
  }

  // MARK: Watch panel and quick ask

  var glanceSessions: [MenuSession] { status.sessions() }
  var watching: Bool { watch?.isShown ?? false }
  var quickKeyFailed: Bool { HotKey.failed }

  func setQuickKey(_ key: QuickKey) {
    quickKey = key
    UserDefaults.standard.set(key.rawValue, forKey: QuickKey.defaultsKey)
    HotKey.set(key)
  }

  private func quickPanel() -> QuickAsk {
    if let quick { return quick }
    let made = QuickAsk(host: self)
    quick = made
    return made
  }

  func showQuickAsk() {
    quickPanel().show()
    poller.refreshNow()
  }

  /// The shortcut: opens quick ask, or puts it away when it is up
  private func toggleQuickAsk() {
    if quick?.isShown == true { quick?.hide() } else { showQuickAsk() }
  }

  func toggleWatch() { setWatch(!watching) }

  private func setWatch(_ on: Bool, remember: Bool = true) {
    if remember { UserDefaults.standard.set(on, forKey: WatchPanel.defaultsKey) }
    guard on else {
      watch?.hide()
      return
    }
    let panel: WatchPanel
    if let watch {
      panel = watch
    } else {
      panel = WatchPanel(host: self)
      panel.onClose = { UserDefaults.standard.set(false, forKey: WatchPanel.defaultsKey) }
      watch = panel
    }
    panel.show()
    poller.refreshNow()
  }

  /// Answer in the watch panel or quick ask: the menu bar's own answers
  /// for that session, read fresh, under the button
  func answer(session id: String, under view: NSView) {
    guard SessionLink.isValidId(id) else { return }
    poller.refreshDetailsForMenu([id])
    status.popUpAnswers(for: id, under: view)
  }

  // MARK: Dock

  /// The Dock icon's menu: it opens a session, a new chat or a page, and
  /// never answers anything
  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    let menu = NSMenu()
    menu.autoenablesItems = false
    let entries = Glance.dock(
      sessions: status.sessions(), recent: poller.snapshot.recentProjects, watching: watching)
    for (i, entry) in entries.enumerated() {
      if entry.isSeparator {
        menu.addItem(.separator())
        continue
      }
      let row = NSMenuItem(title: entry.title, action: #selector(dockItem(_:)), keyEquivalent: "")
      row.target = self
      row.tag = i
      row.state = entry.checked ? .on : .off
      menu.addItem(row)
    }
    dockEntries = entries
    return menu
  }

  @objc private func dockItem(_ sender: NSMenuItem) {
    guard dockEntries.indices.contains(sender.tag), let action = dockEntries[sender.tag].action else { return }
    switch action {
    case .open(let id):
      if SessionLink.isValidId(id) { open(.session(id), activate: true) }
    case .newIn(let projectId):
      Panels.showNewSession(host: self, projectId: projectId)
    case .newSession:
      Panels.showNewSession(host: self)
    case .all:
      open(.home, activate: true)
      window().actWhenReady(.all)
    case .watch:
      toggleWatch()
    }
  }

  /// Files or folders dropped on the Dock icon (or opened with AgentOS):
  /// the New Session panel, on the project that holds them, with them named
  /// in the task. Nothing starts until the person presses Start.
  func application(_ application: NSApplication, open urls: [URL]) {
    let paths = urls.filter(\.isFileURL).map(\.path)
    let home = NSHomeDirectory()
    let text = Drops.task(paths, home: home)
    guard !text.isEmpty else { return }
    let project = Drops.shown(paths, home: home).isEmpty
      ? nil : paths.first.flatMap { Drops.project(for: $0, in: poller.snapshot.projects, home: home) }
    // In front only for the person's own drop (the Dock or the Finder)
    let own = ["com.apple.dock", "com.apple.finder"].contains(eventSender() ?? "")
    Panels.showNewSession(host: self, projectId: project?.id, text: text, activate: own)
  }

  // MARK: Command channel

  func channelShow() { open(.home, activate: false) }

  func channelHide() { main?.hide() }

  func channelOpen(session id: String) { open(.session(id), activate: false) }

  func channelReload() { main?.pane.reload() }

  func channelToolbar(_ action: PageAction) { main?.pane.act(action) }

  /// Shown without the keyboard and without coming in front of the app in
  /// use; what the person chose for the watch panel is not changed
  func channelPanel(_ name: String, show: Bool) -> Bool {
    switch name {
    case "watch":
      setWatch(show, remember: false)
    case "quick":
      if show { quickPanel().show(key: false) } else { quick?.hide() }
      poller.refreshNow()
    case "chat":
      if show {
        newChatWindow(activate: false)
      } else {
        for chat in chats { chat.window?.close() }
      }
    default:
      return false
    }
    return true
  }

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
        "subtitle": w?.subtitle ?? null as Any,
        "toolbar": main?.toolbarDump ?? null as Any,
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
      "update": updateState(),
      "watch": watch?.dump ?? ["shown": false],
      // What Answer would show for each session that needs the person
      "answers": Dictionary(
        uniqueKeysWithValues: snap.sessions.filter { $0.state == "waiting" }.map {
          ($0.id, MenuModel.text(status.answerEntries($0.id)))
        }),
      "quick": quick?.dump ?? ["shown": false],
      "quickKey": ["choice": quickKey.rawValue, "failed": HotKey.failed],
      "dock": Glance.dock(sessions: status.sessions(), recent: snap.recentProjects, watching: watching)
        .map { $0.isSeparator ? "---" : $0.title },
      "chatWindows": chats.count,
      "chatTabs": chats.first?.window?.tabbedWindows?.count ?? 0,
      "login": ["wanted": StartAtLogin.wanted, "atLogin": opts.atLogin],
    ]
  }

  private func updateState() -> [String: Any] {
    let null = NSNull()
    guard let u = updater else { return [:] }
    var out: [String: Any] = [
      "ready": u.readyHash ?? null as Any, "staged": u.stagedExists, "decision": u.decision.rawValue,
      "failedSwap": u.failedSwap, "buildFailed": u.buildFailed, "requested": u.requested,
      "target": u.target ?? null as Any, "lastSwap": null, "from": null, "to": null, "ok": null,
    ]
    if let last = u.lastSwap {
      out["lastSwap"] = last.at
      out["from"] = last.from
      out["to"] = last.to
      out["ok"] = last.ok
    }
    return out
  }

  /// The channel's apply-update: asks for the swap only while no window shows
  func channelApplyUpdate() -> [String: Any] {
    guard let u = updater else { return ["error": "not ready"] }
    if !windowVisible { u.requested = true }
    u.poll()
    return ["ok": true, "requested": u.requested, "decision": u.decision.rawValue]
  }

  /// The session part as data, then the whole status menu as drawn
  func channelDumpMenu() -> String {
    status.render()
    return status.modelText() + "--- menu ---\n" + status.dumpText()
  }

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
      for (panel, tag) in [(self.watch?.panel as NSWindow?, "watch"), (self.quick?.panel as NSWindow?, "quick")] {
        // The panel's own drawing (its glass comes out flat)
        guard let panel, panel.isVisible, let frame = panel.contentView?.superview,
          let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds)
        else { continue }
        frame.cacheDisplay(in: frame.bounds, to: rep)
        if let png = rep.representation(using: .png, properties: [:]),
          let url = TestFiles.write(name: "\(name)-\(tag).png", data: png)
        {
          files.append(url.path)
        }
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
        // The window's own parts (title bar, toolbar): the page's area is
        // drawn by another process and stays empty here
        if let frame = controller.window?.contentView?.superview,
          let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds)
        {
          frame.cacheDisplay(in: frame.bounds, to: rep)
          if let png = rep.representation(using: .png, properties: [:]),
            let url = TestFiles.write(name: "\(name)-frame.png", data: png)
          {
            files.append(url.path)
          }
        }
        finish()
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { finish() }
  }
}

/// Earlier builds offered "Show this menu at login" through SMAppService.
/// Stage 3 moves that to the service's own flag file; this clears the old
/// registration once, and keeps the person's choice: a registered item
/// becomes the flag file. Only the installed app does it, so a build run
/// from a build folder never changes the person's login items.
@MainActor
enum SMAppServiceCleanup {
  static func runOnce() {
    guard Bundle.main.bundlePath == "/Applications/AgentOS.app" else { return }
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: "smCleared") else { return }
    if SMAppService.mainApp.status == .enabled, FileManager.default.fileExists(atPath: Backend.agentHome.path) {
      StartAtLogin.set(true)
    }
    try? SMAppService.mainApp.unregister()
    defaults.set(true, forKey: "smCleared")
  }
}
