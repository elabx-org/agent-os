import Foundation

/// What `agentos-uninstall.sh --json` prints, before (a plan) and after (with
/// `done`) a run. Every field may be missing: a refusal has only `refused`.
struct UninstallPlan: Codable, Equatable {
  struct Item: Codable, Equatable {
    var what: String
    var path: String?
    var size: String?
  }
  struct Session: Codable, Equatable {
    var id: String
    var name: String
    var tmux: String?
    var stop: Bool?
  }
  struct Worktree: Codable, Equatable {
    var name: String
    var path: String?
    var keep: Bool
    var why: String?
    var to: String?
  }
  struct Left: Codable, Equatable {
    var path: String
    var reason: String
  }
  struct Done: Codable, Equatable {
    var stopped: Int
    var kept: Int
    var removed: [String]?
    var left: [Left]?
  }

  var refused: String?
  var machine: String?
  var hub: String?
  var goes: [Item]?
  var stays: [Item]?
  var sessions: [Session]?
  var worktrees: [Worktree]?
  var kept: String?
  var repos: String?
  var warnings: [String]?
  var done: Done?

  static func decode(_ data: Data) -> UninstallPlan? { try? JSONDecoder().decode(UninstallPlan.self, from: data) }
}

/// The uninstall alerts' text (pure): the same blocks as the command's plan
enum UninstallText {
  static func tilde(_ path: String, home: String) -> String {
    if path == home { return "~" }
    if path.hasPrefix(home + "/") { return "~" + path.dropFirst(home.count) }
    return path
  }

  /// The alert asking first: title and body
  static func dialogText(_ plan: UninstallPlan, home: String) -> (title: String, body: String) {
    let t = { (p: String) in tilde(p, home: home) }
    var lines: [String] = []
    let machine = TextSafety.oneLine(TextSafety.clean(plan.machine ?? ""), max: 60)
    lines.append(machine.isEmpty ? "AgentOS will be removed from this Mac." : "AgentOS will be removed from this Mac (\(machine)).")
    lines.append("")
    lines.append("These go:")
    var tools = false
    for item in plan.goes ?? [] {
      let path = item.path.map(t) ?? ""
      switch item.what {
      case "AgentOS and its updates":
        lines.append("  • AgentOS and its updates (\(path)\(item.size.map { ", " + $0 } ?? ""))")
      case "Its list of sessions, settings, logs, saved checkpoints and handoffs":
        lines.append("  • \(item.what) (\(path))")
      case "The agent-os command":
        lines.append("  • The agent-os command (\(path))")
      case "The menu bar app and its window settings":
        lines.append("  • The menu bar app (\(path)) and its window settings")
      case "Starting AgentOS at login":
        lines.append("  • Starting AgentOS at login")
      default:
        if item.what.hasPrefix("The key that links this Mac to ") {
          lines.append("  • \(TextSafety.oneLine(TextSafety.clean(item.what), max: 120)) (in your Keychain)")
        } else if item.what.hasPrefix("AgentOS's tools in ") {
          if !tools { lines.append("  • AgentOS's tools in Codex and Gemini") }
          tools = true
        }
      }
    }
    let sessions = plan.sessions ?? []
    if !sessions.isEmpty {
      lines.append("")
      lines.append("Running sessions, stopped (their conversations stay in Claude):")
      for s in sessions { lines.append("  • " + TextSafety.oneLine(TextSafety.clean(s.name), max: 60)) }
    }
    let kept = (plan.worktrees ?? []).filter(\.keep)
    if !kept.isEmpty {
      lines.append("")
      lines.append("Worktrees with work not yet pushed, kept in \(t(plan.kept ?? "~/AgentOS/Kept from AgentOS")):")
      for w in kept {
        let why = w.why.map { " (\($0))" } ?? ""
        lines.append("  • " + TextSafety.oneLine(TextSafety.clean(w.name), max: 60) + why)
      }
    }
    let removed = (plan.worktrees ?? []).filter { !$0.keep }
    if !removed.isEmpty {
      lines.append("")
      lines.append("Worktrees with nothing unsaved, removed (their branches stay in the repository):")
      for w in removed { lines.append("  • " + TextSafety.oneLine(TextSafety.clean(w.name), max: 60)) }
    }
    lines.append("")
    lines.append("These stay:")
    lines.append("  • Your repositories (\(t(plan.repos ?? home + "/AgentOS"))) and everything in them")
    lines.append("  • Claude's conversations and settings (~/.claude and ~/.claude.json)")
    lines.append("  • Homebrew, Node and tmux")
    lines.append("  • This app's entry in System Settings, Notifications")
    lines.append("")
    lines.append("Your server still lists this Mac. Remove it there afterwards: AgentOS on your phone, Settings, Machines.")
    return (Strings.uninstallTitle, lines.joined(separator: "\n"))
  }

  /// After a run that removed everything
  static func doneText(_ result: UninstallPlan, home: String) -> (title: String, body: String) {
    var body = Strings.uninstallDoneBody
    if (result.done?.kept ?? 0) > 0 {
      body += " " + Strings.workKeptIn(tilde(result.kept ?? home + "/AgentOS/Kept from AgentOS", home: home))
    }
    return (Strings.uninstallDoneTitle, body)
  }

  /// After a run that left something behind
  static func partlyText(_ result: UninstallPlan?, home: String, fallback: String) -> (title: String, body: String) {
    var left = (result?.done?.left ?? []).map { (tilde($0.path, home: home), $0.reason) }
    if left.isEmpty { left = [("~/.agent-os", fallback)] }
    return (Strings.partlyTitle, Strings.partlyBody(left))
  }

  /// The command's message for a refusal
  static func refusal(_ code: String?) -> String {
    switch code {
    case "hub": return Strings.refusedHub
    case "root": return Strings.refusedRoot
    case "notInstalled": return Strings.refusedNotInstalled
    case "inSession": return Strings.refusedInSession
    case "home": return Strings.refusedHome
    default: return Strings.cantFindUninstaller
    }
  }
}
