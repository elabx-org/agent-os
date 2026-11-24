import AppKit

/// Quick ask's panel: it takes the keyboard without making AgentOS the app
/// in front, so the app the person was in stays where it is
final class QuickPanel: NSPanel {
  var onCommandReturn: (() -> Void)?
  var onNumber: ((Int) -> Void)?

  override var canBecomeKey: Bool { true }
  override func cancelOperation(_ sender: Any?) { close() }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    if event.type == .keyDown, flags == .command {
      // Return
      if event.keyCode == 36 {
        onCommandReturn?()
        return true
      }
      if let typed = event.charactersIgnoringModifiers, let n = Int(typed), (1...9).contains(n) {
        onNumber?(n)
        return true
      }
    }
    return super.performKeyEquivalent(with: event)
  }
}

/// Quick ask: a line to type in, from any app. Return starts a new chat in
/// the chosen project, exactly as the New Session panel does (no Full
/// access, nothing answered). Under it, the sessions that need the person
/// or are working, with the same Answer as the watch panel.
@MainActor
final class QuickAsk: NSObject, NSWindowDelegate, NSTextFieldDelegate {
  static let width: CGFloat = 600
  static let inset: CGFloat = 16
  static let maxRows = 4

  let panel: QuickPanel
  private weak var host: GlanceHost?
  private let field = NSTextField()
  private let popup = NSPopUpButton(frame: .zero, pullsDown: false)
  private let status = NSTextField(labelWithString: "")
  private let rowsStack = NSStackView()
  private let stack = NSStackView()
  private let work = DispatchQueue(label: "agentos.panel.quick")
  private var projects: [Project] = []
  private var rows: [GlanceRow] = []
  private var answerButtons: [String: SessionButton] = [:]
  private var starting = false
  /// An answers menu is up, or the panel was shown for a capture: it stays
  private var pinned = false

  init(host: GlanceHost) {
    self.host = host
    panel = QuickPanel(
      contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 120),
      styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
    super.init()
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
      panel.standardWindowButton(kind)?.isHidden = true
    }
    panel.isFloatingPanel = true
    panel.level = .modalPanel
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isRestorable = false
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.delegate = self
    panel.onCommandReturn = { [weak self] in self?.start(openIt: true) }
    panel.onNumber = { [weak self] n in self?.pick(n) }

    let glass = NSVisualEffectView()
    glass.material = .popover
    glass.blendingMode = .behindWindow
    glass.state = .active
    panel.contentView = glass

    let inner = Self.width - 2 * Self.inset
    field.placeholderString = Strings.quickPlaceholder
    field.font = NSFont.systemFont(ofSize: 20)
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.lineBreakMode = .byTruncatingTail
    field.cell?.usesSingleLineMode = true
    field.cell?.isScrollable = true
    field.delegate = self
    field.translatesAutoresizingMaskIntoConstraints = false
    field.widthAnchor.constraint(equalToConstant: inner).isActive = true

    popup.controlSize = .small
    popup.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
    status.font = NSFont.systemFont(ofSize: 11)
    status.textColor = .systemRed
    status.lineBreakMode = .byTruncatingTail
    status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let projectRow = NSStackView(views: [GlanceRows.note(Strings.quickStartsIn), popup, status])
    projectRow.orientation = .horizontal
    projectRow.spacing = 6

    rowsStack.orientation = .vertical
    rowsStack.alignment = .leading
    rowsStack.spacing = 8

    let hints = NSStackView(
      views: [Strings.quickHintStart, Strings.quickHintOpen, Strings.quickHintClose].map { text in
        let label = GlanceRows.note(text)
        label.textColor = .tertiaryLabelColor
        return label
      })
    hints.orientation = .horizontal
    hints.spacing = 14

