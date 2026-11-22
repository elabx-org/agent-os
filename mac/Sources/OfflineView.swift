import AppKit

/// Covers the page when this Mac's AgentOS can't show it: off, starting,
/// updating, not answering, not installed, a crashed page or a sign-in page.
@MainActor
final class OfflineView: NSView {
  enum Kind: String {
    case off, starting, updating, notAnswering, notInstalled, crashed, signIn

    var text: Strings.Offline {
      switch self {
      case .off: return Strings.offlineOff
      case .starting: return Strings.offlineStarting
      case .updating: return Strings.offlineUpdating
      case .notAnswering: return Strings.offlineNotAnswering
      case .notInstalled: return Strings.offlineNotInstalled
      case .crashed: return Strings.offlineCrashed
      case .signIn: return Strings.offlineSignIn
      }
    }

    var symbol: String {
      switch self {
      case .off: return "power"
      case .starting: return "hourglass"
      case .updating: return "arrow.triangle.2.circlepath"
      case .notAnswering: return "exclamationmark.triangle"
      case .notInstalled: return "questionmark.circle"
      case .crashed: return "exclamationmark.octagon"
      case .signIn: return "person.crop.circle.badge.questionmark"
      }
    }
  }

  /// Called with the button's title
  var onButton: ((String) -> Void)?
  private(set) var kind: Kind?

  private let icon = NSImageView()
  let titleLabel = NSTextField(labelWithString: "")
  let bodyLabel = NSTextField(wrappingLabelWithString: "")
  private let buttons = NSStackView()
  private let stack = NSStackView()

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
    titleLabel.alignment = .center
    bodyLabel.font = .systemFont(ofSize: 13)
    bodyLabel.textColor = .secondaryLabelColor
    bodyLabel.alignment = .center
    bodyLabel.preferredMaxLayoutWidth = 360
    icon.symbolConfiguration = .init(pointSize: 34, weight: .regular)
    icon.contentTintColor = .secondaryLabelColor
    buttons.orientation = .horizontal
    buttons.spacing = 10
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 10
    for view in [icon, titleLabel, bodyLabel, buttons] as [NSView] { stack.addArrangedSubview(view) }
    stack.setCustomSpacing(16, after: bodyLabel)
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
    ])
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func updateLayer() {
    layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
  }

  override var wantsUpdateLayer: Bool { true }

  /// Eats clicks so the page underneath can't be used
  override func hitTest(_ point: NSPoint) -> NSView? {
    super.hitTest(point) ?? (isHidden ? nil : self)
  }

  func show(_ kind: Kind) {
    self.kind = kind
    let text = kind.text
    icon.image = NSImage(systemSymbolName: kind.symbol, accessibilityDescription: nil)
    titleLabel.stringValue = text.title
    bodyLabel.stringValue = text.body
    for view in buttons.arrangedSubviews { view.removeFromSuperview() }
    for (i, title) in text.buttons.enumerated() {
      let button = NSButton(title: title, target: self, action: #selector(pressed(_:)))
      button.bezelStyle = .rounded
      if i == 0 { button.keyEquivalent = "\r" }
      buttons.addArrangedSubview(button)
    }
    buttons.isHidden = text.buttons.isEmpty
    isHidden = false
    needsDisplay = true
  }

  func hide() {
    kind = nil
    isHidden = true
  }

  @objc private func pressed(_ sender: NSButton) { onButton?(sender.title) }
}
