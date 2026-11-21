import AppKit
import UserNotifications

// The stub action test (./test.sh action). Built only with -D SELFTEST into
// build/agentos-actiontest, never into the app: build.sh checks the shipped
// binary holds no AGENTOS_SELFTEST_MARKER. It drives every menu action and
// the notification actions through the real Backend, asUser and outcome
// mapping, against Tests/stub-server.mjs only.

let AGENTOS_SELFTEST_MARKER = "AGENTOS_SELFTEST_MARKER"

nonisolated(unsafe) var passed = 0
nonisolated(unsafe) var failed = 0

func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
  if ok {
    passed += 1
    print("PASS \(name)")
  } else {
    failed += 1
    print("FAIL \(name): \(detail())")
  }
}

/// Runs blocking Backend work off the main thread while the main run loop turns
func background<T>(_ work: @escaping () -> T) -> T {
  nonisolated(unsafe) var out: T?
  nonisolated(unsafe) var done = false
  nonisolated(unsafe) let job = work
  DispatchQueue.global().async {
    out = job()
    DispatchQueue.main.async { done = true }
  }
  while !done { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
  return out!
}

func spin(until cond: () -> Bool, timeout: TimeInterval = 20) {
  let end = Date().addingTimeInterval(timeout)
  while !cond() && Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
}

func stub(_ query: String) { _ = background { Backend.request("/__stub?\(query)") } }

func stubLog() -> [[String: Any]] {
  background { (Backend.request("/__stub/log") as? [[String: Any]]) ?? [] }
}

/// The log without the test's own reads of the stub
func appRequests() -> [[String: Any]] {
  stubLog().filter { !(($0["path"] as? String) ?? "").hasPrefix("/__stub") }
}

func json(_ any: Any?) -> String {
  guard let any, JSONSerialization.isValidJSONObject(any),
    let data = try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys])
  else { return String(describing: any) }
  return String(decoding: data, as: UTF8.self)
}

@MainActor
final class TestHost: NotifierHost {
  var snapshot: Snapshot = {
    var s = Snapshot()
    s.on = true
    s.features = true
    s.sessions = [SessionRow(id: "stub-a", name: "Stub A", state: "waiting")]
    s.names = ["stub-a": "Stub A"]
    return s
  }()
  var windowShowingSession: String?
  var keyWindowSession: String?
  var appIsActive = false
  var opened: [String] = []
  func open(_ d: Destination, activate: Bool) {
    if case .session(let id) = d { opened.append(id) }
  }
}

final class RecordingPoster: NotificationPoster {
  struct Post {
    let id: String
    let category: String
    let title: String
    let body: String
    let nonce: String
  }
  var posts: [Post] = []
  var removed: [String] = []
  func setUp(delegate: UNUserNotificationCenterDelegate) {}
  func post(
    identifier: String, category: String, title: String, subtitle: String, body: String, sound: Bool,
    nonce: String, thread: String, done: @escaping @Sendable (Bool) -> Void
  ) {
    posts.append(Post(id: identifier, category: category, title: title, body: body, nonce: nonce))
    done(true)
  }
  func remove(_ identifiers: [String]) { removed += identifiers }
  func delivered(_ done: @escaping @Sendable ([[String: String]]) -> Void) { done([]) }
  func status(_ done: @escaping @Sendable ([String: String]) -> Void) { done(["authorization": "authorized"]) }
  func requestAuthorization(_ done: @escaping @Sendable (Bool) -> Void) { done(true) }
}

