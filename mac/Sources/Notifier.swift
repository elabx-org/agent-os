import AppKit
import UserNotifications

/// A notification this app posted, kept so a response can be checked
/// against it: only our own posts, with the nonce they went out with, can
/// act (Clicks.fromNotification).
struct PostedRecord: Codable, Equatable {
  var sessionId: String
  var category: String
  /// The prompt's fingerprint at post time (permission posts only)
  var fingerprint: String?
  var nonce: String
  var postedAt: Date
  /// needsYou, finished, limited, … (which follow the session's state)
  var kind: String
}

/// What the notifier needs from the app
@MainActor
protocol NotifierHost: AnyObject {
  var snapshot: Snapshot { get }
  var windowShowingSession: String? { get }
  /// The session the window shows while it is the key window
  var keyWindowSession: String? { get }
  var appIsActive: Bool { get }
  func open(_ d: Destination, activate: Bool)
}

/// The system's notification center, or a recorder in the action test
protocol NotificationPoster: AnyObject {
  func setUp(delegate: UNUserNotificationCenterDelegate)
  func post(
    identifier: String, category: String, title: String, subtitle: String, body: String, sound: Bool,
    nonce: String, thread: String, done: @escaping @Sendable (Bool) -> Void)
  func remove(_ identifiers: [String])
  func delivered(_ done: @escaping @Sendable ([[String: String]]) -> Void)
  func status(_ done: @escaping @Sendable ([String: String]) -> Void)
  func requestAuthorization(_ done: @escaping @Sendable (Bool) -> Void)
}

