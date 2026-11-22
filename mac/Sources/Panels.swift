import AppKit

/// What the panels need from the app
@MainActor
protocol PanelHost: AnyObject {
  func open(_ d: Destination, activate: Bool)
  func refreshNow()
  var snapshot: Snapshot { get }
}

/// The Reply panel and the New session panel. A panel opens from a menu
/// click, so it may come to the front. Send needs a fresh press of its own
/// button (Clicks.fromPanel); Start needs no proof.
@MainActor
enum Panels {
  static private(set) var reply: NSPanel?
  static private(set) var newSession: NSPanel?
  private static var replyController: ReplyPanel?
  private static var newSessionController: NewSessionPanel?

  static func showReply(_ kind: PanelKind, host: PanelHost) {
    replyController?.close()
    let c = ReplyPanel(kind, host: host)
    replyController = c
    reply = c.panel
    c.show()
  }

  static func showNewSession(host: PanelHost) {
    // Still open, perhaps stepped aside while another app was in front
    if let c = newSessionController {
      c.show()
      return
    }
    let c = NewSessionPanel(host: host)
    newSessionController = c
    newSession = c.panel
    c.show()
  }

  static func closed(_ panel: NSPanel) {
    if panel === reply {
      reply = nil
      replyController = nil
    }
    if panel === newSession {
      newSession = nil
      newSessionController = nil
    }
  }

  static func makePanel(width: CGFloat, height: CGFloat, title: String) -> NSPanel {
    let panel = KeyPanel(
      contentRect: NSRect(x: 0, y: 0, width: width, height: height),
      styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
    panel.title = title
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.isReleasedWhenClosed = false
    // Floating only over our own app: when the person switches to another
    // app the panel steps aside (text kept) and comes back with ours
    panel.hidesOnDeactivate = true
    return panel
  }

  /// Centred on the screen the mouse is on
  static func place(_ panel: NSPanel) {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return panel.center() }
    let size = panel.frame.size
    panel.setFrameOrigin(NSPoint(x: visible.midX - size.width / 2, y: visible.midY - size.height / 2))
  }

  static func bringForward(_ panel: NSPanel) {
    place(panel)
    // Opened by a click in our menu: it may come to the front
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    panel.makeKeyAndOrderFront(nil)
  }

  static func textArea(_ placeholder: String) -> (NSScrollView, NSTextView) {
    let scroll = NSTextView.scrollableTextView()
    scroll.borderType = .bezelBorder
    scroll.hasVerticalScroller = true
    let text = scroll.documentView as! NSTextView
    text.isRichText = false
    text.allowsUndo = true
    text.font = NSFont.systemFont(ofSize: 13)
    text.isAutomaticQuoteSubstitutionEnabled = false
    text.isAutomaticDashSubstitutionEnabled = false
    text.isAutomaticTextReplacementEnabled = false
    text.setAccessibilityPlaceholderValue(placeholder)
    return (scroll, text)
  }

  static func message(for outcome: Outcome) -> String {
    switch outcome {
    case .ok: return ""
    case .changed: return Strings.changedTitle + ". " + Strings.changedBody
    case .guarded: return Strings.guardedTitle + ". " + Strings.guardedBody
    case .refused: return Strings.refusedTitle + ". " + Strings.refusedBody
    case .offline: return Strings.noAnswer
    case .error(let text): return text
    }
  }
}

/// Esc closes it (also from inside the text view)
final class KeyPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override func cancelOperation(_ sender: Any?) { performClose(nil) }
}

// MARK: Reply

@MainActor
final class ReplyPanel: NSObject, NSWindowDelegate, NSTextViewDelegate {
  let panel: NSPanel
  private let kind: PanelKind
  private weak var host: PanelHost?
  private let text: NSTextView
  private let sendButton = NSButton(title: Strings.send, target: nil, action: nil)
  private let cancelButton = NSButton(title: Strings.cancel, target: nil, action: nil)
  private let status = NSTextField(labelWithString: "")
  private let work = DispatchQueue(label: "agentos.panel.reply")
  private var sending = false

