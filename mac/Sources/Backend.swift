import Foundation

/// What the menu shows: read from the AgentOS running on this Mac
/// (loopback, which needs no sign-in) and from its folder.
struct SessionRow: Equatable {
  let id: String
  let name: String
  /// "waiting" (needs you), "running" (working) or "idle"
  let state: String
  /// The status's last screen line, for a working session's submenu
  var lastLine: String? = nil
}

/// How a request went, for the menu's and the notifications' follow-ups
enum Outcome: Equatable {
  case ok
  /// 409: the prompt or question is not the one answered
  case changed
  /// 409 from send-keys: a prompt is up (the server's text)
  case guarded(String)
  /// 403, after fetching proof once and trying again
  case refused
  case offline
  case error(String)

  var name: String {
    switch self {
    case .ok: return "ok"
    case .changed: return "changed"
    case .guarded: return "guarded"
    case .refused: return "refused"
    case .offline: return "offline"
    case .error: return "error"
    }
  }

  /// What today's settings alerts say; nil when it worked
  var problem: String? {
    switch self {
    case .ok: return nil
    case .changed: return Strings.changedBody
    case .guarded(let text): return text
    case .refused: return Strings.refusedChange
    case .offline: return Strings.noAnswer
    case .error(let text): return text
    }
  }

  static func from(status: Int, json: [String: Any], askedForProof: Bool) -> Outcome {
    if (200..<300).contains(status) { return .ok }
    if status == 0 { return .offline }
    if status == 409 {
      if json["prompt"] as? Bool == true { return .guarded((json["error"] as? String) ?? Strings.guardedTitle) }
      let error = json["error"] as? String
      if json.keys.contains("prompt") || json.keys.contains("fingerprint")
        || error == "The question changed; check the session"
      {
        return .changed
      }
      return .error(error ?? Strings.errorCode(status))
    }
    if status == 403 && askedForProof { return .refused }
    return .error((json["error"] as? String) ?? Strings.errorCode(status))
  }
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
  /// /api/build lists the three answer features
  var features = false
  /// Every session's name by id, for notification titles
  var names: [String: String] = [:]
  var version: String?
  var hub: String?
  /// The server's address from link.json, for "Open your server's AgentOS"
  var hubURL: URL?
  var installed = false
  var sessions: [SessionRow] = []
  /// /api/build, /api/sessions and /api/sessions/status all answered, so
  /// `sessions` is the whole truth; a poll where any failed or timed out
  /// must not be read as "nobody is waiting"
  var sessionsComplete = false
  /// Whether the server's sessions may use this Mac; nil when not linked
  var agents: Bool?
  /// Where this Mac keeps repositories, as the user set it ("~/AgentOS")
  var reposDir: String?
  var facts = ServiceFacts()
  var lastPollAt = Date.distantPast
  /// This Mac's projects, and which of them its sessions were last active in
  var projects: [Project] = []
  var uses: [ProjectUse] = []

  var recentProjects: [Project] { Glance.recent(projects, uses: uses) }

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