/// Notifications for this Mac's sessions, and acting on them. Every action
/// re-reads the session first and sends only what the fresh read shows.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  static let actionIds: Set<String> = ["allow", "deny", "reply"]
  /// Our posts by identifier (mirrored to UserDefaults `postedRecords`)
  static var posted: [String: PostedRecord] = [:]

  struct ActionEntry {
    let action: String
    let sessionId: String
    let outcome: String
    let at: Date
  }

  /// Outcomes only, no text: for dump-state
  static var lastActions: [ActionEntry] = []
  static func log(_ action: String, _ sessionId: String, _ outcome: String) {
    lastActions.append(ActionEntry(action: action, sessionId: sessionId, outcome: outcome, at: Date()))
    if lastActions.count > 20 { lastActions.removeFirst(lastActions.count - 20) }
  }

  weak var host: NotifierHost?
  let poster: NotificationPoster
  private let defaults: UserDefaults
  private let work = DispatchQueue(label: "agentos.notifier.work")
  /// authorized, provisional, denied, notDetermined (or ephemeral)
  private(set) var authorization = "notDetermined"
  private(set) var cursor: Int64
  private var handled: [String]
  var toggles: NotifyRules.Toggles {
    didSet {
      defaults.set(toggles.needsYou, forKey: "notifyNeedsYou")
      defaults.set(toggles.finished, forKey: "notifyFinished")
      defaults.set(toggles.limited, forKey: "notifyLimited")
    }
  }

  init(poster: NotificationPoster, defaults: UserDefaults = .standard) {
    self.poster = poster
    self.defaults = defaults
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let stored = defaults.object(forKey: "eventsCursor") as? NSNumber
    cursor = NotifyRules.startCursor(stored: stored?.int64Value, nowMs: now)
    handled = (defaults.array(forKey: "handledIds") as? [String]) ?? []
    func flag(_ key: String) -> Bool { defaults.object(forKey: key) as? Bool ?? true }
    toggles = NotifyRules.Toggles(
      needsYou: flag("notifyNeedsYou"), finished: flag("notifyFinished"), limited: flag("notifyLimited"))
    super.init()
    if let data = defaults.data(forKey: "postedRecords"),
      let saved = try? JSONDecoder().decode([String: PostedRecord].self, from: data)
    {
      Notifier.posted = saved
    }
  }

  /// In applicationWillFinishLaunching: the delegate and the categories
  func setUp() {
    poster.setUp(delegate: self)
    refreshStatus()
  }

  private func saveRecords() {
    var records = Notifier.posted
    if records.count > 200 {
      let keep = records.sorted { $0.value.postedAt > $1.value.postedAt }.prefix(200).map(\.key)
      records = records.filter { keep.contains($0.key) }
      Notifier.posted = records
    }
    if let data = try? JSONEncoder().encode(records) { defaults.set(data, forKey: "postedRecords") }
  }

  // MARK: Permission

  func refreshStatus(then: (() -> Void)? = nil) {
    poster.status { status in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          self.authorization = status["authorization"] ?? "notDetermined"
          then?()
        }
      }
    }
  }

  /// The first time the window shows or the menu opens, while macOS hasn't
  /// asked yet. Never at an event and never at launch.
  /// macOS shows what we post
  var allowed: Bool { ["authorized", "provisional", "ephemeral"].contains(authorization) }

  func askIfUndetermined() {
    guard authorization == "notDetermined" else { return }
    requestAuthorization()
  }

  func requestAuthorization() {
    poster.requestAuthorization { _ in
      DispatchQueue.main.async { MainActor.assumeIsolated { self.refreshStatus() } }
    }
  }

  // MARK: Posting

  private static func newNonce() -> String {
    var rng = SystemRandomNumberGenerator()
    return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &rng)) }.joined()
  }

  func post(_ d: NotifyRules.Decision, sessionId: String, fingerprint: String?, kind: String) {
    let nonce = Notifier.newNonce()
    let record = PostedRecord(
      sessionId: sessionId, category: d.category.rawValue, fingerprint: fingerprint, nonce: nonce, postedAt: Date(),
      kind: kind)
    Notifier.posted[d.identifier] = record
    saveRecords()
    let id = d.identifier
    poster.post(
      identifier: id, category: d.category.rawValue, title: d.title, subtitle: d.subtitle, body: d.body,
      sound: d.sound, nonce: nonce, thread: sessionId
    ) { ok in
      guard !ok else { return }
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          if Notifier.posted[id]?.nonce == nonce {
            Notifier.posted[id] = nil
            self.saveRecords()
          }
        }
      }
    }
  }

  func remove(_ identifier: String) {
    poster.remove([identifier])
    if Notifier.posted.removeValue(forKey: identifier) != nil { saveRecords() }
  }

  /// A quiet follow-up under the same identifier, with no actions
  private func followUp(_ identifier: String, sessionId: String, title: String, body: String) {
    let d = NotifyRules.Decision(
      identifier: identifier, category: .info, title: title, subtitle: "", body: TextSafety.cap(body, 240),
      sound: false)
    post(d, sessionId: sessionId, fingerprint: nil, kind: "followUp")
  }

  /// New events from the poller, oldest first, with a fresh prompt read
  /// for each "needs you" one
  func consider(_ entries: [NotificationEntry], prompts: [String: PromptReply]) {
    guard let host else { return }
    let snap = host.snapshot
    var states: [String: String] = [:]
    for s in snap.sessions { states[s.id] = s.state }
    let context = NotifyRules.NotifyContext(
      toggles: toggles, windowShowingSession: host.windowShowingSession, appIsActive: host.appIsActive,
      cursor: cursor, handledIds: Set(handled), sessionState: states)
    var newest = cursor
    for e in entries {
      newest = max(newest, e.at)
      if context.handledIds.contains(e.id) || e.at <= cursor { continue }
      handled = NotifyRules.remember(e.id, in: handled)
      guard let sid = e.sessionId else { continue }
      let name = snap.names[sid] ?? Strings.aSession
      guard
        let d = NotifyRules.decide(
          e, context, prompt: prompts[sid], sessionName: name, features: snap.features)
      else { continue }
      // Nothing is recorded that macOS won't show
      guard allowed else { continue }
      let fingerprint = e.kind == "needsYou" ? prompts[sid]?.fingerprint : nil
      post(d, sessionId: sid, fingerprint: fingerprint, kind: e.kind)
    }
    cursor = newest
    defaults.set(NSNumber(value: cursor), forKey: "eventsCursor")
    defaults.set(handled, forKey: "handledIds")
  }

  /// After each poll: a "needs you" post goes once its session stops
  /// waiting, or once the window shows it; a newer prompt is posted again
  func reconcile(_ snap: Snapshot, details: [String: SessionDetails]) {
    let showing = host?.windowShowingSession
    var states: [String: String] = [:]
    for s in snap.sessions { states[s.id] = s.state }
    for (identifier, record) in Notifier.posted where identifier != "s-test" {
      let sid = record.sessionId
      if showing == sid {
        remove(identifier)
        continue
      }
      guard record.kind == "needsYou" else { continue }
      if states[sid] != "waiting" {
        remove(identifier)
        continue
      }
      guard let fresh = details[sid], Date().timeIntervalSince(fresh.at) < 10, let p = fresh.prompt?.prompt,
        let fp = fresh.prompt?.fingerprint, let old = record.fingerprint, fp != old
      else { continue }
      let name = snap.names[sid] ?? Strings.aSession
      let d = NotifyRules.Decision(
        identifier: identifier, category: NotifyRules.category(for: p, features: snap.features),
        title: Strings.notifyNeedsYou(TextSafety.oneLine(TextSafety.clean(name), max: 60)),
        subtitle: "", body: NotifyRules.needsYouBody(p), sound: false)
      post(d, sessionId: sid, fingerprint: fp, kind: "needsYou")
    }
  }

  // MARK: The channel's reads

  func delivered(_ done: @escaping @Sendable ([[String: String]]) -> Void) { poster.delivered(done) }
  func status(_ done: @escaping @Sendable ([String: String]) -> Void) { poster.status(done) }

  func postTest(_ done: @escaping (Bool) -> Void) {
    refreshStatus {
      guard self.allowed else { return done(false) }
      let d = NotifyRules.Decision(
        identifier: "s-test", category: .info, title: Strings.testTitle, subtitle: "", body: Strings.testBody,
        sound: false)
      self.post(d, sessionId: "test", fingerprint: nil, kind: "test")
      done(true)
    }
  }

  // MARK: Responses

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let identifier = notification.request.identifier
    let complete = Unchecked(completionHandler)
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        let sid = Notifier.posted[identifier]?.sessionId
        let quiet = sid != nil && self.host?.keyWindowSession == sid
        complete.value(quiet ? [] : [.banner, .list, .sound])
      }
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let reply = NotificationReply.from(response)
    let complete = Unchecked(completionHandler)
    DispatchQueue.main.async {
      MainActor.assumeIsolated { self.respond(reply) { complete.value() } }
    }
  }

  /// A response to one of our notifications. Ignored unless it is in our
  /// record with the nonce it went out with. `done` runs once any request
  /// has finished.
  func respond(_ r: NotificationReply, done: @escaping () -> Void) {
    guard let record = Notifier.posted[r.identifier], let nonce = r.nonce, nonce == record.nonce else {
      return done()
    }
    if r.actionId == UNNotificationDefaultActionIdentifier {
      if SessionLink.isValidId(record.sessionId) { host?.open(.session(record.sessionId), activate: true) }
      return done()
    }
    guard Notifier.actionIds.contains(r.actionId), let click = Clicks.fromNotification(r, record: record) else {
      return done()
    }
    let identifier = r.identifier
    let action = r.actionId
    let text = r.text
    let name = host?.snapshot.names[record.sessionId] ?? Strings.aSession
    work.async {
      let result = Notifier.act(action, record: record, click: click, text: text)
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          Notifier.log(action, record.sessionId, result.name)
          switch result {
          case .ok:
            self.remove(identifier)
          case .changed:
            self.followUp(identifier, sessionId: record.sessionId, title: Strings.changedTitle, body: Strings.notifyChangedBody)
          default:
            let title = action == "reply" ? Strings.couldntReply(name) : Strings.couldntAnswer(name)
            self.followUp(identifier, sessionId: record.sessionId, title: title, body: result.problem ?? "")
          }
          done()
        }
      }
    }
  }

  /// Off the main thread. Reads the session again and sends only what the
  /// fresh read shows; anything that differs from the post is "changed".
  nonisolated static func act(_ action: String, record: PostedRecord, click: Click, text: String?) -> Outcome {
    let id = record.sessionId
    guard SessionLink.isValidId(id) else { return .error(Strings.errorCode(400)) }
    switch action {
    case "allow", "deny":
      guard let fresh = Backend.prompt(id, timeout: 4) else { return .offline }
      guard let p = fresh.prompt, let fp = fresh.fingerprint, let old = record.fingerprint, fp == old else {
        return .changed
      }
      guard Backend.build()?.answers == true else { return .refused }
      guard !TextSafety.hasUnsafe(p.title + p.detail + p.question) else { return .changed }
      if action == "allow" && NotifyRules.category(for: p, features: true) != .permission { return .changed }
      guard let pick = p.first(action) else { return .changed }
      return Backend.asUser(
        path: "/api/sessions/\(id)/prompt", method: "POST",
        body: ["index": pick.position, "label": pick.option.label, "fingerprint": fp], click: click)
    case "reply":
      let words = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard !words.isEmpty else { return .error(Strings.typeYourReply) }
      guard let statuses = Backend.statuses() else { return .offline }
      guard statuses[id]?.status == "waiting" else { return .changed }
      guard let fresh = Backend.prompt(id, timeout: 4) else { return .offline }
      guard fresh.prompt == nil else { return .changed }
      return Backend.asUser(
        path: "/api/sessions/\(id)/send-keys", method: "POST",
        body: ["text": words, "pressEnter": true, "onlyIfNoPrompt": true], click: click)
    default:
      return .error(Strings.errorCode(400))
    }
  }

  #if SELFTEST
    /// The stub action test: a response as the system would hand it over
    func handleForTest(actionId: String, identifier: String, nonce: String?, text: String?, done: @escaping () -> Void) {
      respond(NotificationReply.forTest(identifier: identifier, nonce: nonce, actionId: actionId, text: text), done: done)
    }
  #endif
}

