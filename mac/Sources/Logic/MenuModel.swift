import Foundation

/// One session as the menu knows it. `prompt` is nil until it has been
/// read; a read that found no prompt is a PromptReply with `prompt` nil.
struct MenuSession: Equatable {
  var id: String
  var name: String
  /// waiting, running or idle
  var state: String
  var lastLine: String?
  var prompt: PromptReply?
  var context: ReplyContext?
}

struct MenuSnapshot: Equatable {
  var on = true
  var sessions: [MenuSession] = []
  /// The server lists all three answer features (BuildInfo.answers)
  var features = false
}

struct MenuEntry: Equatable {
  enum Style: String { case plain, bold, secondary, mono, separator }

  var title: String
  var style: Style = .plain
  var enabled = true
  /// "1"…"9" with ⌘, or nil
  var keyEquivalent: String?
  var action: MenuAction?
  var tooltip: String?
  var children: [MenuEntry] = []
  /// A checkmark (the Notifications toggles)
  var checked = false

  static let separator = MenuEntry(title: "", style: .separator, enabled: false)
  static func label(_ title: String, _ style: Style = .plain) -> MenuEntry {
    MenuEntry(title: title, style: style, enabled: false)
  }
}

/// The session part of the status menu, and the Notifications submenu, as
/// data: the menu draws these, `dump-menu` prints them and the tests read them.
enum MenuModel {
  static let maxRows = 12
  static let detailWidth = 70
  static let detailLines = 12
  static let questionLines = 3
  /// lib/permission-prompt.ts MAX_DETAIL: the server cuts a longer detail
  /// to this many UTF-16 units and adds "…"
  static let serverDetailLimit = 600

  /// A detail the server cut short (so the screen holds more than it sent)
  static func serverCut(_ detail: String) -> Bool {
    detail.hasSuffix("…") && detail.utf16.count > serverDetailLimit
  }

  static func build(_ s: MenuSnapshot) -> [MenuEntry] {
    guard s.on else { return [] }
    var out: [MenuEntry] = [.label(s.sessions.isEmpty ? Strings.noSessions : Strings.sessionsHere)]
    for session in s.sessions.prefix(maxRows) {
      out.append(
        MenuEntry(
          title: Strings.sessionRow(TextSafety.oneLine(TextSafety.clean(session.name), max: 60), session.state), action: .open(id: session.id),
          children: children(session, features: s.features)))
    }
    if s.sessions.count > maxRows {
      out.append(MenuEntry(title: Strings.andMore(s.sessions.count - maxRows), action: .openHome))
    }
    out.append(MenuEntry(title: Strings.newSessionMenu, action: .openPanel(.newSession)))
    return out
  }

  static func children(_ s: MenuSession, features: Bool) -> [MenuEntry] {
    let open = MenuEntry(title: Strings.openInWindow, action: .open(id: s.id))
    let end = MenuEntry(title: Strings.endSession, action: .stop(id: s.id))
    let reply = MenuEntry(
      title: Strings.replyMenu, enabled: features,
      action: .openPanel(.reply(id: s.id, name: s.name)))
    switch s.state {
    case "waiting":
      if let p = s.prompt?.prompt { return promptEntries(s, p, fingerprint: s.prompt?.fingerprint, features: features) }
      if let c = s.context, c.kind == "ask", c.onScreen == true, let questions = c.questions, !questions.isEmpty {
        return askEntries(s, questions, features: features)
      }
      // Not read yet: nothing that types
      guard s.prompt != nil else { return [open, end] }
      return plainEntries(s, features: features) + [.separator, open, end]
    case "running":
      var out: [MenuEntry] = []
      if let line = s.lastLine.map({ TextSafety.oneLine(TextSafety.clean($0), max: 80) }), !line.isEmpty {
        out += [.label(line, .secondary), .separator]
      }
      // Esc would cancel a permission prompt without proof: never offered then
      if s.prompt?.prompt == nil { out.append(MenuEntry(title: Strings.stopWhatItsDoing, action: .interrupt(id: s.id))) }
      return out + [open, end]
    default:
      return [open, reply, end]
    }
  }

