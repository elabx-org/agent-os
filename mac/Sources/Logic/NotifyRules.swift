import Foundation

/// Which events from this Mac's AgentOS become a notification, in which
/// category, with what text. Titles are built here, never taken from the
/// event, so a session can't write its own notification title.
enum NotifyRules {
  struct Toggles: Equatable {
    var needsYou = true
    var finished = true
    var limited = true
  }

  struct NotifyContext {
    var toggles: Toggles
    var windowShowingSession: String?
    var appIsActive: Bool
    /// Events at or before this (ms) were seen already
    var cursor: Int64
    var handledIds: Set<String>
    /// Session id → waiting, running or idle
    var sessionState: [String: String]
  }

  enum Category: String {
    case permission = "PERMISSION"
    case permissionDenyOnly = "PERMISSION_DENY"
    case finished = "FINISHED"
    case info = "INFO"
  }

  struct Decision: Equatable {
    let identifier: String
    let category: Category
    let title: String
    let subtitle: String
    let body: String
    let sound: Bool
  }

  static let fullAccessPrefix = "Full access switched on"
  static let bodyLimit = 240
  /// A cold start looks back this far (ms)
  static let lookBack: Int64 = 120_000
  static let keepHandled = 200

  static func identifier(_ sessionId: String) -> String { "s-\(sessionId)" }

  /// "Allow once" only when the whole prompt fits two lines of 90 and holds
  /// nothing unsafe; Deny whenever there is a deny option
  static func category(for p: PermissionPrompt?, features: Bool) -> Category {
    guard features, let p else { return .info }
    let hasDeny = p.options.contains { $0.kind == "deny" }
    let hasAllow = p.options.contains { $0.kind == "allow" }
    // The command can be in description (current Claude Code) or detail
    let text = [p.title, p.description, p.detail, p.question].filter { !$0.isEmpty }.joined(separator: " ")
    if hasAllow && hasDeny && !TextSafety.hasUnsafe(p.shownText)
      && !MenuModel.serverCut(p.description) && !MenuModel.serverCut(p.detail)
      && !TextSafety.wrap(text, width: 90, maxLines: 2).cut
    {
      return .permission
    }
    return hasDeny ? .permissionDenyOnly : .info
  }

  /// The title, then what will run (description and detail), then the question
  static func needsYouBody(_ p: PermissionPrompt) -> String {
    let runs = p.whatRuns.components(separatedBy: "\n").prefix(3).joined(separator: "\n")
    return TextSafety.cap(TextSafety.clean(p.title + ": " + runs + "\n" + p.question), bodyLimit)
  }

  static func decide(
    _ e: NotificationEntry, _ c: NotifyContext, prompt: PromptReply?, sessionName: String, features: Bool
  ) -> Decision? {
    if e.at <= c.cursor || c.handledIds.contains(e.id) { return nil }
    guard let sid = e.sessionId, SessionLink.isValidId(sid) else { return nil }
    if c.appIsActive && c.windowShowingSession == sid { return nil }
    let id = identifier(sid)
    let subtitle = TextSafety.oneLine(TextSafety.clean(e.projectName ?? ""), max: 80)
    let name = TextSafety.oneLine(TextSafety.clean(sessionName), max: 60)
    let plainBody = TextSafety.cap(TextSafety.clean(e.body), bodyLimit)

    switch e.kind {
    case "needsYou":
      guard c.toggles.needsYou, let p = prompt?.prompt else { return nil }
      return Decision(
        identifier: id, category: category(for: p, features: features), title: Strings.notifyNeedsYou(name),
        subtitle: subtitle, body: needsYouBody(p), sound: true)
    case "finished":
      if e.title.hasPrefix(fullAccessPrefix) {
        // A safety signal: always, whatever the toggles say
        return Decision(
          identifier: id, category: .info, title: Strings.notifyFullAccess(name), subtitle: subtitle,
          body: plainBody, sound: true)
      }
      guard c.toggles.finished, c.sessionState[sid] != "running" else { return nil }
      return Decision(
        identifier: id, category: .finished, title: Strings.notifyFinished(name), subtitle: subtitle,
        body: plainBody, sound: false)
    case "limited":
      guard c.toggles.limited else { return nil }
      return Decision(
        identifier: id, category: .info, title: Strings.notifyLimited(name), subtitle: subtitle, body: plainBody,
        sound: false)
    case "agentNeedsYou":
      guard c.toggles.needsYou else { return nil }
      return Decision(
        identifier: id, category: .info, title: Strings.notifyAgentNeedsYou, subtitle: subtitle, body: plainBody,
        sound: true)
    default:
      // agentFinished, resumed, settled, fromMachine, test and anything new
      return nil
    }
  }

  /// The cursor at launch: the stored one, unless missing or older than two
  /// minutes, which becomes now − 120 s
  static func startCursor(stored: Int64?, nowMs: Int64) -> Int64 {
    guard let stored, stored >= nowMs - lookBack else { return nowMs - lookBack }
    return stored
  }

  /// The last 200 handled ids, oldest first
  static func remember(_ id: String, in list: [String]) -> [String] {
    var out = list.filter { $0 != id }
    out.append(id)
    return Array(out.suffix(keepHandled))
  }
}