  init(_ kind: PanelKind, host: PanelHost) {
    self.kind = kind
    self.host = host
    let name: String
    switch kind {
    case .reply(_, let n), .askOther(_, let n, _, _, _): name = n
    case .newSession: name = ""
    }
    panel = Panels.makePanel(
      width: 460, height: 220, title: Strings.replyTo(TextSafety.oneLine(TextSafety.clean(name), max: 50)))
    let (scroll, view) = Panels.textArea(Strings.typeYourReply)
    text = view
    super.init()
    panel.delegate = self
    text.delegate = self

    let hint = NSTextField(labelWithString: Strings.typeYourReply)
    hint.textColor = .secondaryLabelColor
    status.textColor = .secondaryLabelColor
    status.lineBreakMode = .byTruncatingTail
    sendButton.target = self
    sendButton.action = #selector(send(_:))
    sendButton.keyEquivalent = "\r"
    sendButton.keyEquivalentModifierMask = [.command]
    sendButton.bezelStyle = .rounded
    sendButton.isEnabled = false
    cancelButton.target = self
    cancelButton.action = #selector(cancel(_:))
    cancelButton.keyEquivalent = "\u{1b}"
    cancelButton.bezelStyle = .rounded

    let buttons = NSStackView(views: [status, NSView(), cancelButton, sendButton])
    buttons.orientation = .horizontal
    let stack = NSStackView(views: [hint, scroll, buttons])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    stack.translatesAutoresizingMaskIntoConstraints = false
    panel.contentView = NSView()
    panel.contentView?.addSubview(stack)
    if let content = panel.contentView {
      NSLayoutConstraint.activate([
        stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        stack.topAnchor.constraint(equalTo: content.topAnchor),
        stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        scroll.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 100),
      ])
    }
  }

  func show() {
    Panels.bringForward(panel)
    panel.makeFirstResponder(text)
  }

  func close() { panel.close() }

  func textDidChange(_ notification: Notification) {
    sendButton.isEnabled = !sending && !text.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func windowWillClose(_ notification: Notification) { Panels.closed(panel) }

  /// Esc in the text closes the panel; Return stays a new line
  func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    guard selector == #selector(NSResponder.cancelOperation(_:)) || selector == #selector(NSTextView.complete(_:))
    else { return false }
    panel.close()
    return true
  }

  @objc private func cancel(_ sender: Any?) { panel.close() }

  @objc private func send(_ sender: NSButton) {
    guard !sending, let click = Clicks.fromPanel(sender, panel: panel) else { return }
    let words = text.string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !words.isEmpty else { return }
    let action: MenuAction
    switch kind {
    case .reply(let id, _): action = .reply(id: id, text: words)
    case .askOther(let id, _, let question, let count, let labels):
      action = .askOther(id: id, question: question, optionCount: count, labels: labels, text: words)
    case .newSession: return
    }
    guard let request = Requests.request(for: action) else { return }
    sending = true
    sendButton.isEnabled = false
    text.isEditable = false
    status.textColor = .secondaryLabelColor
    status.stringValue = Strings.sending
    work.async { [weak self] in
      let outcome = Backend.perform(request, click: click)
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self else { return }
          Notifier.log(action.name, action.sessionId ?? "", outcome.name)
          self.sending = false
          self.text.isEditable = true
          if outcome == .ok {
            self.host?.refreshNow()
            self.panel.close()
          } else {
            // The text stays, so it can be sent again
            self.status.textColor = .systemRed
            self.status.stringValue = Panels.message(for: outcome)
            self.status.toolTip = self.status.stringValue
            self.textDidChange(Notification(name: NSText.didChangeNotification))
          }
        }
      }
    }
  }
}

// MARK: New session

@MainActor
final class NewSessionPanel: NSObject, NSWindowDelegate, NSTextViewDelegate {
  let panel: NSPanel
  private weak var host: PanelHost?
  private let popup = NSPopUpButton(frame: .zero, pullsDown: false)
  private let task: NSTextView
  private let defaultsLine = NSTextField(labelWithString: "")
  private let errorLine = NSTextField(wrappingLabelWithString: "")
  private let openBox = NSButton(checkboxWithTitle: Strings.openItInWindow, target: nil, action: nil)
  private let startButton = NSButton(title: Strings.start, target: nil, action: nil)
  private let cancelButton = NSButton(title: Strings.cancel, target: nil, action: nil)
  private let work = DispatchQueue(label: "agentos.panel.new")
  private var projects: [Project] = []
  private var starting = false