  static func promptEntries(_ s: MenuSession, _ p: PermissionPrompt, fingerprint: String?, features: Bool)
    -> [MenuEntry]
  {
    var out: [MenuEntry] = [.label(TextSafety.oneLine(TextSafety.clean(p.title), max: detailWidth), .bold)]
    if !p.description.isEmpty {
      out.append(.label(TextSafety.oneLine(TextSafety.clean(p.description), max: detailWidth), .secondary))
    }
    let wrapped = TextSafety.wrap(TextSafety.clean(p.detail), width: detailWidth, maxLines: detailLines)
    if !p.detail.isEmpty { out += wrapped.lines.map { .label($0, .mono) } }
    // The question can name the file (an edit's "…to <file>?"): wrapped, not cut
    let question = TextSafety.wrap(TextSafety.clean(p.question), width: detailWidth, maxLines: questionLines)
    // Anything not shown in full keeps allow off: the detail past 12 lines,
    // a detail the server itself cut, a title or question too long to show
    let hidden =
      wrapped.cut || question.cut || serverCut(p.detail) || !TextSafety.fitsOneLine(p.title, max: detailWidth)
    if hidden { out.append(.label(Strings.tooLong, .secondary)) }
    if !p.question.isEmpty { out += question.lines.map { .label($0) } }
    let canAnswer = features && fingerprint != nil
    if !canAnswer { out.append(.label(Strings.needsUpdate, .secondary)) }
    out.append(.separator)
    let unsafe = TextSafety.hasUnsafe(p.title + p.description + p.detail + p.question)
    for (position, option) in p.options.enumerated() {
      let safeOption = !TextSafety.hasUnsafe(option.label)
      let quiet = option.kind == "deny" || option.kind == "other"
      let enabled = canAnswer && safeOption && (quiet || (!hidden && !unsafe))
      // ⌘1…⌘9 only on deny and other, never on allow or always
      let key = quiet && position < 9 ? String(position + 1) : nil
      out.append(
        MenuEntry(
          title: TextSafety.clean(option.label), enabled: enabled, keyEquivalent: key,
          action: .answerPrompt(id: s.id, index: position, label: option.label, fingerprint: fingerprint ?? "")))
    }
    return out + [.separator, MenuEntry(title: Strings.openInWindow, action: .open(id: s.id))]
  }

  static func askEntries(_ s: MenuSession, _ questions: [AskQuestion], features: Bool) -> [MenuEntry] {
    let q = questions[0]
    let question = TextSafety.wrap(TextSafety.clean(q.question), width: detailWidth, maxLines: 4).lines
    guard questions.count == 1, q.multiSelect != true else {
      var out: [MenuEntry] = question.prefix(2).map { .label($0) }
      if questions.count > 1 { out.append(.label(Strings.hasQuestions(questions.count), .secondary)) }
      return out + [MenuEntry(title: Strings.answerInWindow, action: .open(id: s.id))]
    }
    let header = q.header.map { TextSafety.oneLine(TextSafety.clean($0), max: 40) }
    var out: [MenuEntry] = [.label(header.map(Strings.claudeAsksAbout) ?? Strings.claudeAsks, .bold)]
    out += question.map { .label($0) }
    if !features { out.append(.label(Strings.needsUpdate, .secondary)) }
    out.append(.separator)
    let labels = q.options.map(\.label)
    for (i, option) in q.options.enumerated() {
      out.append(
        MenuEntry(
          title: TextSafety.clean(option.label), enabled: features && !TextSafety.hasUnsafe(option.label),
          action: .answerAsk(id: s.id, question: q.question, optionCount: q.options.count, labels: labels, pick: i),
          tooltip: option.description.map(TextSafety.clean)))
    }
    out.append(
      MenuEntry(
        title: Strings.typeOwnAnswer, enabled: features,
        action: .openPanel(
          .askOther(id: s.id, name: s.name, question: q.question, optionCount: q.options.count, labels: labels))))
    return out + [.separator, MenuEntry(title: Strings.openInWindow, action: .open(id: s.id))]
  }

