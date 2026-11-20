import Foundation

/// What the menu shows: read from the AgentOS running on this Mac
/// (loopback, which needs no sign-in) and from its folder.
struct SessionRow {
  let id: String
  let name: String
  /// "waiting" (needs you), "running" (working) or "idle"
  let state: String
}

struct Snapshot {
  var on = false
  var version: String?
  var hub: String?
  var installed = false
  var sessions: [SessionRow] = []
  /// Whether the server's sessions may use this Mac; nil when not linked
  var agents: Bool?
  /// Where this Mac keeps repositories, as the user set it ("~/AgentOS")
  var reposDir: String?
}

enum Backend {
  static let home = FileManager.default.homeDirectoryForCurrentUser
  static let agentHome = home.appendingPathComponent(".agent-os")
  static let machineScript = agentHome.appendingPathComponent("repo/scripts/agentos-machine.sh")
  static let port = ProcessInfo.processInfo.environment["AGENT_OS_PORT"] ?? "3011"
  static var base: String { "http://127.0.0.1:\(port)" }

  static func request(_ path: String, method: String = "GET", timeout: TimeInterval = 4) -> Any? {
    guard let url = URL(string: base + path) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    let done = DispatchSemaphore(value: 0)
    var out: Any?
    URLSession.shared.dataTask(with: req) { data, response, _ in
      if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data {
        out = (try? JSONSerialization.jsonObject(with: data)) ?? [String: Any]()
      }
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + timeout + 1)
    return out
  }

  // MARK: Settings only the user may change

  /// AgentOS takes these changes only from the user's own browser: a page
  /// it served, carrying the cookie it gives such pages. This app is the
  /// user clicking in the menu, so it asks the way a page would. Cookies
  /// stay in this session, in memory.
  private static let userSession = URLSession(configuration: .ephemeral)

  private static func userCall(_ path: String, method: String, body: [String: Any]?) -> (Int, [String: Any]) {
    guard let url = URL(string: base + path) else { return (0, [:]) }
    var req = URLRequest(url: url, timeoutInterval: 8)
    req.httpMethod = method
    if let body {
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.setValue(base, forHTTPHeaderField: "Origin")
    } else {
      // A page navigation, which is what the cookie is given to
      req.setValue("1", forHTTPHeaderField: "Upgrade-Insecure-Requests")
      req.setValue("text/html", forHTTPHeaderField: "Accept")
    }
    let done = DispatchSemaphore(value: 0)
    var status = 0
    var json: [String: Any] = [:]
    userSession.dataTask(with: req) { data, response, _ in
      status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if let data, let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { json = parsed }
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 9)
    return (status, json)
  }

  /// nil when it worked, else what to tell the user
  private static func asUser(_ path: String, _ body: [String: Any]) -> String? {
    var (status, json) = userCall(path, method: "PUT", body: body)
    if status == 403 {
      _ = userCall("/api/user-proof", method: "GET", body: nil)
      (status, json) = userCall(path, method: "PUT", body: body)
    }
    if (200..<300).contains(status) { return nil }
    if status == 0 { return "AgentOS on this Mac didn’t answer." }
    if status == 403 { return "AgentOS on this Mac refused the change. Change it in AgentOS on your phone instead (Settings, Machines)." }
    return (json["error"] as? String) ?? "AgentOS answered with an error (\(status))."
  }

  static func setAgents(_ allowed: Bool) -> String? {
    asUser("/api/link/agents", ["allowed": allowed])
  }

  /// A folder as AgentOS stores it: "~/code" inside the home folder
  static func tilde(_ folder: URL) -> String {
    let path = folder.standardizedFileURL.path
    let root = home.standardizedFileURL.path
    if path == root { return "~" }
    return path.hasPrefix(root + "/") ? "~" + String(path.dropFirst(root.count)) : path
  }

  /// nil puts it back to the default
  static func setReposDir(_ folder: String?) -> String? {
    asUser("/api/preferences", ["key": "repos_dir", "value": folder.map { $0 as Any } ?? NSNull()])
  }

  /// The server this Mac is linked to, by host name only
  static func hubHost() -> String? {
    let file = agentHome.appendingPathComponent("link.json")
    guard let data = try? Data(contentsOf: file),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let text = json["hubUrl"] as? String
    else { return nil }
    return URL(string: text)?.host ?? text
  }

  static func snapshot() -> Snapshot {
    var snap = Snapshot()
    snap.installed = FileManager.default.fileExists(atPath: machineScript.path)
    snap.hub = hubHost()
    guard let build = request("/api/build") as? [String: Any] else { return snap }
    snap.on = true
    snap.version = (build["version"] as? String)?.components(separatedBy: "+").first
    snap.agents = (request("/api/link/agents") as? [String: Any])?["allowed"] as? Bool
    snap.reposDir =
      ((request("/api/preferences?key=repos_dir") as? [String: Any])?["value"] as? String) ?? "~/AgentOS"
    let list = (request("/api/sessions") as? [String: Any])?["sessions"] as? [[String: Any]] ?? []
    let statuses =
      (request("/api/sessions/status") as? [String: Any])?["statuses"] as? [String: [String: Any]] ?? [:]
    let order = ["waiting": 0, "running": 1, "idle": 2]
    snap.sessions = list.compactMap { row -> SessionRow? in
      guard let id = row["id"] as? String, !(row["settled_at"] is NSNumber),
        let state = statuses[id]?["status"] as? String, order[state] != nil
      else { return nil }
      return SessionRow(id: id, name: (row["name"] as? String) ?? "Session", state: state)
    }
    .sorted { (order[$0.state] ?? 9, $0.name) < (order[$1.state] ?? 9, $1.name) }
    return snap
  }

  @discardableResult
  static func run(_ tool: String, _ args: [String]) -> Int32 {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: tool)
    task.arguments = args
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    do { try task.run() } catch { return -1 }
    task.waitUntilExit()
    return task.terminationStatus
  }

  static func machine(_ command: String) -> Bool {
    run("/bin/bash", [machineScript.path, command]) == 0
  }

  static func stop(_ session: SessionRow) -> Bool {
    request("/api/sessions/\(session.id)/stop", method: "POST", timeout: 15) != nil
  }

  /// Everything the installer put on this Mac, as the user reads it
  static let uninstallList = [
    "~/.agent-os (AgentOS, its session list, logs and the key that links this Mac)",
    "~/Library/LaunchAgents/com.agentos.machine.plist (starts it at login)",
    "~/.local/bin/agent-os (the command)",
    "This app",
  ]

  /// Removes it all. Sessions' own folders, repositories and Claude's
  /// conversations (~/.claude) are not AgentOS's to delete and stay.
  static func uninstall() {
    if FileManager.default.fileExists(atPath: machineScript.path) { _ = machine("remove") }
    let plist = home.appendingPathComponent("Library/LaunchAgents/com.agentos.machine.plist")
    run("/bin/launchctl", ["bootout", "gui/\(getuid())/com.agentos.machine"])
    try? FileManager.default.removeItem(at: plist)
    let command = home.appendingPathComponent(".local/bin/agent-os")
    if (try? FileManager.default.destinationOfSymbolicLink(atPath: command.path)) != nil {
      try? FileManager.default.removeItem(at: command)
    }
    try? FileManager.default.removeItem(at: agentHome)
  }
}
