import AppKit
import ServiceManagement

/// AgentOS in the menu bar: shows that it runs on this Mac and what its
/// sessions are doing, turns it on and off, and removes it.
final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let menu = NSMenu()
  private var snap = Snapshot()
  private var busy: String?
  private let queue = DispatchQueue(label: "agentos.menu.refresh")
  private var timer: Timer?

  func applicationDidFinishLaunching(_ notification: Notification) {
    menu.delegate = self
    menu.autoenablesItems = false
    item.menu = menu
    render()
    refresh()
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
  }

  func menuWillOpen(_ menu: NSMenu) { refresh() }

  private func refresh() {
    queue.async { [weak self] in
      let next = Backend.snapshot()
      DispatchQueue.main.async {
        self?.snap = next
        self?.render()
      }
    }
  }

  // MARK: Drawing

  private func render() {
    let needs = snap.sessions.filter { $0.state == "waiting" }.count
    let working = snap.sessions.contains { $0.state == "running" }
    if let button = item.button {
      let symbol = !snap.on ? "moon.zzz" : needs > 0 ? "exclamationmark.bubble.fill" : working ? "bolt.fill" : "bolt"
      let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "AgentOS")
      image?.isTemplate = true
      button.image = image
      button.title = needs > 0 ? " \(needs)" : ""
      button.toolTip = !snap.on
        ? "AgentOS is off"
        : needs > 0 ? "AgentOS: \(needs) need you" : working ? "AgentOS: working" : "AgentOS is on"
    }

    menu.removeAllItems()
    let state = busy ?? (snap.on ? "AgentOS is on" : snap.installed ? "AgentOS is off" : "AgentOS isn't installed on this Mac")
    menu.addItem(label(state, bold: true))
    var facts: [String] = []
    if let hub = snap.hub { facts.append("Linked to \(hub)") } else if snap.installed { facts.append("Not linked to a server") }
    if let version = snap.version { facts.append("Version \(version)") }
    if !facts.isEmpty { menu.addItem(label(facts.joined(separator: " · "))) }

    if snap.on {
      menu.addItem(.separator())
      menu.addItem(label(snap.sessions.isEmpty ? "No sessions running on this Mac" : "Sessions on this Mac"))
      for session in snap.sessions.prefix(12) {
        let word = ["waiting": "Needs you", "running": "Working", "idle": "Idle"][session.state] ?? session.state
        let row = action("\(session.name)  —  \(word)", #selector(openSession(_:)))
        row.representedObject = session.id
        let dot = ["waiting": "exclamationmark.circle.fill", "running": "circle.fill", "idle": "circle"][session.state] ?? "circle"
        row.image = NSImage(systemSymbolName: dot, accessibilityDescription: word)
        menu.addItem(row)
      }
      if snap.sessions.count > 12 { menu.addItem(label("and \(snap.sessions.count - 12) more")) }
      if !snap.sessions.isEmpty {
        let stop = NSMenuItem(title: "Stop a session…", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for session in snap.sessions {
          let row = action(session.name, #selector(stopSession(_:)))
          row.representedObject = session.id
          sub.addItem(row)
        }
        stop.submenu = sub
        menu.addItem(stop)
      }
      menu.addItem(.separator())
      menu.addItem(action("Open AgentOS", #selector(openApp), key: "o"))
    }

    if snap.installed {
      menu.addItem(.separator())
      let toggle = action(snap.on ? "Turn AgentOS off" : "Turn AgentOS on", #selector(togglePower))
      toggle.isEnabled = busy == nil
      menu.addItem(toggle)
      if snap.on { menu.addItem(label("Off: nothing can reach this Mac. Running sessions keep running.")) }
    }

    if snap.on {
      menu.addItem(.separator())
      if let agents = snap.agents {
        let allow = action("Let server sessions use this Mac", #selector(toggleAgents))
        allow.state = agents ? .on : .off
        allow.isEnabled = busy == nil
        menu.addItem(allow)
      }
      let folder = snap.reposDir ?? "~/AgentOS"
      let repos = NSMenuItem(title: "Repositories folder: \(folder)", action: nil, keyEquivalent: "")
      let sub = NSMenu()
      sub.addItem(action("Show in Finder", #selector(showRepos)))
      sub.addItem(action("Choose another folder…", #selector(chooseRepos)))
      if folder != "~/AgentOS" { sub.addItem(action("Use ~/AgentOS again", #selector(defaultRepos))) }
      repos.submenu = sub
      menu.addItem(repos)
    }

    menu.addItem(.separator())
    let login = action("Show this menu at login", #selector(toggleLogin))
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(login)
    if snap.installed {
      let remove = action("Uninstall AgentOS…", #selector(uninstall))
      remove.isEnabled = busy == nil
      menu.addItem(remove)
    }
    menu.addItem(action("Quit this menu", #selector(quit), key: "q"))
  }

  private func label(_ text: String, bold: Bool = false) -> NSMenuItem {
    let row = NSMenuItem(title: text, action: nil, keyEquivalent: "")
    row.isEnabled = false
    if bold {
      row.attributedTitle = NSAttributedString(
        string: text,
        attributes: [.font: NSFont.menuBarFont(ofSize: 0).withWeight(.semibold), .foregroundColor: NSColor.labelColor])
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
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }

  private func work(_ text: String, _ job: @escaping () -> Void) {
    busy = text
    render()
    queue.async { [weak self] in
      job()
      DispatchQueue.main.async {
        self?.busy = nil
        self?.refresh()
      }
    }
  }

  // MARK: Actions

  @objc private func openApp() {
    if let url = URL(string: "http://localhost:\(Backend.port)/") { NSWorkspace.shared.open(url) }
  }

  @objc private func openSession(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String,
      let query = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
      let url = URL(string: "http://localhost:\(Backend.port)/?session=\(query)")
    else { return openApp() }
    NSWorkspace.shared.open(url)
  }

  /// Runs a change only the user may make, and says so when it's refused
  private func change(_ text: String, _ job: @escaping () -> String?) {
    busy = text
    render()
    queue.async { [weak self] in
      let problem = job()
      DispatchQueue.main.async {
        self?.busy = nil
        self?.refresh()
        guard let problem else { return }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "That didn’t change"
        alert.informativeText = problem
        alert.runModal()
      }
    }
  }

  @objc private func toggleAgents() {
    guard let now = snap.agents else { return }
    if !now {
      guard confirm(
        "Let server sessions use this Mac?",
        "Sessions running on \(snap.hub ?? "your server") will be able to start sessions on this Mac and give them work, without asking you each time. You can turn this off here or in AgentOS (Settings, Machines).",
        button: "Allow", destructive: false)
      else { return }
    }
    change(now ? "Turning that off…" : "Allowing…") {
      let problem = Backend.setAgents(!now)
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
      alert.messageText = "That folder isn’t there yet"
      alert.informativeText = "AgentOS makes \(snap.reposDir ?? "~/AgentOS") the first time it puts a repository on this Mac."
      alert.runModal()
    }
  }

  @objc private func chooseRepos() {
    NSApp.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    panel.directoryURL = FileManager.default.fileExists(atPath: reposURL.path) ? reposURL : Backend.home
    panel.message = "Where AgentOS finds your repositories on this Mac, and puts the ones it clones."
    panel.prompt = "Use This Folder"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let folder = Backend.tilde(url)
    change("Changing the folder…") { Backend.setReposDir(folder) }
  }

  @objc private func defaultRepos() {
    change("Changing the folder…") { Backend.setReposDir(nil) }
  }

  @objc private func stopSession(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String,
      let session = snap.sessions.first(where: { $0.id == id })
    else { return }
    guard confirm(
      "Stop “\(session.name)”?",
      "Its agent and terminal end. The session stays in AgentOS and starts again when you open it.",
      button: "Stop")
    else { return }
    work("Stopping \(session.name)…") { _ = Backend.stop(session) }
  }

  @objc private func togglePower() {
    if snap.on {
      guard confirm(
        "Turn AgentOS off on this Mac?",
        "Nothing can reach this Mac until you turn it on again. Sessions already running keep running in the background.",
        button: "Turn Off")
      else { return }
      work("Turning off…") { _ = Backend.machine("off") }
    } else {
      work("Turning on…") {
        _ = Backend.machine("on")
        // The server takes a few seconds to answer
        for _ in 0..<20 where Backend.request("/api/build", timeout: 2) == nil { Thread.sleep(forTimeInterval: 1) }
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
      alert.messageText = "Couldn’t change that"
      alert.informativeText = "macOS refused: \(error.localizedDescription). Keep the app in Applications and try again."
      alert.runModal()
    }
    render()
  }

  @objc private func uninstall() {
    let list = Backend.uninstallList.map { "• \($0)" }.joined(separator: "\n")
    guard confirm(
      "Uninstall AgentOS from this Mac?",
      "This removes:\n\(list)\n\nIt stays: your repositories and sessions’ folders, Claude’s own conversations (~/.claude), Homebrew’s node and tmux. Sessions still running keep running until you close them. Also remove this Mac in AgentOS on your phone (Settings, Machines).",
      button: "Uninstall")
    else { return }
    try? SMAppService.mainApp.unregister()
    busy = "Uninstalling…"
    render()
    queue.async {
      Backend.uninstall()
      DispatchQueue.main.async {
        let bundle = Bundle.main.bundleURL
        if bundle.pathExtension == "app" { try? FileManager.default.trashItem(at: bundle, resultingItemURL: nil) }
        let alert = NSAlert()
        alert.messageText = "AgentOS was removed from this Mac"
        alert.informativeText = "The app is in the Trash."
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
      }
    }
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

extension NSFont {
  func withWeight(_ weight: NSFont.Weight) -> NSFont {
    NSFont.systemFont(ofSize: pointSize, weight: weight)
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
