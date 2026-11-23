import AppKit

/// What the watch panel and quick ask need from the app
@MainActor
protocol GlanceHost: AnyObject {
  func open(_ d: Destination, activate: Bool)
  func refreshNow()
  /// Shows the session's answers under `view`, as the menu bar has them
  func answer(session id: String, under view: NSView)
  var glanceSessions: [MenuSession] { get }
  var snapshot: Snapshot { get }
}

/// A button that remembers its session
final class SessionButton: NSButton {
  var sessionId = ""
}

/// The rows both panels draw: a dot, the session's name (a click opens it
/// in the window), what it asks or its last line, and Answer for one that
/// needs the person. Answer shows the menu bar's own answers; nothing here
/// answers by itself.
@MainActor
enum GlanceRows {
  static func dot(_ state: String) -> NSImageView {
    let waiting = state == "waiting"
    let symbol = waiting ? "exclamationmark.circle.fill" : "circle.fill"
    let image =
      NSImage(systemSymbolName: symbol, accessibilityDescription: Strings.stateWord(state)) ?? NSImage()
    let view = NSImageView(image: image)
    view.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: waiting ? 12 : 8, weight: .regular)
    view.contentTintColor = waiting ? .systemOrange : .systemGreen
    view.setContentHuggingPriority(.required, for: .horizontal)
    view.translatesAutoresizingMaskIntoConstraints = false
    view.widthAnchor.constraint(equalToConstant: 14).isActive = true
    return view
  }

  /// `lines`: how many lines what it asks may take (the rest is cut with …)
  static func view(
    _ row: GlanceRow, width: CGFloat, lines: Int = 1, key: String? = nil, target: AnyObject, open: Selector,
    answer: Selector
  ) -> NSView {
    let name = SessionButton(title: row.name, target: target, action: open)
    name.sessionId = row.id
    name.isBordered = false
    name.alignment = .left
    name.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
    name.lineBreakMode = .byTruncatingTail
    name.toolTip = Strings.openSessionTip
    name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let line = lines > 1 ? NSTextField(wrappingLabelWithString: row.line) : NSTextField(labelWithString: row.line)
    line.font = NSFont.systemFont(ofSize: 11)
    line.textColor = .secondaryLabelColor
    line.isSelectable = false
    line.toolTip = row.line
    line.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    if lines > 1 {
      line.maximumNumberOfLines = lines
      line.cell?.truncatesLastVisibleLine = true
      // The room left of the dot and, for one that needs the person, the button
      line.preferredMaxLayoutWidth = width - 22 - (row.state == "waiting" ? 78 : 0)
    } else {
      line.lineBreakMode = .byTruncatingTail
    }
    let text = NSStackView(views: [name, line])
    text.orientation = .vertical
    text.alignment = .leading
    text.spacing = 1
    // The text takes the room; the button and the key hint keep to the right
    text.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
    var parts: [NSView] = [dot(row.state), text]
    if row.state == "waiting" {
      let button = SessionButton(title: Strings.answerButton, target: target, action: answer)
      button.sessionId = row.id
      button.bezelStyle = .rounded
      button.controlSize = .small
      button.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
      button.toolTip = Strings.answerTip
      button.setContentHuggingPriority(.required, for: .horizontal)
      parts.append(button)
    }
    if let key {
      let hint = NSTextField(labelWithString: key)
      hint.font = NSFont.systemFont(ofSize: 11)
      hint.textColor = .tertiaryLabelColor
      hint.setContentHuggingPriority(.required, for: .horizontal)
      parts.append(hint)
    }
    let all = NSStackView(views: parts)
    all.orientation = .horizontal
    all.distribution = .fill
    all.alignment = .centerY
    all.spacing = 8
    all.translatesAutoresizingMaskIntoConstraints = false
    all.widthAnchor.constraint(equalToConstant: width).isActive = true
    return all
  }

  static func note(_ text: String) -> NSTextField {
    let label = NSTextField(labelWithString: text)
    label.font = NSFont.systemFont(ofSize: 11)
    label.textColor = .secondaryLabelColor
    return label
  }
}

