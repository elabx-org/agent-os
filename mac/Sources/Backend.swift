import Foundation

/// What the menu shows: read from the AgentOS running on this Mac
/// (loopback, which needs no sign-in) and from its folder.
struct SessionRow: Equatable {
  let id: String
  let name: String
  /// "waiting" (needs you), "running" (working) or "idle"
  let state: String
}

/// The service as the poller found it
struct ServiceFacts: Equatable {
  var installed = false
  /// /api/build answered
  var answering = false
  /// The LaunchAgent is loaded (checked only when /api/build fails)
  var serviceLoaded = false
  /// ~/.agent-os/update.lock exists
  var updating = false
  /// link-state.json → state.status
  var linkStatus: String?
  /// When /api/build first failed in a row of failures
  var downSince: Date?
}

struct Snapshot {
  var on = false
  var version: String?
  var hub: String?
  /// The server's address from link.json, for "Open your server's AgentOS"
  var hubURL: URL?
  var installed = false
  var sessions: [SessionRow] = []
  /// Whether the server's sessions may use this Mac; nil when not linked
  var agents: Bool?
  /// Where this Mac keeps repositories, as the user set it ("~/AgentOS")
  var reposDir: String?
  var facts = ServiceFacts()
  var lastPollAt = Date.distantPast

  var waiting: Int { sessions.filter { $0.state == "waiting" }.count }
  var running: Int { sessions.filter { $0.state == "running" }.count }

  func iconState(now: Date = Date()) -> IconState {
    IconState.derive(
      installed: facts.installed, answering: facts.answering, serviceLoaded: facts.serviceLoaded,
      updating: facts.updating, downFor: facts.downSince.map { now.timeIntervalSince($0) } ?? 0,
      waiting: waiting, running: running)
  }
}

/// The version line and build stamps, read from Info.plist (Foundation only)
enum AppInfo {
  static func value(_ key: String) -> String {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? "unknown"
  }
  static var short: String { value("CFBundleShortVersionString") }
  static var commit: String { value("AgentOSCommit") }
  static var sourceHash: String { value("AgentOSSourceHash") }
  static func versionLine() -> String { "AgentOS \(short) commit \(commit) hash \(sourceHash)" }
}

enum Backend {
  static let home = FileManager.default.homeDirectoryForCurrentUser
  static let agentHome = home.appendingPathComponent(".agent-os")
  static let machineScript = agentHome.appendingPathComponent("repo/scripts/agentos-machine.sh")
  static let machineLog = agentHome.appendingPathComponent("logs/machine.log")
  static let port = ProcessInfo.processInfo.environment["AGENT_OS_PORT"] ?? "3011"
  static var portNumber: Int { Int(port) ?? 3011 }
  static var base: String { "http://127.0.0.1:\(port)" }

  static func request(_ path: String, method: String = "GET", timeout: TimeInterval = 4) -> Any? {
    dispatchPrecondition(condition: .notOnQueue(.main))
    guard let url = URL(string: base + path) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    let done = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var out: Any?
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
    dispatchPrecondition(condition: .notOnQueue(.main))
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
    nonisolated(unsafe) var status = 0
    nonisolated(unsafe) var json: [String: Any] = [:]
    userSession.dataTask(with: req) { data, response, _ in
      status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if let data, let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { json = parsed }
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 9)
    return (status, json)
  }

  /// A change only the user may make. It takes a Click, which only a real
  /// click in our own menu can make (Click.swift). nil when it worked, else
  /// what to tell the user.
  static func asUser(path: String, method: String = "PUT", body: [String: Any], click: Click) -> String? {
    var (status, json) = userCall(path, method: method, body: body)
    if status == 403 {
      _ = userCall("/api/user-proof", method: "GET", body: nil)
      (status, json) = userCall(path, method: method, body: body)
    }
    if (200..<300).contains(status) { return nil }
    if status == 0 { return Strings.noAnswer }
    if status == 403 { return Strings.refusedChange }
    return (json["error"] as? String) ?? Strings.errorCode(status)
  }

  static func setAgents(_ allowed: Bool, click: Click) -> String? {
    asUser(path: "/api/link/agents", body: ["allowed": allowed], click: click)
  }

  /// A folder as AgentOS stores it: "~/code" inside the home folder
  static func tilde(_ folder: URL) -> String {
    let path = folder.standardizedFileURL.path
    let root = home.standardizedFileURL.path
    if path == root { return "~" }
    return path.hasPrefix(root + "/") ? "~" + String(path.dropFirst(root.count)) : path
  }

  /// nil puts it back to the default
  static func setReposDir(_ folder: String?, click: Click) -> String? {
    asUser(path: "/api/preferences", body: ["key": "repos_dir", "value": folder.map { $0 as Any } ?? NSNull()], click: click)
  }

  /// The server this Mac is linked to (link.json's hubUrl only)
  static func hubURL() -> URL? {
    let file = agentHome.appendingPathComponent("link.json")
    guard let data = try? Data(contentsOf: file),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let text = json["hubUrl"] as? String, let url = URL(string: text),
      let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http"
    else { return nil }
    return url
  }

  /// link-state.json → state.status
  static func linkStatus() -> String? {
    let file = agentHome.appendingPathComponent("link-state.json")
    guard let data = try? Data(contentsOf: file),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let state = json["state"] as? [String: Any]
    else { return nil }
    return state["status"] as? String
  }

  static func serviceLoaded() -> Bool {
    run("/bin/launchctl", ["print", "gui/\(getuid())/com.agentos.machine"]) == 0
  }

  /// One poll. `downSince` carries over from the last one.
  static func snapshot(downSince: Date?) -> Snapshot {
    var snap = Snapshot()
    snap.lastPollAt = Date()
    snap.installed = FileManager.default.fileExists(atPath: machineScript.path)
    snap.hubURL = hubURL()
    snap.hub = snap.hubURL.map { $0.host ?? $0.absoluteString }
    snap.facts.updating = FileManager.default.fileExists(atPath: agentHome.appendingPathComponent("update.lock").path)
    snap.facts.linkStatus = linkStatus()
    guard let build = request("/api/build") as? [String: Any] else {
      snap.facts.installed = snap.installed
      snap.facts.serviceLoaded = serviceLoaded()
      snap.facts.downSince = downSince ?? Date()
      return snap
    }
    snap.on = true
    snap.facts.answering = true
    snap.facts.serviceLoaded = true
    snap.facts.installed = true
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
    dispatchPrecondition(condition: .notOnQueue(.main))
    return run("/bin/bash", [machineScript.path, command]) == 0
  }

  static func stop(_ session: SessionRow) -> Bool {
    request("/api/sessions/\(session.id)/stop", method: "POST", timeout: 15) != nil
  }

  /// Removes it all. Sessions' own folders, repositories and Claude's
  /// conversations (~/.claude) are not AgentOS's to delete and stay.
  static func uninstall() {
    dispatchPrecondition(condition: .notOnQueue(.main))
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