  init(host: PanelHost) {
    self.host = host
    panel = Panels.makePanel(width: 480, height: 330, title: Strings.newSessionTitle)
    let (scroll, view) = Panels.textArea(Strings.taskPlaceholder)
    task = view
    super.init()
    panel.delegate = self
    task.delegate = self

    let projectLabel = NSTextField(labelWithString: Strings.projectLabel)
    let taskLabel = NSTextField(labelWithString: Strings.taskLabel)
    let taskHint = NSTextField(wrappingLabelWithString: Strings.taskPlaceholder)
    taskHint.textColor = .secondaryLabelColor
    taskHint.font = NSFont.systemFont(ofSize: 11)
    defaultsLine.textColor = .secondaryLabelColor
    defaultsLine.lineBreakMode = .byTruncatingMiddle
    let note = NSTextField(wrappingLabelWithString: Strings.askNote)
    note.textColor = .secondaryLabelColor
    note.font = NSFont.systemFont(ofSize: 11)
    errorLine.textColor = .systemRed
    errorLine.isHidden = true
    popup.target = self
    popup.action = #selector(projectChanged(_:))
    openBox.state = (UserDefaults.standard.object(forKey: "newSessionOpenWindow") as? Bool ?? true) ? .on : .off
    openBox.target = self
    openBox.action = #selector(openChanged(_:))
    startButton.target = self
    startButton.action = #selector(start(_:))
    startButton.keyEquivalent = "\r"
    startButton.keyEquivalentModifierMask = [.command]
    startButton.bezelStyle = .rounded
    startButton.isEnabled = false
    cancelButton.target = self
    cancelButton.action = #selector(cancel(_:))
    cancelButton.keyEquivalent = "\u{1b}"
    cancelButton.bezelStyle = .rounded

    let projectRow = NSStackView(views: [projectLabel, popup])
    projectRow.orientation = .horizontal
    let buttons = NSStackView(views: [openBox, NSView(), cancelButton, startButton])
    buttons.orientation = .horizontal
    let stack = NSStackView(views: [projectRow, defaultsLine, taskLabel, scroll, taskHint, note, errorLine, buttons])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    stack.translatesAutoresizingMaskIntoConstraints = false
    panel.contentView = NSView()
    panel.contentView?.addSubview(stack)
    if let content = panel.contentView {
      NSLayoutConstraint.activate([
        stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        stack.topAnchor.constraint(equalTo: content.topAnchor),
        stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        scroll.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        note.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        taskHint.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        errorLine.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        popup.widthAnchor.constraint(greaterThanOrEqualToConstant: 280),
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 90),
      ])
    }
    loadProjects()
  }

  func show() {
    Panels.bringForward(panel)
    panel.makeFirstResponder(task)
  }

  func windowWillClose(_ notification: Notification) { Panels.closed(panel) }

  func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    guard selector == #selector(NSResponder.cancelOperation(_:)) || selector == #selector(NSTextView.complete(_:))
    else { return false }
    panel.close()
    return true
  }

  static func title(_ p: Project) -> String { p.uncategorized ? Strings.noProject : TextSafety.clean(p.name) }

  private func loadProjects() {
    work.async { [weak self] in
      let list = Backend.decode(ProjectList.self, "/api/projects")?.projects ?? []
      // The project of the most recently active session
      let rows = (Backend.request("/api/sessions") as? [String: Any])?["sessions"] as? [[String: Any]] ?? []
      let recent =
        rows.max { ($0["updated_at"] as? String ?? "") < ($1["updated_at"] as? String ?? "") }?["project_id"]
        as? String
      DispatchQueue.main.async {
        MainActor.assumeIsolated { self?.fill(list, recent: recent) }
      }
    }
  }

  private func fill(_ list: [Project], recent: String?) {
    projects = list.sorted {
      NewSessionPanel.title($0).localizedStandardCompare(NewSessionPanel.title($1)) == .orderedAscending
    }
    popup.removeAllItems()
    guard !projects.isEmpty else {
      showError(Strings.noProjects)
      startButton.isEnabled = false
      return
    }
    for p in projects { popup.addItem(withTitle: NewSessionPanel.title(p)) }
    let remembered = UserDefaults.standard.string(forKey: "lastProjectId")
    let pick =
      projects.firstIndex { $0.id == remembered } ?? projects.firstIndex { $0.id == recent } ?? 0
    popup.selectItem(at: pick)
    projectChanged(popup)
    startButton.isEnabled = true
  }

  private var selected: Project? {
    let i = popup.indexOfSelectedItem
    return i >= 0 && i < projects.count ? projects[i] : nil
  }

  @objc private func projectChanged(_ sender: Any?) {
    guard let p = selected else { return }
    defaultsLine.stringValue = Strings.defaultsLine(
      Strings.agentName(p.agent_type), Strings.usualModel, TextSafety.clean(p.working_directory))
  }

  @objc private func openChanged(_ sender: Any?) {
    UserDefaults.standard.set(openBox.state == .on, forKey: "newSessionOpenWindow")
  }

  @objc private func cancel(_ sender: Any?) { panel.close() }

  private func showError(_ text: String) {
    errorLine.stringValue = text
    errorLine.isHidden = text.isEmpty
  }

  @objc private func start(_ sender: NSButton) {
    guard !starting, sender.window === panel, let p = selected else { return }
    let new = NewSession(
      projectId: p.id, workingDirectory: p.working_directory, agentType: p.agent_type ?? "claude", model: nil,
      initialPrompt: task.string.trimmingCharacters(in: .whitespacesAndNewlines))
    guard let request = Requests.request(for: .newSession(new)) else { return }
    UserDefaults.standard.set(p.id, forKey: "lastProjectId")
    starting = true
    startButton.isEnabled = false
    showError("")
    defaultsLine.stringValue = Strings.startingSession
    let openIt = openBox.state == .on
    work.async { [weak self] in
      let (outcome, json) = Backend.plain(path: request.path, method: request.method, body: request.body)
      let id = (json["session"] as? [String: Any])?["id"] as? String
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self else { return }
          Notifier.log("newSession", id ?? "", outcome.name)
          self.starting = false
          if outcome == .ok {
            self.panel.close()
            self.host?.refreshNow()
            if openIt, let id, SessionLink.isValidId(id) { self.host?.open(.session(id), activate: true) }
          } else {
            self.startButton.isEnabled = true
            self.projectChanged(nil)
            self.showError(Panels.message(for: outcome))
          }
        }
      }
    }
  }
}