  /// The body of a 2xx answer, or nil
  static func fetch(_ path: String, timeout: TimeInterval = 4) -> Data? {
    dispatchPrecondition(condition: .notOnQueue(.main))
    guard let url = URL(string: base + path) else { return nil }
    let req = URLRequest(url: url, timeoutInterval: timeout)
    let done = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var out: Data?
    URLSession.shared.dataTask(with: req) { data, response, _ in
      if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) { out = data ?? Data() }
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + timeout + 1)
    return out
  }

  static func decode<T: Decodable>(_ type: T.Type, _ path: String, timeout: TimeInterval = 4) -> T? {
    Models.decode(type, fetch(path, timeout: timeout))
  }

  static func prompt(_ id: String, timeout: TimeInterval = 2) -> PromptReply? {
    guard SessionLink.isValidId(id) else { return nil }
    return decode(PromptReply.self, "/api/sessions/\(id)/prompt", timeout: timeout)
  }

  static func replyContext(_ id: String, timeout: TimeInterval = 2) -> ReplyContext? {
    guard SessionLink.isValidId(id) else { return nil }
    return decode(ReplyContextReply.self, "/api/sessions/\(id)/reply-context", timeout: timeout)?.context
  }

  static func build(timeout: TimeInterval = 4) -> BuildInfo? { decode(BuildInfo.self, "/api/build", timeout: timeout) }

  static func statuses() -> [String: StatusEntry]? {
    struct Reply: Decodable { let statuses: [String: StatusEntry] }
    return decode(Reply.self, "/api/sessions/status")?.statuses
  }

  /// A request that needs no proof (stop, interrupt, a new session). It
  /// sends no Origin and no agent marker, as a command-line tool would.
  static func plain(path: String, method: String = "POST", body: [String: Any]?) -> (Outcome, [String: Any]) {
    dispatchPrecondition(condition: .notOnQueue(.main))
    guard let url = URL(string: base + path) else { return (.error(Strings.errorCode(0)), [:]) }
    var req = URLRequest(url: url, timeoutInterval: 15)
    req.httpMethod = method
    if let body {
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let done = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var status = 0
    nonisolated(unsafe) var json: [String: Any] = [:]
    URLSession.shared.dataTask(with: req) { data, response, _ in
      status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if let data, let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { json = parsed }
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 16)
    return (Outcome.from(status: status, json: json, askedForProof: false), json)
  }

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
  /// click in our own menu, panels or notifications can make (Click.swift).
  /// On a 403 it fetches proof once, the way a page would, and tries again.
  static func asUser(path: String, method: String = "PUT", body: [String: Any], click: Click) -> Outcome {
    var (status, json) = userCall(path, method: method, body: body)
    var asked = false
    if status == 403 {
      asked = true
      _ = userCall("/api/user-proof", method: "GET", body: nil)
      (status, json) = userCall(path, method: method, body: body)
    }
    return Outcome.from(status: status, json: json, askedForProof: asked)
  }

  /// A menu action's request: with proof when it needs it
  static func perform(_ r: PlannedRequest, click: Click?) -> Outcome {
    if r.needsProof {
      guard let click else { return .refused }
      return asUser(path: r.path, method: r.method, body: r.body ?? [:], click: click)
    }
    return plain(path: r.path, method: r.method, body: r.body).0
  }

  static func setAgents(_ allowed: Bool, click: Click) -> String? {
    asUser(path: "/api/link/agents", body: ["allowed": allowed], click: click).problem
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
    asUser(
      path: "/api/preferences", body: ["key": "repos_dir", "value": folder.map { $0 as Any } ?? NSNull()],
      click: click
    ).problem
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
    guard let buildData = fetch("/api/build"),
      let build = (try? JSONSerialization.jsonObject(with: buildData)) as? [String: Any]
    else {
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
    snap.features = BuildInfo.hasAnswerFeatures(build["features"] as? [String])
    snap.agents = (request("/api/link/agents") as? [String: Any])?["allowed"] as? Bool
    snap.reposDir =
      ((request("/api/preferences?key=repos_dir") as? [String: Any])?["value"] as? String) ?? "~/AgentOS"
    let listRead = (request("/api/sessions") as? [String: Any])?["sessions"] as? [[String: Any]]
    let statusRead = (request("/api/sessions/status") as? [String: Any])?["statuses"] as? [String: [String: Any]]
    snap.sessionsComplete = listRead != nil && statusRead != nil
    let list = listRead ?? []
    let statuses = statusRead ?? [:]
    let order = ["waiting": 0, "running": 1, "idle": 2]
    for row in list {
      if let id = row["id"] as? String, let name = row["name"] as? String { snap.names[id] = name }
    }
    snap.projects = decode(ProjectList.self, "/api/projects")?.projects ?? []
    snap.uses = list.compactMap { row -> ProjectUse? in
      guard let project = row["project_id"] as? String, let at = row["updated_at"] as? String else { return nil }
      return ProjectUse(projectId: project, at: at)
    }
    snap.sessions = list.compactMap { row -> SessionRow? in
      guard let id = row["id"] as? String, !(row["settled_at"] is NSNumber),
        let state = statuses[id]?["status"] as? String, order[state] != nil
      else { return nil }
      return SessionRow(
        id: id, name: (row["name"] as? String) ?? "Session", state: state,
        lastLine: statuses[id]?["lastLine"] as? String)
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
}
