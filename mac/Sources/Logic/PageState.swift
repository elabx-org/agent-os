import Foundation

/// What the window's toolbar sends the page: one of these words, nothing
/// else (the page's "agentos-mac" event, lib/mac-host.ts)
enum PageAction: String, CaseIterable, Equatable {
  case chat, changes, terminal, files, agents, sidebar, inspector, find, new, settings, all, preview
}

/// What the page says is in front (window.__agentosMac), read by the
/// window for its toolbar. It comes from the page, so it only ever decides
/// what the toolbar shows: every text is cleaned and capped, the session id
/// must look like one, and a view must be one the toolbar knows.
struct PageState: Equatable {
  var session: String?
  var title: String
  var detail: String
  var view: PageAction?
  var changes: Int
  var agents: Bool
  var sidebar: Bool
  var inspector: Bool
  var dark: Bool
  var needs: Int

  static let views: [PageAction] = [.chat, .changes, .terminal, .files, .agents, .preview]

  /// nil for no state, a state this app doesn't know, or anything malformed
  static func parse(_ json: String?) -> PageState? {
    guard let json, json.utf8.count <= 4096, let data = json.data(using: .utf8),
      let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      (raw["v"] as? Int) == 1
    else { return nil }
    func text(_ key: String, _ max: Int) -> String {
      TextSafety.oneLine(TextSafety.clean((raw[key] as? String) ?? ""), max: max)
    }
    func count(_ key: String) -> Int { min(max((raw[key] as? Int) ?? 0, 0), 9999) }
    let id = (raw["session"] as? String).flatMap { SessionLink.isValidId($0) ? $0 : nil }
    let view = (raw["view"] as? String).flatMap(PageAction.init(rawValue:)).flatMap { views.contains($0) ? $0 : nil }
    return PageState(
      session: id, title: text("title", 80), detail: text("detail", 120), view: id == nil ? nil : view,
      changes: id == nil ? 0 : count("changes"), agents: id != nil && (raw["agents"] as? Bool) == true,
      sidebar: (raw["sidebar"] as? Bool) == true, inspector: (raw["inspector"] as? Bool) == true,
      dark: (raw["dark"] as? Bool) == true, needs: count("needs"))
  }
}

/// The toolbar, worked out from the page's state
enum ToolbarModel {
  struct Tab: Equatable {
    let action: PageAction
    let label: String
  }

  /// The view tabs for the session in front; none without one
  static func tabs(_ state: PageState?) -> [Tab] {
    guard let state, state.session != nil else { return [] }
    var out = [
      Tab(action: .chat, label: Strings.tabChat),
      Tab(action: .changes, label: Strings.tabChanges(state.changes)),
      Tab(action: .terminal, label: Strings.tabTerminal),
      Tab(action: .files, label: Strings.tabFiles),
      Tab(action: .preview, label: Strings.tabPreview),
    ]
    if state.agents || state.view == .agents { out.append(Tab(action: .agents, label: Strings.tabAgents)) }
    return out
  }

  static func selected(_ state: PageState?) -> Int? {
    guard let view = state?.view else { return nil }
    return tabs(state).firstIndex { $0.action == view }
  }

  /// The window's title and the line under it
  static func title(_ state: PageState?, pageTitle: String?) -> (title: String, subtitle: String) {
    guard let state, !state.title.isEmpty else { return (Strings.windowTitle(pageTitle), "") }
    return (state.title, state.detail)
  }
}

/// "Open in": the session's folder, as this Mac's AgentOS gives it
enum OpenIn {
  enum App: String, CaseIterable {
    case finder, xcode, terminal

    var bundleId: String {
      switch self {
      case .finder: return "com.apple.finder"
      case .xcode: return "com.apple.dt.Xcode"
      case .terminal: return "com.apple.Terminal"
      }
    }

    var title: String {
      switch self {
      case .finder: return Strings.openInFinder
      case .xcode: return Strings.openInXcode
      case .terminal: return Strings.openInTerminal
      }
    }
  }

  /// The folder of session `id` in GET /api/sessions's rows: its worktree,
  /// else its working folder, with ~ as `home`. nil when the session isn't
  /// listed or the path isn't an absolute one.
  static func folder(of id: String, in rows: [[String: Any]], home: String) -> String? {
    guard SessionLink.isValidId(id), let row = rows.first(where: { ($0["id"] as? String) == id }) else { return nil }
    let raw = [row["worktree_path"], row["working_directory"]].compactMap { $0 as? String }.first { !$0.isEmpty }
    guard var path = raw, !TextSafety.hasUnsafe(path), path.utf8.count <= 1024 else { return nil }
    if path == "~" { path = home } else if path.hasPrefix("~/") { path = home + String(path.dropFirst(1)) }
    guard path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { return nil }
    return path
  }

  /// What Xcode should open in `folder`: its one workspace or project when
  /// it has exactly one at the top, else the folder itself
  static func xcodeTarget(folder: String, entries: [String]) -> String {
    for ext in [".xcworkspace", ".xcodeproj"] {
      let found = entries.filter { $0.hasSuffix(ext) && !$0.hasPrefix(".") }.sorted()
      if found.count == 1 { return folder + (folder.hasSuffix("/") ? "" : "/") + found[0] }
      if found.count > 1 { return folder }
    }
    return folder
  }
}
