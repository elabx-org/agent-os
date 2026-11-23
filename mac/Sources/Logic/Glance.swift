import Foundation

/// One session in the watch panel or under quick ask: it needs the person,
/// or it is working
struct GlanceRow: Equatable {
  var id: String
  var name: String
  /// waiting or running
  var state: String
  /// What it asks, or the last line it printed
  var line: String
}

/// One session's project and when the session was last active
struct ProjectUse: Equatable {
  var projectId: String
  var at: String
}

/// What the watch panel, quick ask and the Dock menu show, worked out from
/// what the menu bar already knows. Nothing here sends anything.
enum Glance {
  static let maxRows = 6
  static let nameWidth = 40
  static let lineWidth = 90

  static func name(_ raw: String) -> String { TextSafety.oneLine(TextSafety.clean(raw), max: nameWidth) }

  /// What a waiting session wants, in one line
  static func asks(_ s: MenuSession) -> String {
    func one(_ text: String) -> String { TextSafety.oneLine(TextSafety.clean(text), max: lineWidth) }
    if let p = s.prompt?.prompt {
      let what = p.description.split(separator: "\n").first.map(String.init) ?? ""
      if !p.title.isEmpty && !what.isEmpty { return one(p.title + ": " + what) }
      if !p.question.isEmpty { return one(p.question) }
      if !p.title.isEmpty { return one(p.title) }
    }
    if let c = s.context {
      if c.kind == "ask", let q = c.questions?.first?.question, !q.isEmpty { return one(q) }
      if let q = c.question, !q.isEmpty { return one(q) }
      if let e = c.excerpt, !e.isEmpty { return one(e) }
    }
    return Strings.stateWord("waiting")
  }

  /// Sessions that need the person first, then the working ones; idle ones
  /// are left out. `more` counts what didn't fit.
  static func rows(_ sessions: [MenuSession], max: Int = maxRows) -> (rows: [GlanceRow], more: Int) {
    var out: [GlanceRow] = []
    for s in sessions where s.state == "waiting" {
      out.append(GlanceRow(id: s.id, name: name(s.name), state: s.state, line: asks(s)))
    }
    for s in sessions where s.state == "running" {
      let line = s.lastLine.map { TextSafety.oneLine(TextSafety.clean($0), max: lineWidth) } ?? ""
      out.append(
        GlanceRow(id: s.id, name: name(s.name), state: s.state, line: line.isEmpty ? Strings.stateWord("running") : line))
    }
    let valid = out.filter { SessionLink.isValidId($0.id) }
    return (Array(valid.prefix(max)), Swift.max(0, valid.count - max))
  }

  /// The projects worked in most recently, newest first: the named ones
  /// with a session, then (when none has one) the first by name
  static func recent(_ projects: [Project], uses: [ProjectUse], max: Int = 3) -> [Project] {
    let named = projects.filter { !$0.uncategorized }
    var latest: [String: String] = [:]
    for use in uses where use.at > (latest[use.projectId] ?? "") { latest[use.projectId] = use.at }
    let used = named.filter { latest[$0.id] != nil }.sorted {
      let a = latest[$0.id] ?? ""
      let b = latest[$1.id] ?? ""
      return a == b ? $0.name < $1.name : a > b
    }
    if !used.isEmpty { return Array(used.prefix(max)) }
    return Array(named.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }.prefix(max))
  }

  // MARK: Dock menu

  enum DockAction: Equatable {
    case open(id: String)
    case newIn(projectId: String)
    case newSession
    case all
    case watch
  }

  struct DockEntry: Equatable {
    var title: String
    var action: DockAction?
    var checked = false

    static let separator = DockEntry(title: "", action: nil)
    var isSeparator: Bool { title.isEmpty && action == nil }
  }

  /// The Dock icon's menu: who needs the person, who is working, a new chat
  /// in a recent project. It only opens things; it never answers.
  static func dock(sessions: [MenuSession], recent: [Project], watching: Bool) -> [DockEntry] {
    var out: [DockEntry] = []
    let glance = rows(sessions, max: 8).rows
    for row in glance {
      out.append(DockEntry(title: Strings.sessionRow(row.name, row.state), action: .open(id: row.id)))
    }
    if !out.isEmpty { out.append(.separator) }
    for p in recent {
      out.append(DockEntry(title: Strings.dockNewIn(name(p.name)), action: .newIn(projectId: p.id)))
    }
    out.append(DockEntry(title: Strings.newSession, action: .newSession))
    out.append(.separator)
    out.append(DockEntry(title: Strings.allSessionsMenu, action: .all))
    out.append(DockEntry(title: Strings.watchPanelMenu, action: .watch, checked: watching))
    return out
  }
}

/// Files and folders dropped on the Dock icon: they become the start of a
/// task the person still has to read and start themselves
enum Drops {
  static let maxPaths = 5
  static let maxLength = 1024

  /// Absolute paths without hidden characters, with the home folder as ~
  static func shown(_ paths: [String], home: String) -> [String] {
    paths.compactMap { raw -> String? in
      guard raw.hasPrefix("/"), raw.utf8.count <= maxLength, !TextSafety.hasUnsafe(raw), !raw.contains("\n") else {
        return nil
      }
      if raw == home { return "~" }
      if raw.hasPrefix(home + "/") { return "~" + String(raw.dropFirst(home.count)) }
      return raw
    }
  }

  /// "About ~/a/File.swift and ~/b: ", or nothing when no path is usable
  static func task(_ paths: [String], home: String) -> String {
    let list = shown(paths, home: home)
    guard !list.isEmpty else { return "" }
    let first = Array(list.prefix(maxPaths))
    return Strings.dropAbout(first, more: list.count - first.count)
  }

  /// The project whose folder holds `path` (the deepest one)
  static func project(for path: String, in projects: [Project], home: String) -> Project? {
    func full(_ folder: String) -> String {
      var f = folder
      if f == "~" { f = home } else if f.hasPrefix("~/") { f = home + String(f.dropFirst(1)) }
      while f.count > 1 && f.hasSuffix("/") { f.removeLast() }
      return f
    }
    var best: (Project, Int)?
    for p in projects where !p.uncategorized {
      let folder = full(p.working_directory)
      guard folder.hasPrefix("/"), folder.count > 1 else { continue }
      guard path == folder || path.hasPrefix(folder + "/") else { continue }
      if best == nil || folder.count > best!.1 { best = (p, folder.count) }
    }
    return best?.0
  }
}

/// The shortcut that opens quick ask from any app. Space with modifiers, so
/// it never takes a plain key away from typing.
enum QuickKey: String, CaseIterable, Equatable {
  case optionSpace, controlOptionSpace, shiftOptionSpace, off

  static let defaultsKey = "quickAskKey"

  static func stored(_ raw: String?) -> QuickKey { raw.flatMap(QuickKey.init(rawValue:)) ?? .optionSpace }

  var title: String {
    switch self {
    case .optionSpace: return "⌥Space"
    case .controlOptionSpace: return "⌃⌥Space"
    case .shiftOptionSpace: return "⇧⌥Space"
    case .off: return Strings.quickKeyOff
    }
  }

  /// The space bar
  var keyCode: UInt32 { 49 }

  /// Carbon's modifier bits: shift 0x200, option 0x800, control 0x1000
  var modifiers: UInt32 {
    switch self {
    case .optionSpace: return 0x800
    case .controlOptionSpace: return 0x800 | 0x1000
    case .shiftOptionSpace: return 0x800 | 0x200
    case .off: return 0
    }
  }
}