  /// Waiting with no prompt: what it said, its suggested replies, Reply…
  static func plainEntries(_ s: MenuSession, features: Bool) -> [MenuEntry] {
    var out: [MenuEntry] = []
    if let question = s.context?.question, !question.isEmpty {
      out.append(.label(TextSafety.oneLine(TextSafety.clean(question), max: detailWidth), .bold))
    }
    if let excerpt = s.context?.excerpt, !excerpt.isEmpty {
      out += TextSafety.wrap(TextSafety.clean(excerpt), width: detailWidth, maxLines: 4).lines.map { .label($0) }
    }
    if !out.isEmpty { out.append(.separator) }
    for choice in s.context?.choices?.choices ?? [] where isShowable(choice.reply) {
      out.append(MenuEntry(title: choice.reply, enabled: features, action: .choice(id: s.id, reply: choice.reply)))
    }
    out.append(
      MenuEntry(title: Strings.replyMenu, enabled: features, action: .openPanel(.reply(id: s.id, name: s.name))))
    return out
  }

  /// A choice is shown only when its title can be exactly what is sent
  static func isShowable(_ reply: String) -> Bool {
    !reply.isEmpty && !TextSafety.hasUnsafe(reply) && !reply.contains("\n") && !reply.contains("\t")
      && TextSafety.oneLine(reply, max: 60) == reply
  }

  // MARK: Notifications submenu

  /// authorization: authorized, provisional, denied or notDetermined
  static func notifications(authorization: String, toggles: NotifyRules.Toggles) -> MenuEntry {
    var children: [MenuEntry] = []
    switch authorization {
    case "denied":
      children += [
        .label(Strings.notificationsOff), MenuEntry(title: Strings.turnOnInSettings, action: .notifySettings),
      ]
    case "notDetermined":
      children.append(MenuEntry(title: Strings.turnOnNotifications, action: .notifyAsk))
    default:
      break
    }
    if !children.isEmpty { children.append(.separator) }
    for (key, title, on) in [
      ("needsYou", Strings.whenNeedsYou, toggles.needsYou), ("finished", Strings.whenFinishes, toggles.finished),
      ("limited", Strings.whenLimited, toggles.limited),
    ] {
      children.append(MenuEntry(title: title, action: .notifyToggle(key), checked: on))
    }
    children += [.separator, .label(Strings.phoneStillGets)]
    return MenuEntry(title: Strings.notificationsMenu, children: children)
  }

  // MARK: Text, for dump-menu and the tests

  /// `title | enabled | key | METHOD path proof=yes|no`, children indented
  static func text(_ entries: [MenuEntry], depth: Int = 0) -> String {
    entries.map { e -> String in
      let pad = String(repeating: "  ", count: depth)
      if e.style == .separator { return pad + "---\n" }
      var line = "\(pad)\(e.title)\(e.checked ? " [on]" : "") | \(e.enabled ? "enabled" : "disabled") | "
        + (e.keyEquivalent.map { "⌘" + $0 } ?? "-")
      if let action = e.action, let r = Requests.request(for: action) {
        line += " | \(r.method) \(r.path) proof=\(r.needsProof ? "yes" : "no")"
      } else if let action = e.action {
        line += " | " + action.tag
      }
      return line + "\n" + text(e.children, depth: depth + 1)
    }.joined()
  }

  /// The entry at a dotted path ("3" or "0.2") under a session's row
  static func entry(_ entries: [MenuEntry], path: String) -> MenuEntry? {
    let parts = path.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
    guard !parts.isEmpty, parts.allSatisfy({ $0 != nil }) else { return nil }
    var list = entries
    var found: MenuEntry?
    for i in parts.compactMap({ $0 }) {
      guard i >= 0, i < list.count else { return nil }
      found = list[i]
      list = list[i].children
    }
    return found
  }
}
