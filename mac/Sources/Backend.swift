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
