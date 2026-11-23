import AppKit

@MainActor
protocol StatusMenuHost: AnyObject {
  func open(_ d: Destination, activate: Bool)
  func refreshNow()
  func turnOn(then: (() -> Void)?)
  var isRegular: Bool { get }
  func openPanel(_ kind: PanelKind)
  func showQuickAsk()
  func toggleWatch()
  var watching: Bool { get }
  var quickKey: QuickKey { get }
  /// The shortcut couldn't be taken (another app has it)
  var quickKeyFailed: Bool { get }
  func setQuickKey(_ key: QuickKey)
  /// The menu opened: ask for notifications once, read session details
  func menuOpened()
  var notifier: Notifier? { get }
  var details: [String: SessionDetails] { get }
  var updater: AppUpdater? { get }
}

/// A menu item's action, carried in representedObject
final class ActionBox: NSObject {
  let action: MenuAction
  init(_ action: MenuAction) { self.action = action }
}

/// AgentOS in the menu bar: shows that it runs on this Mac and what its
/// sessions are doing, opens the window, turns it on and off, and removes it.
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
  /// The status menu. Clicks.fromMenu accepts only items under it.
  static let menu = NSMenu()

  /// A waiting session's answers, the same entries as under its row here,
  /// shown under a button of the watch panel or quick ask. Its items run
  /// through runItem, and Clicks.fromMenu checks the click the same way.
  static let answers = NSMenu()
  private var answersFor: String?

  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private var menu: NSMenu { Self.menu }
  private(set) var snap = Snapshot()
  private var busy: String?
  /// Sessions with a request on its way: their items are disabled
  private var busyIds: Set<String> = []
  private let queue = DispatchQueue(label: "agentos.menu.work")
  private weak var host: StatusMenuHost?
  private var drawn: (IconState, Bool)?
  private var appearanceWatch: NSKeyValueObservation?

  private let uninstaller = UninstallFlow()
  /// The menu is open (the updater waits)
  private(set) var isOpen = false
  /// Something the person started is still running
  var isBusy: Bool { busy != nil || !busyIds.isEmpty || uninstaller.running }

  private(set) var iconState: IconState = .starting
  private(set) var linkDown = false
  private(set) var tooltip = ""

  init(host: StatusMenuHost) {
    self.host = host
    super.init()
    menu.delegate = self
    menu.autoenablesItems = false
    item.menu = menu
    appearanceWatch = item.button?.observe(\.effectiveAppearance) { button, _ in
      MainActor.assumeIsolated { button.needsDisplay = true }
    }
    uninstaller.setBusy = { [weak self] text in
      self?.busy = text
      self?.render()
    }
    render()
  }

  func menuWillOpen(_ menu: NSMenu) {
    isOpen = true
    host?.refreshNow()
    host?.menuOpened()
  }

  func menuDidClose(_ menu: NSMenu) {
    isOpen = false
  }

  /// Details arrived while the menu may be open
  func detailsChanged() {
    render()
    menu.update()
  }

  /// The sessions with what was last read of their prompts
  func sessions() -> [MenuSession] {
    let details = host?.details ?? [:]
    return snap.sessions.map { row in
      MenuSession(
        id: row.id, name: row.name, state: row.state, lastLine: row.lastLine, prompt: details[row.id]?.prompt,
        context: details[row.id]?.context)
    }
  }

  /// The session part of the menu as data (also for dump-menu and plan)
  func model() -> [MenuEntry] {
    MenuModel.build(MenuSnapshot(on: snap.on, sessions: sessions(), features: snap.features))
  }

  /// What a session's row holds in the menu, as entries
  func answerEntries(_ id: String) -> [MenuEntry] {
    guard snap.on, let session = sessions().first(where: { $0.id == id }) else { return [] }
    return MenuModel.children(session, features: snap.features)
  }

  private func syncAnswers() {
    guard let id = answersFor else { return }
    MenuSync.sync(Self.answers, answerEntries(id).map { item(for: $0, topLevel: false) })
    Self.answers.update()
  }

  /// Shows a session's answers under `view` (a button in one of our
  /// panels) and waits for the choice. They stay in step with the menu
  /// bar's while they show.
  func popUpAnswers(for id: String, under view: NSView) {
    guard SessionLink.isValidId(id), view.window != nil else { return }
    Self.answers.autoenablesItems = false
    answersFor = id
    syncAnswers()
    defer { answersFor = nil }
    guard !Self.answers.items.isEmpty else {
      host?.open(.session(id), activate: true)
      return
    }
    let below = NSPoint(x: 0, y: view.isFlipped ? view.bounds.height + 4 : -4)
    Self.answers.popUp(positioning: nil, at: below, in: view)
  }

  func notificationsEntry() -> MenuEntry {
    MenuModel.notifications(
      authorization: host?.notifier?.authorization ?? "notDetermined",
      toggles: host?.notifier?.toggles ?? NotifyRules.Toggles())
  }

  /// dump-menu: the model as text
  func modelText() -> String { MenuModel.text(model() + [notificationsEntry()]) }

  func update(_ next: Snapshot) {
    snap = next
    render()
  }

  // MARK: Drawing

  func render() {
    iconState = snap.iconState()
    linkDown = IconState.linkDown(snap.facts.linkStatus)
    tooltip = Strings.tooltip(iconState, snap.facts.linkStatus)
    if let button = item.button {
      let showLinkDown: Bool
      switch iconState {
      case .idle, .working: showLinkDown = linkDown
      default: showLinkDown = false
      }
      if drawn.map({ $0.0 != iconState || $0.1 != showLinkDown }) ?? true {
        button.image = IconRenderer.image(for: iconState, linkDown: showLinkDown)
        drawn = (iconState, showLinkDown)
      }
      let needs = snap.waiting
      button.imagePosition = .imageLeading
      button.title = needs > 0 ? " \(needs)" : ""
      button.toolTip = tooltip
      button.setAccessibilityLabel(tooltip)
    }

    // Built aside and then synced into the menu: items that stay keep their
    // NSMenuItem, so a refresh while the menu is open never closes the
    // submenu under the pointer or drops the item being clicked
    var rows: [NSMenuItem] = []
    let state = busy ?? (snap.on ? Strings.isOn : snap.installed ? Strings.isOff : Strings.notInstalled)
    rows.append(label(state, bold: true))
    var facts: [String] = []
    if let hub = snap.hub { facts.append(Strings.linkedTo(hub)) } else if snap.installed { facts.append(Strings.notLinked) }
    if let version = snap.version { facts.append(Strings.version(version)) }
    let updater = host?.updater
    if updater?.decision == .offer { facts.append(Strings.updateReady) }
    if !facts.isEmpty { rows.append(label(facts.joined(separator: " · "))) }
    if updater?.decision == .offer { rows.append(action(Strings.restartToUpdate, #selector(restartToUpdate))) }
    if updater?.failedSwap == true { rows.append(label(Strings.updateFailed)) }
    if updater?.buildFailed == true { rows.append(label(Strings.buildFailed)) }
    if snap.hubURL != nil { rows.append(action(Strings.openServer, #selector(openServer))) }

    if snap.on {
      rows.append(.separator())
      for entry in model() { rows.append(item(for: entry, topLevel: true)) }
    }
    rows.append(.separator())
    rows.append(action(Strings.openAgentOS, #selector(openApp), key: "o"))
    if snap.on {
      rows.append(action(Strings.quickAskMenu, #selector(quickAsk)))
      let watch = action(Strings.watchPanelMenu, #selector(toggleWatch))
      watch.state = host?.watching == true ? .on : .off
      rows.append(watch)
    }
    rows.append(item(for: notificationsEntry(), topLevel: true))
    let keys = NSMenuItem(title: Strings.quickKeyMenu, action: nil, keyEquivalent: "")
    let keyMenu = NSMenu()
    keyMenu.autoenablesItems = false
    let chosen = host?.quickKey ?? .optionSpace
    for key in QuickKey.allCases {
      let row = action(key.title, #selector(pickQuickKey(_:)))
      row.representedObject = key.rawValue
      row.state = key == chosen ? .on : .off
      keyMenu.addItem(row)
    }
    if host?.quickKeyFailed == true {
      keyMenu.addItem(.separator())
      keyMenu.addItem(label(Strings.quickKeyTaken))
    }
    keys.submenu = keyMenu
    rows.append(keys)

    if snap.installed {
      rows.append(.separator())
      let toggle = action(snap.on ? Strings.turnOff : Strings.turnOn, #selector(togglePower))
      toggle.isEnabled = busy == nil
      rows.append(toggle)
      if snap.on { rows.append(label(Strings.offNote)) }
    }

    if snap.on {
      rows.append(.separator())
      if let agents = snap.agents {
        let allow = action(Strings.letServerSessions, #selector(toggleAgents(_:)))
        allow.state = agents ? .on : .off
        allow.isEnabled = busy == nil
        rows.append(allow)
      }
      let folder = snap.reposDir ?? "~/AgentOS"
      let repos = NSMenuItem(title: Strings.reposFolder(folder), action: nil, keyEquivalent: "")
      let sub = NSMenu()
      sub.autoenablesItems = false
      sub.addItem(action(Strings.showInFinder, #selector(showRepos)))
      sub.addItem(action(Strings.chooseFolder, #selector(chooseRepos(_:))))
      if folder != "~/AgentOS" { sub.addItem(action(Strings.useDefaultFolder, #selector(defaultRepos(_:)))) }
      repos.submenu = sub
      rows.append(repos)
    }

    rows.append(.separator())
    if FileManager.default.fileExists(atPath: Backend.agentHome.path) {
      let login = action(Strings.startAtLogin, #selector(toggleLogin))
      login.state = StartAtLogin.wanted ? .on : .off
      rows.append(login)
    }
    if snap.installed {
      let remove = action(Strings.uninstall, #selector(uninstall))
      remove.isEnabled = busy == nil
      rows.append(remove)
    }
    rows.append(action(Strings.quit, #selector(quit), key: "q"))
    MenuSync.sync(menu, rows)
    syncAnswers()
  }

  /// One line per item: indent, title, [on]/[off], enabled/disabled
  func dumpText() -> String {
    func lines(_ menu: NSMenu, _ depth: Int) -> [String] {
      menu.items.flatMap { row -> [String] in
        let pad = String(repeating: "  ", count: depth)
        if row.isSeparatorItem { return [pad + "---"] }
        let line = "\(pad)\(row.title) [\(row.state == .on ? "on" : "off")] \(row.isEnabled ? "enabled" : "disabled")"
        return [line] + (row.submenu.map { lines($0, depth + 1) } ?? [])
      }
    }
    return lines(menu, 0).joined(separator: "\n") + "\n"
  }

  /// An NSMenuItem for a model entry, with its submenu
  private func item(for e: MenuEntry, topLevel: Bool) -> NSMenuItem {
    if e.style == .separator { return .separator() }
    let row = NSMenuItem(title: e.title, action: nil, keyEquivalent: "")
    switch e.style {
    case .bold:
      row.attributedTitle = NSAttributedString(
        string: e.title,
        attributes: [.font: NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold), .foregroundColor: NSColor.labelColor])
    case .secondary:
      row.attributedTitle = NSAttributedString(
        string: e.title,
        attributes: [.font: NSFont.menuFont(ofSize: 0), .foregroundColor: NSColor.secondaryLabelColor])
    case .mono:
      row.attributedTitle = NSAttributedString(
        string: e.title,
        attributes: [
          .font: NSFont.monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular),
          .foregroundColor: NSColor.labelColor,
        ])
    default:
      break
    }
    row.toolTip = e.tooltip
    row.state = e.checked ? .on : .off
    if !e.children.isEmpty {
      let sub = NSMenu()
      sub.autoenablesItems = false
      for child in e.children { sub.addItem(item(for: child, topLevel: false)) }
      row.submenu = sub
      row.isEnabled = true
    } else if let a = e.action {
      row.action = #selector(runItem(_:))
      row.target = self
      row.representedObject = ActionBox(a)
      let isBusy = a.sessionId.map(busyIds.contains) ?? false
      row.isEnabled = e.enabled && !isBusy && (busy == nil || Requests.request(for: a) == nil)
      if let key = e.keyEquivalent {
        row.keyEquivalent = key
        row.keyEquivalentModifierMask = [.command]
      }
    } else {
      row.isEnabled = false
    }
    // A session row: its state as a dot
    if topLevel, case .open(let id)? = e.action, let session = snap.sessions.first(where: { $0.id == id }) {
      // Kept by session, not by title (the title carries the state word)
      row.identifier = NSUserInterfaceItemIdentifier("row:" + id)
      let dot = ["waiting": "exclamationmark.circle.fill", "running": "circle.fill", "idle": "circle"][session.state] ?? "circle"
      row.image = NSImage(systemSymbolName: dot, accessibilityDescription: Strings.stateWord(session.state))
    }
    return row
  }

  private func label(_ text: String, bold: Bool = false) -> NSMenuItem {
    let row = NSMenuItem(title: text, action: nil, keyEquivalent: "")
    row.isEnabled = false
    if bold {
      row.attributedTitle = NSAttributedString(
        string: text,
        attributes: [.font: NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold), .foregroundColor: NSColor.labelColor])
    }
    return row
  }

  private func action(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
    let row = NSMenuItem(title: title, action: selector, keyEquivalent: key)
    row.target = self
    return row
  }

  private func confirm(_ title: String, _ text: String, button: String, destructive: Bool = true) -> Bool {
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = text
    alert.alertStyle = destructive ? .warning : .informational
    alert.addButton(withTitle: button).hasDestructiveAction = destructive
    alert.addButton(withTitle: Strings.cancel)
    return alert.runModal() == .alertFirstButtonReturn
  }

  private func work(_ text: String, _ job: @escaping @Sendable () -> Void) {
    busy = text
    render()
    queue.async { [weak self] in
      job()
      DispatchQueue.main.async {
        self?.busy = nil
        self?.host?.refreshNow()
      }
    }
  }

  /// Runs a change only the user may make, and says so when it's refused
  private func change(_ text: String, _ job: @escaping @Sendable () -> String?) {
    busy = text
    render()
    queue.async { [weak self] in
      let problem = job()
      DispatchQueue.main.async {
        self?.busy = nil
        self?.host?.refreshNow()
        guard let problem else { return }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = Strings.didntChange
        alert.informativeText = problem
        alert.runModal()
      }
    }
  }

  // MARK: Actions

  @objc private func openApp() { host?.open(.home, activate: true) }

  @objc private func quickAsk() { host?.showQuickAsk() }

  @objc private func toggleWatch() {
    host?.toggleWatch()
    render()
  }

  @objc private func pickQuickKey(_ sender: NSMenuItem) {
    guard let raw = sender.representedObject as? String, let key = QuickKey(rawValue: raw) else { return }
    host?.setQuickKey(key)
    render()
  }

  @objc private func openServer() {
    if let url = snap.hubURL { NSWorkspace.shared.open(url) }
  }

  @objc private func toggleAgents(_ sender: NSMenuItem) {
    guard let click = Clicks.fromMenu(sender), let now = snap.agents else { return }
    if !now {
      guard confirm(
        Strings.allowTitle, Strings.allowBody(snap.hub ?? Strings.yourServer), button: Strings.allow,
        destructive: false)
      else { return }
    }
    change(now ? Strings.turningThatOff : Strings.allowing) {
      let problem = Backend.setAgents(!now, click: click)
      // The server answers over the link a moment later
      if problem == nil { Thread.sleep(forTimeInterval: 1) }
      return problem
    }
  }

  private var reposURL: URL {
    let folder = snap.reposDir ?? "~/AgentOS"
    return URL(fileURLWithPath: (folder as NSString).expandingTildeInPath, isDirectory: true)
  }

  @objc private func showRepos() {
    let url = reposURL
    if FileManager.default.fileExists(atPath: url.path) {
      NSWorkspace.shared.open(url)
    } else {
      NSApp.activate(ignoringOtherApps: true)
      let alert = NSAlert()
      alert.messageText = Strings.folderMissingTitle
      alert.informativeText = Strings.folderMissingBody(snap.reposDir ?? "~/AgentOS")
      alert.runModal()
    }
  }

  @objc private func chooseRepos(_ sender: NSMenuItem) {
    guard let click = Clicks.fromMenu(sender) else { return }
    NSApp.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    panel.directoryURL = FileManager.default.fileExists(atPath: reposURL.path) ? reposURL : Backend.home
    panel.message = Strings.chooseFolderMessage
    panel.prompt = Strings.useThisFolder
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let folder = Backend.tilde(url)
    change(Strings.changingFolder) { Backend.setReposDir(folder, click: click) }
  }

  @objc private func defaultRepos(_ sender: NSMenuItem) {
    guard let click = Clicks.fromMenu(sender) else { return }
    change(Strings.changingFolder) { Backend.setReposDir(nil, click: click) }
  }

  // MARK: Session actions

  @objc private func runItem(_ sender: NSMenuItem) {
    guard let box = sender.representedObject as? ActionBox else { return }
    let a = box.action
    switch a {
    case .open(let id):
      guard SessionLink.isValidId(id) else { return openApp() }
      host?.open(.session(id), activate: true)
    case .openHome:
      openApp()
    case .openPanel(let kind):
      host?.openPanel(kind)
    case .notifyToggle(let key):
      guard let notifier = host?.notifier else { return }
      switch key {
      case "needsYou": notifier.toggles.needsYou.toggle()
      case "finished": notifier.toggles.finished.toggle()
      case "limited": notifier.toggles.limited.toggle()
      default: return
      }
      render()
    case .notifyAsk:
      host?.notifier?.requestAuthorization()
    case .notifySettings:
      if let url = URL(string: Strings.notificationSettingsURL) { NSWorkspace.shared.open(url) }
    case .stop(let id):
      guard let session = snap.sessions.first(where: { $0.id == id }), let request = Requests.request(for: a) else {
        return
      }
      let name = TextSafety.oneLine(TextSafety.clean(session.name), max: 60)
      guard confirm(Strings.endTitle(name), Strings.stopBody, button: Strings.endButton) else { return }
      run(a, request, click: nil, busyText: Strings.stoppingBusy)
    default:
      guard let request = Requests.request(for: a) else { return }
      var click: Click?
      if request.needsProof {
        // Only a fresh real click on this item may answer as the user
        guard let made = Clicks.fromMenu(sender) else { return }
        click = made
      }
      let text: String
      switch a {
      case .answerPrompt, .answerAsk: text = Strings.answering
      case .interrupt: text = Strings.stoppingBusy
      case .newSession: text = Strings.startingSession
      default: text = Strings.sending
      }
      run(a, request, click: click, busyText: text)
    }
  }

  private func run(_ a: MenuAction, _ request: PlannedRequest, click: Click?, busyText: String) {
    let id = a.sessionId ?? ""
    busy = busyText
    busyIds.insert(id)
    render()
    queue.async { [weak self] in
      let outcome = Backend.perform(request, click: click)
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self else { return }
          Notifier.log(a.name, id, outcome.name)
          self.busy = nil
          self.busyIds.remove(id)
          self.host?.refreshNow()
          self.render()
          self.tell(outcome, sessionId: id)
        }
      }
    }
  }

  /// What the person is told after a menu answer that didn't go through
  private func tell(_ outcome: Outcome, sessionId: String) {
    let alert = NSAlert()
    var showButton: String?
    switch outcome {
    case .ok:
      return
    case .changed:
      alert.messageText = Strings.changedTitle
      alert.informativeText = Strings.changedBody
      showButton = Strings.showMe
    case .refused:
      alert.messageText = Strings.refusedTitle
      alert.informativeText = Strings.refusedBody
      showButton = Strings.openWindow
    case .guarded:
      alert.messageText = Strings.guardedTitle
      alert.informativeText = Strings.guardedBody
    case .offline:
      alert.messageText = Strings.noAnswer
    case .error(let text):
      alert.messageText = text
    }
    if let showButton { alert.addButton(withTitle: showButton) }
    alert.addButton(withTitle: Strings.ok)
    NSApp.activate(ignoringOtherApps: true)
    let answer = alert.runModal()
    if showButton != nil, answer == .alertFirstButtonReturn, SessionLink.isValidId(sessionId) {
      host?.open(.session(sessionId), activate: true)
    }
  }

  @objc private func togglePower() {
    if snap.on {
      guard confirm(Strings.turnOffTitle, Strings.turnOffBody, button: Strings.turnOffButton) else { return }
      work(Strings.turningOff) { _ = Backend.machine("off") }
    } else {
      busy = Strings.turningOn
      render()
      host?.turnOn { [weak self] in
        self?.busy = nil
        self?.host?.refreshNow()
      }
    }
  }

  /// Start at login (D7): the service opens the app once per boot while
  /// ~/.agent-os/app-at-login exists
  @objc private func toggleLogin() {
    StartAtLogin.set(!StartAtLogin.wanted)
    render()
  }

  @objc private func restartToUpdate() { host?.updater?.restartNow() }

  @objc private func uninstall() { uninstaller.start() }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// The flag file the service reads at login (scripts/agentos-machine.sh run)
enum StartAtLogin {
  static var file: URL { Backend.agentHome.appendingPathComponent("app-at-login") }
  /// The person chose (scripts/link-machine.sh then leaves the flag alone)
  static var chosen: URL { Backend.agentHome.appendingPathComponent("app-at-login-set") }
  static var wanted: Bool { FileManager.default.fileExists(atPath: file.path) }

  static func set(_ on: Bool) {
    if !FileManager.default.fileExists(atPath: chosen.path) {
      FileManager.default.createFile(atPath: chosen.path, contents: Data())
    }
    if on {
      FileManager.default.createFile(atPath: file.path, contents: Data())
    } else {
      try? FileManager.default.removeItem(at: file)
    }
  }
}

/// Brings a menu's items in line with freshly built ones without removing
/// what stays: an item with the same key (its identifier, else its title)
/// at the same place, and the same kind (separator, submenu), is updated in
/// place and its submenu synced the same way; anything else is replaced.
@MainActor
enum MenuSync {
  static func key(_ item: NSMenuItem) -> String {
    if item.isSeparatorItem { return "---" }
    return item.identifier?.rawValue ?? ("t:" + item.title)
  }

  static func sync(_ menu: NSMenu, _ fresh: [NSMenuItem]) {
    for (i, new) in fresh.enumerated() {
      guard i < menu.items.count else {
        menu.addItem(new)
        continue
      }
      let old = menu.items[i]
      if old === new { continue }
      if key(old) == key(new) && (old.submenu == nil) == (new.submenu == nil) {
        copy(new, into: old)
        if let oldSub = old.submenu, let newSub = new.submenu {
          let kids = newSub.items
          newSub.removeAllItems()
          sync(oldSub, kids)
        }
      } else {
        menu.removeItem(at: i)
        menu.insertItem(new, at: i)
      }
    }
    while menu.items.count > fresh.count { menu.removeItem(at: menu.items.count - 1) }
  }

  private static func copy(_ new: NSMenuItem, into old: NSMenuItem) {
    if old.isSeparatorItem { return }
    old.title = new.title
    old.attributedTitle = new.attributedTitle
    old.action = new.action
    old.target = new.target
    old.representedObject = new.representedObject
    old.isEnabled = new.isEnabled
    old.state = new.state
    old.keyEquivalent = new.keyEquivalent
    old.keyEquivalentModifierMask = new.keyEquivalentModifierMask
    old.image = new.image
    old.toolTip = new.toolTip
  }
}
