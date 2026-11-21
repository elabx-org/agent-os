import Foundation

/// A waiting or working session's prompt and reply context, as last read
struct SessionDetails {
  var prompt: PromptReply?
  var context: ReplyContext?
  var at: Date
}

/// Reads this Mac's AgentOS every 5 s (3 s while the window says it is
/// down) on a background queue and hands each Snapshot to its observers on
/// the main thread. Its timer runs in the common modes, so it keeps going
/// while a menu is open. A second loop reads new events every 4 s (15 s
/// while AgentOS doesn't answer) for the notifications, and session details
/// are read on demand, cached for 3 s.
@MainActor
final class Poller {
  private let queue = DispatchQueue(label: "agentos.poller")
  private let eventsQueue = DispatchQueue(label: "agentos.poller.events")
  private let detailsQueue = DispatchQueue(label: "agentos.poller.details", attributes: .concurrent)
  private(set) var details: [String: SessionDetails] = [:]
  private var detailsInFlight: Set<String> = []
  private var detailsWaiters: [() -> Void] = []
  private var eventsTimer: Timer?
  private var eventsInFlight = false
  private var eventsSlow = false
  /// New events, with a fresh prompt read for each "needs you" one
  var onEvents: (([NotificationEntry], [String: PromptReply]) -> Void)?
  /// Where the events loop reads from (ms)
  var eventsSince: () -> Int64 = { 0 }
  /// Details arrived (the menu redraws)
  var onDetails: (() -> Void)?
  private(set) var snapshot = Snapshot()
  private var observers: [(Snapshot) -> Void] = []
  private var timer: Timer?
  private var inFlight = false
  private var again = false

  /// Poll every 3 s instead of 5 (the offline view is up)
  var fast = false {
    didSet { if fast != oldValue { schedule() } }
  }

  func observe(_ observer: @escaping (Snapshot) -> Void) { observers.append(observer) }

  func start() {
    schedule()
    refreshNow()
    scheduleEvents()
  }

  private func scheduleEvents() {
    eventsTimer?.invalidate()
    let t = Timer(timeInterval: eventsSlow ? 15 : 4, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.readEvents() }
    }
    t.tolerance = 0.5
    RunLoop.main.add(t, forMode: .common)
    eventsTimer = t
  }

  func readEvents() {
    guard !eventsInFlight, onEvents != nil else { return }
    eventsInFlight = true
    let since = eventsSince()
    eventsQueue.async { [weak self] in
      let list = Backend.decode(NotificationList.self, "/api/notifications?since=\(since)")
      let entries = (list?.items ?? []).sorted { $0.at < $1.at }
      var prompts: [String: PromptReply] = [:]
      for e in entries where e.kind == "needsYou" {
        guard let id = e.sessionId, prompts[id] == nil, let reply = Backend.prompt(id) else { continue }
        prompts[id] = reply
      }
      let answered = list != nil
      DispatchQueue.main.async {
        guard let self else { return }
        self.eventsInFlight = false
        if self.eventsSlow == answered {
          self.eventsSlow = !answered
          self.scheduleEvents()
        }
        for (id, reply) in prompts {
          self.details[id] = SessionDetails(prompt: reply, context: self.details[id]?.context, at: Date())
        }
        if !entries.isEmpty { self.onEvents?(entries, prompts) }
      }
    }
  }

  /// Reads the prompt and reply context of these sessions (2 s timeout
  /// each, off the main thread) unless read in the last 3 s
  func fetchDetails(_ ids: [String], then: (() -> Void)? = nil) {
    let now = Date()
    let want = ids.filter {
      SessionLink.isValidId($0) && !detailsInFlight.contains($0)
        && (details[$0].map { now.timeIntervalSince($0.at) >= 3 } ?? true)
    }
    if let then { detailsWaiters.append(then) }
    guard !want.isEmpty else {
      if detailsInFlight.isEmpty { flushWaiters() }
      return
    }
    detailsInFlight.formUnion(want)
    for id in want {
      detailsQueue.async { [weak self] in
        let prompt = Backend.prompt(id)
        let context = Backend.replyContext(id)
        DispatchQueue.main.async {
          guard let self else { return }
          self.detailsInFlight.remove(id)
          self.details[id] = SessionDetails(prompt: prompt, context: context, at: Date())
          if self.detailsInFlight.isEmpty {
            self.onDetails?()
            self.flushWaiters()
          }
        }
      }
    }
  }

  private func flushWaiters() {
    let waiters = detailsWaiters
    detailsWaiters = []
    for w in waiters { w() }
  }

  private func schedule() {
    timer?.invalidate()
    let t = Timer(timeInterval: fast ? 3 : 5, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.refreshNow() }
    }
    t.tolerance = 0.5
    RunLoop.main.add(t, forMode: .common)
    timer = t
  }

  func refreshNow() {
    guard !inFlight else {
      again = true
      return
    }
    inFlight = true
    let downSince = snapshot.facts.answering ? nil : snapshot.facts.downSince
    queue.async { [weak self] in
      let next = Backend.snapshot(downSince: downSince)
      DispatchQueue.main.async {
        guard let self else { return }
        let wasWaiting = Set(self.snapshot.sessions.filter { $0.state == "waiting" }.map(\.id))
        self.snapshot = next
        self.inFlight = false
        let live = Set(next.sessions.map(\.id))
        self.details = self.details.filter { live.contains($0.key) }
        // A session that just turned "waiting": read what it asks
        let newly = next.sessions.filter { $0.state == "waiting" && !wasWaiting.contains($0.id) }.map(\.id)
        if !newly.isEmpty { self.fetchDetails(newly) }
        for observer in self.observers { observer(next) }
        if self.again {
          self.again = false
          self.refreshNow()
        }
      }
    }
  }
}
