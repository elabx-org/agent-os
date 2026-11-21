import AppKit
import ServiceManagement

@MainActor
protocol StatusMenuHost: AnyObject {
  func open(_ d: Destination, activate: Bool)
  func refreshNow()
  func turnOn(then: (() -> Void)?)
  var isRegular: Bool { get }
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

  func menuWillOpen(_ menu: NSMenu) { host?.refreshNow() }

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
      menu.addItem(label(snap.sessions.isEmpty ? Strings.noSessions : Strings.sessionsHere))
      for session in snap.sessions.prefix(12) {
        let row = action(Strings.sessionRow(session.name, session.state), #selector(openSession(_:)))
        row.representedObject = session.id
        let dot = ["waiting": "exclamationmark.circle.fill", "running": "circle.fill", "idle": "circle"][session.state] ?? "circle"
        row.image = NSImage(systemSymbolName: dot, accessibilityDescription: Strings.stateWord(session.state))
        menu.addItem(row)
      }
      if snap.sessions.count > 12 { menu.addItem(label(Strings.andMore(snap.sessions.count - 12))) }
      if !snap.sessions.isEmpty {
        let stop = NSMenuItem(title: Strings.stopASession, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        for session in snap.sessions {
          let row = action(session.name, #selector(stopSession(_:)))
          row.representedObject = session.id
          sub.addItem(row)
        }
        stop.submenu = sub
        menu.addItem(stop)
      }
    }
    menu.addItem(.separator())
    menu.addItem(action(Strings.openAgentOS, #selector(openApp), key: "o"))

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
    queue.async {
      job()
      DispatchQueue.main.async { [weak self] in
        self?.busy = nil
        self?.host?.refreshNow()
      }
    }
  }

  /// Runs a change only the user may make, and says so when it's refused
  private func change(_ text: String, _ job: @escaping @Sendable () -> String?) {
    busy = text
    render()
    queue.async {
      let problem = job()
      DispatchQueue.main.async { [weak self] in
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

  @objc private func openSession(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, SessionLink.isValidId(id) else {
      return openApp()
    }
    host?.open(.session(id), activate: true)
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

  @objc private func stopSession(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String,
      let session = snap.sessions.first(where: { $0.id == id })
    else { return }
    guard confirm(Strings.stopTitle(session.name), Strings.stopBody, button: Strings.stop) else { return }
    work(Strings.stopping(session.name)) { _ = Backend.stop(session) }
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