@MainActor
func runAll() {
  guard let build = background({ Backend.build(timeout: 2) }), build.stub == true else {
    print("FAIL stub: /api/build on port \(Backend.port) is not the stub; refusing to run")
    exit(2)
  }
  check("stub features", build.answers)

  // MARK: Every menu action through Backend.perform

  let id = "stub-a"
  let fp = "f1f1f1f1f1f1f1f1"
  let labels = ["Red", "Blue"]
  let new = NewSession(
    projectId: "p1", workingDirectory: "~/stub", agentType: "claude", model: nil, initialPrompt: "say hello")
  let actions: [(MenuAction, String)] = [
    (.answerPrompt(id: id, index: 0, label: "Yes", fingerprint: fp), "v1"),
    (.answerAsk(id: id, question: "Colour?", optionCount: 2, labels: labels, pick: 1), "v1"),
    (.askOther(id: id, question: "Colour?", optionCount: 2, labels: labels, text: "Green"), "v1"),
    (.reply(id: id, text: "hello"), "none"),
    (.choice(id: id, reply: "Yes, go ahead"), "none"),
    (.interrupt(id: id), "v1"),
    (.stop(id: id), "v1"),
    (.newSession(new), "v1"),
  ]
  for (action, variant) in actions {
    stub("mode=normal&prompt=\(variant)&clear=1")
    guard let r = Requests.request(for: action) else {
      check("\(action.name) has a request", false)
      continue
    }
    let outcome = background { Backend.perform(r, click: Clicks.forTest()) }
    check("\(action.name) ok", outcome == .ok, "got \(outcome)")
    let log = appRequests()
    let sent = log.filter { ($0["path"] as? String) == r.path && ($0["method"] as? String) == r.method }
    guard let last = sent.last else {
      check("\(action.name) reached the stub", false, json(log))
      continue
    }
    check("\(action.name) \(r.method) \(r.path)", (last["status"] as? Int).map { (200..<300).contains($0) } ?? false)
    // Proof headers on user-only calls only, and never the agent marker
    check(
      "\(action.name) proof headers \(r.needsProof ? "sent" : "absent")",
      (last["cookie"] as? Bool) == r.needsProof && ((last["origin"] as? String) != nil) == r.needsProof,
      json(last))
    check("\(action.name) no agent marker", last["agentMarker"] is NSNull)
    if !r.needsProof {
      check("\(action.name) never asked for proof", !log.contains { ($0["path"] as? String) == "/api/user-proof" })
    }
    let body = last["body"] as? [String: Any]
    switch action {
    case .answerPrompt:
      check("answer carries the fingerprint", body?["fingerprint"] as? String == fp, json(body))
    case .answerAsk, .askOther:
      check("\(action.name) carries the labels", json(body?["labels"]) == json([labels]), json(body))
    case .reply, .choice:
      check("\(action.name) onlyIfNoPrompt", body?["onlyIfNoPrompt"] as? Bool == true, json(body))
    case .newSession:
      check("newSession launch", body?["launch"] as? Bool == true, json(body))
      check(
        "newSession no autoApprove/permissionMode", body?["autoApprove"] == nil && body?["permissionMode"] == nil,
        json(body))
    default:
      break
    }
  }

  // MARK: Outcome mapping

  let answer = Requests.request(for: .answerPrompt(id: id, index: 0, label: "Yes", fingerprint: fp))!
  stub("mode=403once&prompt=v1&clear=1")
  var outcome = background { Backend.perform(answer, click: Clicks.forTest()) }
  let order = appRequests().map { "\($0["method"] as? String ?? "") \($0["path"] as? String ?? "") \($0["status"] as? Int ?? 0)" }
  check("403 once: ok after one retry", outcome == .ok, "got \(outcome)")
  check(
    "403 → user-proof → retry",
    order == [
      "POST /api/sessions/stub-a/prompt 403", "GET /api/user-proof 200", "POST /api/sessions/stub-a/prompt 200",
    ], order.joined(separator: ", "))

  stub("mode=403always&prompt=v1&clear=1")
  outcome = background { Backend.perform(answer, click: Clicks.forTest()) }
  check("403 twice: refused", outcome == .refused, "got \(outcome)")

  stub("mode=normal&prompt=v1&clear=1")
  let stale = Requests.request(for: .answerPrompt(id: id, index: 0, label: "Yes", fingerprint: "0000000000000000"))!
  outcome = background { Backend.perform(stale, click: Clicks.forTest()) }
  check("409 with the prompt: changed", outcome == .changed, "got \(outcome)")

  let reply = Requests.request(for: .reply(id: id, text: "hello"))!
  outcome = background { Backend.perform(reply, click: Clicks.forTest()) }
  check("send-keys at a prompt: guarded", { if case .guarded = outcome { return true }; return false }(), "got \(outcome)")

  stub("mode=offline&prompt=v1&clear=1")
  outcome = background { Backend.perform(answer, click: Clicks.forTest()) }
  check("offline (user-only)", outcome == .offline, "got \(outcome)")
  let stop = Requests.request(for: .stop(id: id))!
  outcome = background { Backend.perform(stop, click: nil) }
  check("offline (plain)", outcome == .offline, "got \(outcome)")
  stub("mode=normal&prompt=v1&clear=1")

  // MARK: Notifications

  let suite = "com.agentos.mac.actiontest.\(getpid())"
  let defaults = UserDefaults(suiteName: suite)!
  let poster = RecordingPoster()
  let host = TestHost()
  let notifier = Notifier(poster: poster, defaults: defaults)
  notifier.host = host
  Notifier.posted = [:]
  var statusRead = false
  notifier.refreshStatus { statusRead = true }
  spin(until: { statusRead })
  check("notifier reads its permission", notifier.authorization == "authorized", notifier.authorization)
  var serial = 0
  func entry(_ kind: String) -> NotificationEntry {
    serial += 1
    return NotificationEntry(
      id: "n\(serial)", kind: kind, title: "ignored title", body: "Done.", sessionId: id, projectName: "Stub project",
      at: Int64(Date().timeIntervalSince1970 * 1000) + Int64(serial))
  }
  func respond(_ action: String, nonce: String?, text: String? = nil) {
    var finished = false
    notifier.handleForTest(actionId: action, identifier: "s-\(id)", nonce: nonce, text: text) { finished = true }
    spin(until: { finished })
    check("\(action) response finished", finished)
  }

  let v1 = background { Backend.prompt(id) }
  check("fresh prompt read", v1?.fingerprint == fp, json(v1.map { ["fp": $0.fingerprint ?? ""] }))
  notifier.consider([entry("needsYou")], prompts: [id: v1!])
  check("needsYou posts", poster.posts.count == 1, "\(poster.posts.count) posts")
  check("its identifier", poster.posts.last?.id == "s-stub-a")
  check("its category", poster.posts.last?.category == "PERMISSION", poster.posts.last?.category ?? "none")
  check("its title is the app's", poster.posts.last?.title == "Stub A needs you", poster.posts.last?.title ?? "")
  check("its record has the fingerprint", Notifier.posted["s-stub-a"]?.fingerprint == fp)

  // Allow: the stub reorders the options after the post; the app sends the
  // index and label of the fresh read
  stub("prompt=v2&clear=1")
  respond("allow", nonce: Notifier.posted["s-stub-a"]?.nonce)
  var posts = appRequests().filter { ($0["path"] as? String) == "/api/sessions/stub-a/prompt" && ($0["method"] as? String) == "POST" }
  var body = posts.last?["body"] as? [String: Any]
  check("allow sent once", posts.count == 1, json(appRequests()))
  check("allow uses the fresh index and label", body?["index"] as? Int == 2 && body?["label"] as? String == "Yes", json(body))
  check("allow carries the fingerprint", body?["fingerprint"] as? String == fp)
  check("allow ok removes it", Notifier.posted["s-stub-a"] == nil && poster.removed.contains("s-stub-a"))
  check("allow logged", Notifier.lastActions.last.map { $0.action == "allow" && $0.outcome == "ok" } ?? false)

  // Deny, on the reordered prompt
  let v2 = background { Backend.prompt(id) }!
  notifier.consider([entry("needsYou")], prompts: [id: v2])
  stub("clear=1")
  respond("deny", nonce: Notifier.posted["s-stub-a"]?.nonce)
  posts = appRequests().filter { ($0["path"] as? String) == "/api/sessions/stub-a/prompt" && ($0["method"] as? String) == "POST" }
  body = posts.last?["body"] as? [String: Any]
  check("deny uses the fresh index and label", body?["index"] as? Int == 0 && body?["label"] as? String == "No", json(body))

  // A different prompt by the time of the click: nothing is sent
  stub("prompt=v1")
  notifier.consider([entry("needsYou")], prompts: [id: background { Backend.prompt(id) }!])
  stub("prompt=v3&clear=1")
  let before = poster.posts.count
  respond("allow", nonce: Notifier.posted["s-stub-a"]?.nonce)
  check(
    "fingerprint mismatch sends nothing",
    !appRequests().contains { ($0["method"] as? String) == "POST" }, json(appRequests()))
  check("mismatch posts the follow-up", poster.posts.count == before + 1 && poster.posts.last?.title == "That question changed",
    poster.posts.last?.title ?? "")
  check("the follow-up has no actions", poster.posts.last?.category == "INFO")

  // A wrong nonce: no request at all
  stub("prompt=v1")
  notifier.consider([entry("needsYou")], prompts: [id: background { Backend.prompt(id) }!])
  stub("clear=1")
  respond("allow", nonce: "0000000000000000")
  check("wrong nonce sends nothing", appRequests().isEmpty, json(appRequests()))
  respond("allow", nonce: nil)
  check("no nonce sends nothing", appRequests().isEmpty, json(appRequests()))

  // Reply on a "finished" notification: status and prompt re-read first
  notifier.consider([entry("finished")], prompts: [:])
  check("finished posts", poster.posts.last?.category == "FINISHED" && poster.posts.last?.title == "Stub A is done",
    poster.posts.last.map { "\($0.category) \($0.title)" } ?? "")
  stub("prompt=none&clear=1")
  respond("reply", nonce: Notifier.posted["s-stub-a"]?.nonce, text: "hello there")
  let replyLog = appRequests().map { "\($0["method"] as? String ?? "") \($0["path"] as? String ?? "")" }
  check("reply re-reads status and prompt first", Array(replyLog.prefix(2)) == ["GET /api/sessions/status", "GET /api/sessions/stub-a/prompt"],
    replyLog.joined(separator: ", "))
  let keys = appRequests().first { ($0["path"] as? String) == "/api/sessions/stub-a/send-keys" }
  let keysBody = keys?["body"] as? [String: Any]
  check("reply sends the text with onlyIfNoPrompt", keysBody?["text"] as? String == "hello there"
    && keysBody?["onlyIfNoPrompt"] as? Bool == true, json(keysBody))

  // Reply while a prompt is up: nothing typed
  notifier.consider([entry("finished")], prompts: [:])
  stub("prompt=v1&clear=1")
  respond("reply", nonce: Notifier.posted["s-stub-a"]?.nonce, text: "hello")
  check("reply at a prompt sends nothing", !appRequests().contains { ($0["method"] as? String) == "POST" }, json(appRequests()))

  // An action the post's category doesn't offer: nothing read, nothing sent
  notifier.consider([entry("finished")], prompts: [:])
  stub("prompt=v1&clear=1")
  respond("allow", nonce: Notifier.posted["s-stub-a"]?.nonce)
  check("allow on a finished post sends nothing", appRequests().isEmpty, json(appRequests()))
  notifier.consider([entry("needsYou")], prompts: [id: background { Backend.prompt(id) }!])
  stub("prompt=none&clear=1")
  respond("reply", nonce: Notifier.posted["s-stub-a"]?.nonce, text: "1")
  check("reply on a permission post sends nothing", appRequests().isEmpty, json(appRequests()))
  check("offers: deny-only has no allow", !Notifier.offers("PERMISSION_DENY", "allow") && Notifier.offers("PERMISSION_DENY", "deny"))
  check("offers: info has none", !Notifier.offers("INFO", "deny") && !Notifier.offers("INFO", "reply"))
  stub("prompt=v1")

  // A tap on the body opens the window, sends nothing
  notifier.consider([entry("finished")], prompts: [:])
  stub("clear=1")
  respond(UNNotificationDefaultActionIdentifier, nonce: Notifier.posted["s-stub-a"]?.nonce)
  check("body tap opens the session", host.opened.last == id)
  check("body tap sends nothing", appRequests().isEmpty, json(appRequests()))

  // An event the app already handled, and one the window shows
  let count = poster.posts.count
  let seen = entry("needsYou")
  notifier.consider([seen], prompts: [id: background { Backend.prompt(id) }!])
  notifier.consider([seen], prompts: [id: background { Backend.prompt(id) }!])
  check("an event posts once", poster.posts.count == count + 1)
  host.appIsActive = true
  host.windowShowingSession = id
  notifier.consider([entry("needsYou")], prompts: [id: background { Backend.prompt(id) }!])
  check("not while the window shows it", poster.posts.count == count + 1)

  // A "needs you" post goes once its session stops waiting; a finished one stays
  host.windowShowingSession = nil
  host.appIsActive = false
  notifier.consider([entry("needsYou")], prompts: [id: background { Backend.prompt(id) }!])
  check("posted again", Notifier.posted["s-stub-a"]?.kind == "needsYou")
  var idle = host.snapshot
  idle.sessions = [SessionRow(id: id, name: "Stub A", state: "idle")]
  host.snapshot = idle
  notifier.reconcile(idle, details: [:])
  check("removed once it isn't waiting", Notifier.posted["s-stub-a"] == nil && poster.removed.last == "s-stub-a")
  notifier.consider([entry("finished")], prompts: [:])
  notifier.reconcile(idle, details: [:])
  check("a finished post stays", Notifier.posted["s-stub-a"]?.kind == "finished")
  host.windowShowingSession = id
  notifier.reconcile(idle, details: [:])
  check("removed when the window shows it", Notifier.posted["s-stub-a"] == nil)

  defaults.removePersistentDomain(forName: suite)
}

MainActor.assumeIsolated { runAll() }
print("action \(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
