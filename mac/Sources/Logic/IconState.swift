import Foundation

/// What the menu bar icon shows
enum IconState: Equatable {
  case notInstalled, off, starting, updating, notAnswering
  case needsYou(Int)
  case working(Int)
  case idle

  /// How long AgentOS may be silent before "starting" turns into "not answering"
  static let startingGrace: TimeInterval = 20

  /// Precedence: not installed, off (service not loaded), updating (lock),
  /// starting (down under 20 s), not answering, needs you, working, idle
  static func derive(
    installed: Bool, answering: Bool, serviceLoaded: Bool, updating: Bool, downFor: TimeInterval,
    waiting: Int, running: Int
  ) -> IconState {
    if !installed { return .notInstalled }
    if !serviceLoaded { return .off }
    if updating { return .updating }
    if !answering { return downFor < startingGrace ? .starting : .notAnswering }
    if waiting > 0 { return .needsYou(waiting) }
    if running > 0 { return .working(running) }
    return .idle
  }

  /// The link to the server is down (from link-state.json)
  static func linkDown(_ status: String?) -> Bool {
    guard let status else { return false }
    return ["offline", "connecting", "pending", "refused", "signin"].contains(status)
  }

  var name: String {
    switch self {
    case .notInstalled: return "notInstalled"
    case .off: return "off"
    case .starting: return "starting"
    case .updating: return "updating"
    case .notAnswering: return "notAnswering"
    case .needsYou: return "needsYou"
    case .working: return "working"
    case .idle: return "idle"
    }
  }

  var count: Int {
    switch self {
    case .needsYou(let n), .working(let n): return n
    default: return 0
    }
  }

  /// Every look, for tests and captures
  static let samples: [IconState] = [
    .notInstalled, .off, .starting, .updating, .notAnswering, .needsYou(2), .working(1), .idle,
  ]
}