    for view in [field, projectRow, rowsStack, hints] as [NSView] { stack.addArrangedSubview(view) }
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: Self.inset, left: Self.inset, bottom: 12, right: Self.inset)
    stack.translatesAutoresizingMaskIntoConstraints = false
    glass.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: glass.leadingAnchor),
      stack.topAnchor.constraint(equalTo: glass.topAnchor),
      stack.widthAnchor.constraint(equalToConstant: Self.width),
    ])
  }

  var isShown: Bool { panel.isVisible }

  /// `key: false` only shows it (the command channel, for a picture): it
  /// takes no keyboard and stays until it is hidden again
  func show(key: Bool = true) {
    pinned = !key
    fillProjects()
    status.textColor = .secondaryLabelColor
    status.stringValue = host?.snapshot.on == false ? Strings.isOff : ""
    update(force: true)
    place()
    if key {
      panel.makeKeyAndOrderFront(nil)
      panel.makeFirstResponder(field)
    } else {
      panel.orderFrontRegardless()
    }
  }

  func hide() {
    pinned = false
    panel.orderOut(nil)
  }

  /// On the screen the mouse is on, a third of the way down
  private func place() {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return panel.center() }
    let size = panel.frame.size
    panel.setFrameOrigin(
      NSPoint(x: visible.midX - size.width / 2, y: visible.minY + visible.height * 0.68 - size.height))
  }

  private func fillProjects() {
    let list = (host?.snapshot.projects ?? []).sorted {
      NewSessionPanel.title($0).localizedStandardCompare(NewSessionPanel.title($1)) == .orderedAscending
    }
    let chosen = selected?.id
    projects = list
    popup.removeAllItems()
    for p in list { popup.addItem(withTitle: NewSessionPanel.title(p)) }
    popup.isEnabled = !list.isEmpty
    guard !list.isEmpty else { return }
    let remembered = UserDefaults.standard.string(forKey: "lastProjectId")
    let recent = host?.snapshot.recentProjects.first?.id
    let pick =
      list.firstIndex { $0.id == chosen } ?? list.firstIndex { $0.id == remembered }
      ?? list.firstIndex { $0.id == recent } ?? 0
    popup.selectItem(at: pick)
  }

  private var selected: Project? {
    let i = popup.indexOfSelectedItem
    return i >= 0 && i < projects.count ? projects[i] : nil
  }

  func update(force: Bool = false) {
    guard let host, force || isShown else { return }
    let next = Glance.rows(host.glanceSessions, max: Self.maxRows).rows
    guard force || next != rows else { return }
    rows = next
    answerButtons = [:]
    for old in rowsStack.arrangedSubviews {
      rowsStack.removeArrangedSubview(old)
      old.removeFromSuperview()
    }
    for (i, row) in next.enumerated() {
      let view = GlanceRows.view(
        row, width: Self.width - 2 * Self.inset, key: "⌘\(i + 1)", target: self, open: #selector(openRow(_:)),
        answer: #selector(answerRow(_:)))
      rowsStack.addArrangedSubview(view)
      if let stack = view as? NSStackView {
        for case let button as SessionButton in stack.arrangedSubviews where button.isBordered {
          answerButtons[row.id] = button
        }
      }
    }
    rowsStack.isHidden = next.isEmpty
    fit()
  }

  private func fit() {
    panel.contentView?.layoutSubtreeIfNeeded()
    let height = max(96, stack.fittingSize.height)
    var frame = panel.frame
    let delta = height - panel.contentRect(forFrameRect: frame).height
    guard abs(delta) > 0.5 else { return }
    frame.origin.y -= delta
    frame.size.height += delta
    panel.setFrame(frame, display: true)
  }

  var dump: [String: Any] {
    [
      "shown": isShown, "key": panel.isKeyWindow, "projects": projects.count,
      "project": selected.map(NewSessionPanel.title) ?? NSNull() as Any,
      "rows": rows.map { ["id": $0.id, "name": $0.name, "state": $0.state, "line": $0.line] },
      "status": status.stringValue,
    ]
  }

  // MARK: Keys

  func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    if selector == #selector(NSResponder.insertNewline(_:)) {
      start(openIt: false)
      return true
    }
    if selector == #selector(NSResponder.cancelOperation(_:)) {
      hide()
      return true
    }
    return false
  }

  /// Clicking back into another app puts quick ask away
  func windowDidResignKey(_ notification: Notification) {
    if !pinned && !starting { hide() }
  }

  /// ⌘1…⌘9: the row's own action
  private func pick(_ n: Int) {
    guard rows.indices.contains(n - 1) else { return }
    let row = rows[n - 1]
    if row.state == "waiting", let button = answerButtons[row.id] {
      answerRow(button)
    } else {
      open(row.id)
    }
  }

  private func open(_ id: String) {
    guard SessionLink.isValidId(id) else { return }
    hide()
    host?.open(.session(id), activate: true)
  }

  @objc private func openRow(_ sender: SessionButton) { open(sender.sessionId) }

  @objc private func answerRow(_ sender: SessionButton) {
    let was = pinned
    pinned = true
    host?.answer(session: sender.sessionId, under: sender)
    pinned = was
    // The answer opened something else (the reply panel, the window)
    if !pinned && !panel.isKeyWindow { hide() }
  }

  // MARK: Start

  private func start(openIt: Bool) {
    // Typed and sent by the person, never by a command from outside
    guard !starting, !CommandChannel.isHandling, panel.isKeyWindow, let p = selected else { return }
    let words = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !words.isEmpty else { return }
    let new = NewSession(
      projectId: p.id, workingDirectory: p.working_directory, agentType: p.agent_type ?? "claude", model: nil,
      initialPrompt: words)
    guard let request = Requests.request(for: .newSession(new)) else { return }
    UserDefaults.standard.set(p.id, forKey: "lastProjectId")
    starting = true
    field.isEditable = false
    status.textColor = .secondaryLabelColor
    status.stringValue = Strings.startingSession
    work.async { [weak self] in
      let (outcome, json) = Backend.plain(path: request.path, method: request.method, body: request.body)
      let id = (json["session"] as? [String: Any])?["id"] as? String
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self else { return }
          Notifier.log("newSession", id ?? "", outcome.name)
          self.starting = false
          self.field.isEditable = true
          if outcome == .ok {
            self.field.stringValue = ""
            self.status.stringValue = ""
            self.hide()
            self.host?.refreshNow()
            if openIt, let id, SessionLink.isValidId(id) { self.host?.open(.session(id), activate: true) }
          } else {
            self.status.textColor = .systemRed
            self.status.stringValue = Panels.message(for: outcome)
            self.status.toolTip = self.status.stringValue
          }
        }
      }
    }
  }
}
