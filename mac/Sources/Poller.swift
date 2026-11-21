import Foundation

/// Reads this Mac's AgentOS every 5 s (3 s while the window says it is
/// down) on a background queue and hands each Snapshot to its observers on
/// the main thread. Its timer runs in the common modes, so it keeps going
/// while a menu is open.
@MainActor
final class Poller {
  private let queue = DispatchQueue(label: "agentos.poller")
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
        self.snapshot = next
        self.inFlight = false
        for observer in self.observers { observer(next) }
        if self.again {
          self.again = false
          self.refreshNow()
        }
      }
    }
  }
}