/// Moves a non-Sendable completion handler to the main queue
struct Unchecked<T>: @unchecked Sendable {
  let value: T
  init(_ value: T) { self.value = value }
}

/// The system's notification center
final class SystemPoster: NotificationPoster {
  private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

  func setUp(delegate: UNUserNotificationCenterDelegate) {
    center.delegate = delegate
    let allow = UNNotificationAction(identifier: "allow", title: Strings.allowOnce, options: [.authenticationRequired])
    let deny = UNNotificationAction(identifier: "deny", title: Strings.deny, options: [.destructive])
    let reply = UNTextInputNotificationAction(
      identifier: "reply", title: Strings.replyMenu, options: [], textInputButtonTitle: Strings.send,
      textInputPlaceholder: Strings.typeYourReply)
    center.setNotificationCategories([
      UNNotificationCategory(identifier: "PERMISSION", actions: [allow, deny], intentIdentifiers: []),
      UNNotificationCategory(identifier: "PERMISSION_DENY", actions: [deny], intentIdentifiers: []),
      UNNotificationCategory(identifier: "FINISHED", actions: [reply], intentIdentifiers: []),
      UNNotificationCategory(identifier: "INFO", actions: [], intentIdentifiers: []),
    ])
  }

  func post(
    identifier: String, category: String, title: String, subtitle: String, body: String, sound: Bool,
    nonce: String, thread: String, done: @escaping @Sendable (Bool) -> Void
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.subtitle = subtitle
    content.body = body
    content.categoryIdentifier = category
    content.threadIdentifier = thread
    content.userInfo = ["nonce": nonce]
    content.interruptionLevel = .active
    if sound { content.sound = .default }
    center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil)) { error in
      done(error == nil)
    }
  }

  func remove(_ identifiers: [String]) {
    center.removeDeliveredNotifications(withIdentifiers: identifiers)
    center.removePendingNotificationRequests(withIdentifiers: identifiers)
  }

  func delivered(_ done: @escaping @Sendable ([[String: String]]) -> Void) {
    let center = self.center
    center.getDeliveredNotifications { shown in
      let a = shown.map { n -> [String: String] in
        let c = n.request.content
        return ["id": n.request.identifier, "category": c.categoryIdentifier, "title": c.title, "subtitle": c.subtitle]
      }
      center.getPendingNotificationRequests { pending in
        let b = pending.map { r -> [String: String] in
          ["id": r.identifier, "category": r.content.categoryIdentifier, "title": r.content.title,
           "subtitle": r.content.subtitle]
        }
        done(a + b)
      }
    }
  }

  func status(_ done: @escaping @Sendable ([String: String]) -> Void) {
    center.getNotificationSettings { s in
      func auth(_ a: UNAuthorizationStatus) -> String {
        switch a {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "unknown"
        }
      }
      func setting(_ v: UNNotificationSetting) -> String {
        switch v {
        case .enabled: return "enabled"
        case .disabled: return "disabled"
        case .notSupported: return "notSupported"
        @unknown default: return "unknown"
        }
      }
      done([
        "authorization": auth(s.authorizationStatus), "alert": setting(s.alertSetting),
        "sound": setting(s.soundSetting), "badge": setting(s.badgeSetting),
      ])
    }
  }

  func requestAuthorization(_ done: @escaping @Sendable (Bool) -> Void) {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in done(ok) }
  }
}