/// A small panel that stays on top of other apps and shows who needs the
/// person and who is working. It never takes the keyboard from the app in
/// front, and showing it never brings AgentOS forward.
@MainActor
final class WatchPanel: NSObject, NSWindowDelegate {
  static let defaultsKey = "watchPanel"
  static let width: CGFloat = 300
  static let inset: CGFloat = 12

  let panel: NSPanel
  private weak var host: GlanceHost?
  private let stack = NSStackView()
  private var drawn: [GlanceRow]?
  private var drawnMore = 0
  /// The person closed it (its own close button)
  var onClose: (() -> Void)?

  init(host: GlanceHost) {
    self.host = host
    panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 96),
      styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered, defer: false)
    super.init()
    panel.title = Strings.appName
    panel.titlebarAppearsTransparent = true
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.isReleasedWhenClosed = false
    panel.isRestorable = false
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.delegate = self
    let glass = NSVisualEffectView()
    glass.material = .popover
    glass.blendingMode = .behindWindow
    glass.state = .active
    panel.contentView = glass
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 30, left: Self.inset, bottom: Self.inset, right: Self.inset)
    stack.translatesAutoresizingMaskIntoConstraints = false
    glass.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: glass.leadingAnchor),
      stack.topAnchor.constraint(equalTo: glass.topAnchor),
      stack.widthAnchor.constraint(equalToConstant: Self.width),
    ])
    if !panel.setFrameUsingName("AgentOSWatch") { placeDefault() }
    panel.setFrameAutosaveName("AgentOSWatch")
  }

  /// The top right corner of the main screen
  private func placeDefault() {
    guard let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame else { return panel.center() }
    let size = panel.frame.size
    panel.setFrameOrigin(NSPoint(x: visible.maxX - size.width - 16, y: visible.maxY - size.height - 16))
  }

  var isShown: Bool { panel.isVisible }

  func show() {
    update(force: true)
    // In front of other apps' windows, without becoming the active app
    panel.orderFrontRegardless()
  }

  func hide() { panel.orderOut(nil) }

  /// Only the person's own close (the panel's button): quitting the app or
  /// hiding the panel doesn't change what they chose
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    onClose?()
    return true
  }

  func update(force: Bool = false) {
    guard let host, force || isShown else { return }
    let (rows, more) = Glance.rows(host.glanceSessions)
    guard force || rows != drawn || more != drawnMore else { return }
    drawn = rows
    drawnMore = more
    for old in stack.arrangedSubviews {
      stack.removeArrangedSubview(old)
      old.removeFromSuperview()
    }
    let width = Self.width - 2 * Self.inset
    if rows.isEmpty { stack.addArrangedSubview(GlanceRows.note(Strings.watchEmpty)) }
    for row in rows {
      stack.addArrangedSubview(
        GlanceRows.view(
          row, width: width, lines: 2, target: self, open: #selector(openRow(_:)),
          answer: #selector(answerRow(_:))))
    }
    if more > 0 { stack.addArrangedSubview(GlanceRows.note(Strings.andMore(more))) }
    fit()
  }

  /// As tall as its rows, growing downwards from where its top is
  private func fit() {
    panel.contentView?.layoutSubtreeIfNeeded()
    let height = max(64, stack.fittingSize.height)
    var frame = panel.frame
    let delta = height - panel.contentRect(forFrameRect: frame).height
    guard abs(delta) > 0.5 else { return }
    frame.origin.y -= delta
    frame.size.height += delta
    panel.setFrame(frame, display: true)
  }

  /// What it shows, for the state dump
  var dump: [String: Any] {
    [
      "shown": isShown,
      "rows": (drawn ?? []).map { ["id": $0.id, "name": $0.name, "state": $0.state, "line": $0.line] },
      "more": drawnMore,
      "level": panel.level == .floating ? "floating" : "other",
    ]
  }

  @objc private func openRow(_ sender: SessionButton) {
    guard SessionLink.isValidId(sender.sessionId) else { return }
    host?.open(.session(sender.sessionId), activate: true)
  }

  @objc private func answerRow(_ sender: SessionButton) {
    host?.answer(session: sender.sessionId, under: sender)
  }
}
