import AppKit
import ServiceManagement

@MainActor
protocol StatusMenuHost: AnyObject {
  func open(_ d: Destination, activate: Bool)
  func refreshNow()
  func turnOn(then: (() -> Void)?)
  var isRegular: Bool { get }
  func openPanel(_ kind: PanelKind)
  /// The menu opened: ask for notifications once, read session details
  func menuOpened()
  var notifier: Notifier? { get }
  var details: [String: SessionDetails] { get }
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
    render()
  }

  func menuWillOpen(_ menu: NSMenu) {
    host?.refreshNow()
    host?.menuOpened()
  }

  /// Details arrived while the menu may be open
  func detailsChanged() {
    render()
    menu.update()
  }

  /// The session part of the menu as data (also for dump-menu and plan)
  func model() -> [MenuEntry] {
    let details = host?.details ?? [:]
    let sessions = snap.sessions.map { row in
      MenuSession(
        id: row.id, name: row.name, state: row.state, lastLine: row.lastLine, prompt: details[row.id]?.prompt,
        context: details[row.id]?.context)
    }
    return MenuModel.build(MenuSnapshot(on: snap.on, sessions: sessions, features: snap.features))
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

    menu.removeAllItems()
    let state = busy ?? (snap.on ? Strings.isOn : snap.installed ? Strings.isOff : Strings.notInstalled)
    menu.addItem(label(state, bold: true))
    var facts: [String] = []
    if let hub = snap.hub { facts.append(Strings.linkedTo(hub)) } else if snap.installed { facts.append(Strings.notLinked) }
    if let version = snap.version { facts.append(Strings.version(version)) }
    if !facts.isEmpty { menu.addItem(label(facts.joined(separator: " · "))) }
    if snap.hubURL != nil { menu.addItem(action(Strings.openServer, #selector(openServer))) }

    if snap.on {
      menu.addItem(.separator())
      for entry in model() { menu.addItem(item(for: entry, topLevel: true)) }
    }
    menu.addItem(.separator())
    menu.addItem(action(Strings.openAgentOS, #selector(openApp), key: "o"))
    menu.addItem(item(for: notificationsEntry(), topLevel: true))

    if snap.installed {
      menu.addItem(.separator())
      let toggle = action(snap.on ? Strings.turnOff : Strings.turnOn, #selector(togglePower))
      toggle.isEnabled = busy == nil
      menu.addItem(toggle)
      if snap.on { menu.addItem(label(Strings.offNote)) }
    }

    if snap.on {
      menu.addItem(.separator())
      if let agents = snap.agents {
        let allow = action(Strings.letServerSessions, #selector(toggleAgents(_:)))
        allow.state = agents ? .on : .off
        allow.isEnabled = busy == nil
        menu.addItem(allow)
      }
      let folder = snap.reposDir ?? "~/AgentOS"
      let repos = NSMenuItem(title: Strings.reposFolder(folder), action: nil, keyEquivalent: "")
      let sub = NSMenu()
      sub.autoenablesItems = false
      sub.addItem(action(Strings.showInFinder, #selector(showRepos)))
      sub.addItem(action(Strings.chooseFolder, #selector(chooseRepos(_:))))
      if folder != "~/AgentOS" { sub.addItem(action(Strings.useDefaultFolder, #selector(defaultRepos(_:)))) }
      repos.submenu = sub
      menu.addItem(repos)
    }

    menu.addItem(.separator())
    let login = action(Strings.showAtLogin, #selector(toggleLogin))
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(login)
    if snap.installed {
      let remove = action(Strings.uninstall, #selector(uninstall))
      remove.isEnabled = busy == nil
      menu.addItem(remove)
    }
    menu.addItem(action(Strings.quit, #selector(quit), key: "q"))
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
      guard confirm(Strings.endTitle(session.name), Strings.stopBody, button: Strings.endButton) else { return }
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

  @objc private func toggleLogin() {
    do {
      if SMAppService.mainApp.status == .enabled {
        try SMAppService.mainApp.unregister()
      } else {
        try SMAppService.mainApp.register()
      }
    } catch {
      NSApp.activate(ignoringOtherApps: true)
      let alert = NSAlert()
      alert.messageText = Strings.loginFailedTitle
      alert.informativeText = Strings.loginFailedBody(error.localizedDescription)
      alert.runModal()
    }
    render()
  }

  @objc private func uninstall() {
    let list = Strings.uninstallList.map { "• \($0)" }.joined(separator: "\n")
    guard confirm(Strings.uninstallTitle, Strings.uninstallBody(list), button: Strings.uninstallButton) else { return }
    try? SMAppService.mainApp.unregister()
    busy = Strings.uninstalling
    render()
    queue.async {
      Backend.uninstall()
      DispatchQueue.main.async {
        let bundle = Bundle.main.bundleURL
        if bundle.pathExtension == "app" { try? FileManager.default.trashItem(at: bundle, resultingItemURL: nil) }
        let alert = NSAlert()
        alert.messageText = Strings.removedTitle
        alert.informativeText = Strings.removedBody
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
      }
    }
  }

  @objc private func quit() { NSApp.terminate(nil) }
}
