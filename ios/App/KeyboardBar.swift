import UIKit
import UniformTypeIdentifiers

/// The terminal keys Claude Code needs, on the keyboard itself, following
/// what the page says you're in (its `keys` message): Claude Code with the
/// keyboard up, a plain shell, or the chat box. ^C and / hold rarer keys
/// behind a long press. Open flat on iPhone Duo the keys part around the
/// hinge; a key to put the keyboard away sits at the edge.
final class KeyboardBar: UIInputView {
    var onKey: ((String) -> Void)?
    /// Text from the system Paste button
    var onPaste: ((String) -> Void)?
    var onDismiss: (() -> Void)?
    /// The bar is in a window exactly while the keyboard shows
    var onVisibilityChange: ((Bool) -> Void)?

    /// The page's key row context: "claude-up", "claude", "shell" or "chat"
    var context = "claude-up" {
        didSet { if context != oldValue { build() } }
    }

    private struct Key {
        let title: String
        var symbol: String?
        let sequence: String
        var label: String?
        var destructive = false
        var repeats = false
        /// Held, a menu of these (title, sequence)
        var menu: [(String, String)] = []
    }

    private enum Item {
        case key(Key)
        case paste
    }

    /// Groups left of the hinge, then right of it, when the bar is split
    private struct KeySet {
        let left: [[Item]]
        let right: [[Item]]
    }

    private static let esc = Key(title: "Esc", sequence: "\u{1b}", label: "Escape")
    private static let shiftTab = Key(title: "⇧Tab", sequence: "\u{1b}[Z", label: "Shift Tab")
    private static let tab = Key(title: "Tab", sequence: "\t")
    private static let slash = Key(
        title: "/", sequence: "/", label: "Slash",
        menu: ["~", "|", ">", "-", "_"].map { ($0, $0) }
    )
    private static let at = Key(title: "@", sequence: "@", label: "At")
    private static let arrows: [Item] = [
        .key(Key(title: "", symbol: "arrow.left", sequence: "\u{1b}[D", label: "Left", repeats: true)),
        .key(Key(title: "", symbol: "arrow.up", sequence: "\u{1b}[A", label: "Up", repeats: true)),
        .key(Key(title: "", symbol: "arrow.down", sequence: "\u{1b}[B", label: "Down", repeats: true)),
        .key(Key(title: "", symbol: "arrow.right", sequence: "\u{1b}[C", label: "Right", repeats: true)),
    ]
    private static let newLine = Key(title: "⇧↵", sequence: "\n", label: "New line")
    private static let enter = Key(title: "", symbol: "return", sequence: "\r", label: "Return")
    private static let ctrlR = Key(title: "^R", sequence: "\u{12}", label: "Control R, history search")
    private static let ctrlC = Key(
        title: "^C", sequence: "\u{03}", label: "Control C", destructive: true,
        menu: [("^D", "\u{04}"), ("^Z", "\u{1a}"), ("^L", "\u{0c}")]
    )

    private static func set(for context: String) -> KeySet {
        switch context {
        case "shell":
            return KeySet(
                left: [[.key(tab), .key(ctrlR)], arrows],
                right: [[.key(slash)], [.key(enter), .paste], [.key(ctrlC)]]
            )
        case "chat":
            return KeySet(left: [[.paste]], right: [[.key(newLine)]])
        default:
            // Claude Code with the keyboard up (and "claude", sent while it comes up)
            return KeySet(
                left: [[.key(esc), .key(shiftTab), .key(tab)], [.key(slash), .key(at)]],
                right: [arrows, [.key(newLine), .paste], [.key(ctrlC)]]
            )
        }
    }

    /// No keys and no height: the page shows its own rows above the keyboard
    var collapsed = false {
        didSet {
            guard collapsed != oldValue else { return }
            built.forEach { $0.isHidden = collapsed }
            invalidateIntrinsicContentSize()
        }
    }

    /// How the keys are laid out; the bar rebuilds only when this or the context changes
    private enum Layout: Equatable {
        /// One scrolling row; compact on the closed Duo so Claude's row fits at 466
        case row(compact: Bool)
        /// Open flat: a group either side of the hinge
        case split
    }

    private var layout = Layout.row(compact: false)
    /// What build() added, so a rebuild leaves UIInputView's own views alone
    private var built: [UIView] = []
    /// Pins the split groups clear of the hinge (±20 pt)
    private var leftEnd: NSLayoutConstraint?
    private var rightStart: NSLayoutConstraint?

    private let haptics = UIImpactFeedbackGenerator(style: .light)
    private var repeatTimer: Timer?

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 52), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        // The system Paste button pastes into this view without the "Allow Paste" prompt
        pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [UTType.plainText.identifier])
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: collapsed ? 0 : 52)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        onVisibilityChange?(window != nil)
        setNeedsLayout()
    }

    /// Where the hinge crosses the bar: the middle of the screen, which the
    /// keyboard spans
    private var hinge: CGFloat? {
        guard let window else { return nil }
        return convert(CGPoint(x: window.bounds.midX, y: 0), from: window).x
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Open flat the inner display is wide enough to part the keys; a
        // phone in landscape just gets a gap in the middle
        let wanted: Layout = bounds.width >= 700 && hinge != nil ? .split : .row(compact: bounds.width < 600)
        if wanted != layout {
            layout = wanted
            build()
            return
        }
        if let hinge, let leftEnd, let rightStart {
            let left = hinge - 20, right = hinge + 20
            if leftEnd.constant != left { leftEnd.constant = left }
            if rightStart.constant != right { rightStart.constant = right }
        }
    }

    private func build() {
        repeatTimer?.invalidate()
        repeatTimer = nil
        built.forEach { $0.removeFromSuperview() }
        built = []
        leftEnd = nil
        rightStart = nil

        let keys = Self.set(for: context)
        let compact = layout == .row(compact: true)

        let dismiss = UIButton(configuration: .plain())
        dismiss.configuration?.image = UIImage(systemName: "keyboard.chevron.compact.down")
        dismiss.accessibilityLabel = "Hide keyboard"
        dismiss.addAction(UIAction { [weak self] _ in self?.onDismiss?() }, for: .touchUpInside)
        dismiss.translatesAutoresizingMaskIntoConstraints = false
        addSubview(dismiss)
        built.append(dismiss)
        let dismissWidth: CGFloat = compact ? 36 : 44
        NSLayoutConstraint.activate([
            dismiss.trailingAnchor.constraint(equalTo: trailingAnchor, constant: compact ? 0 : -4),
            dismiss.centerYAnchor.constraint(equalTo: centerYAnchor),
            dismiss.widthAnchor.constraint(equalToConstant: dismissWidth),
            dismiss.heightAnchor.constraint(equalToConstant: 44),
        ])

        if layout == .split {
            let left = stack(keys.left, compact: false)
            let right = stack(keys.right, compact: false)
            for view in [left, right] {
                view.translatesAutoresizingMaskIntoConstraints = false
                addSubview(view)
                built.append(view)
            }
            // Updated to the hinge in layoutSubviews
            let leftEnd = left.trailingAnchor.constraint(equalTo: leadingAnchor, constant: bounds.midX - 20)
            let rightStart = right.leadingAnchor.constraint(equalTo: leadingAnchor, constant: bounds.midX + 20)
            NSLayoutConstraint.activate([
                leftEnd,
                rightStart,
                left.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 8),
                right.trailingAnchor.constraint(lessThanOrEqualTo: dismiss.leadingAnchor, constant: -8),
                left.centerYAnchor.constraint(equalTo: centerYAnchor),
                right.centerYAnchor.constraint(equalTo: centerYAnchor),
                left.heightAnchor.constraint(equalToConstant: 40),
                right.heightAnchor.constraint(equalToConstant: 40),
            ])
            self.leftEnd = leftEnd
            self.rightStart = rightStart
        } else {
            let row = stack(keys.left + keys.right, compact: compact)
            let scroll = UIScrollView()
            scroll.showsHorizontalScrollIndicator = false
            scroll.alwaysBounceHorizontal = false
            scroll.addSubview(row)
            for view in [scroll, row] { view.translatesAutoresizingMaskIntoConstraints = false }
            addSubview(scroll)
            built.append(scroll)
            let inset: CGFloat = compact ? 4 : 8
            NSLayoutConstraint.activate([
                // The keyboard runs the full width, so the bar does too; its safe
                // area would leave the system column's inset beside the keyboard
                scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
                scroll.topAnchor.constraint(equalTo: topAnchor),
                scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
                scroll.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor),

                row.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: inset),
                row.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -inset),
                row.centerYAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerYAnchor),
                row.heightAnchor.constraint(equalToConstant: 40),
                scroll.contentLayoutGuide.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            ])
        }
        built.forEach { $0.isHidden = collapsed }
    }

    /// Groups side by side, set apart from each other
    private func stack(_ groups: [[Item]], compact: Bool) -> UIStackView {
        let rows = groups.map { group in
            let row = UIStackView(arrangedSubviews: group.map { itemView($0, compact: compact) })
            row.spacing = compact ? 3 : 6
            return row
        }
        let stack = UIStackView(arrangedSubviews: rows)
        stack.spacing = compact ? 6 : 16
        return stack
    }

    private func itemView(_ item: Item, compact: Bool) -> UIView {
        switch item {
        case .key(let key):
            return button(key, compact: compact)
        case .paste:
            var paste = UIPasteControl.Configuration()
            paste.displayMode = .iconOnly
            paste.cornerStyle = .medium
            let control = UIPasteControl(configuration: paste)
            control.target = self
            control.widthAnchor.constraint(equalToConstant: compact ? 40 : 44).isActive = true
            return control
        }
    }

    private func button(_ key: Key, compact: Bool) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.cornerStyle = .medium
        let inset: CGFloat = compact ? 4 : 10
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: inset, bottom: 0, trailing: inset)
        if let symbol = key.symbol {
            config.image = UIImage(systemName: symbol)
        } else {
            var title = AttributedString(key.title)
            title.font = .monospacedSystemFont(ofSize: compact ? 14 : 15, weight: .medium)
            config.attributedTitle = title
        }
        if key.destructive { config.baseForegroundColor = .systemRed }

        let button = UIButton(configuration: config)
        button.accessibilityLabel = key.label ?? key.title
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: compact ? 28 : 44).isActive = true
        if !key.menu.isEmpty {
            // Held: the rarer keys; a tap still sends the key itself
            button.menu = UIMenu(children: key.menu.map { title, sequence in
                UIAction(title: title) { [weak self] _ in
                    self?.haptics.impactOccurred()
                    self?.onKey?(sequence)
                }
            })
            button.showsMenuAsPrimaryAction = false
        }
        if key.repeats {
            // Fires on touch down, then again after a pause while held
            button.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.press(key)
                self.repeatTimer?.invalidate()
                self.repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
                    self?.repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                        self?.onKey?(key.sequence)
                    }
                }
            }, for: .touchDown)
            button.addAction(UIAction { [weak self] _ in
                self?.repeatTimer?.invalidate()
                self?.repeatTimer = nil
            }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
        } else {
            button.addAction(UIAction { [weak self] _ in self?.press(key) }, for: .touchUpInside)
        }
        return button
    }

    override func paste(itemProviders: [NSItemProvider]) {
        guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: String.self) }) else { return }
        _ = provider.loadObject(ofClass: String.self) { [weak self] text, _ in
            guard let text, !text.isEmpty else { return }
            DispatchQueue.main.async { self?.onPaste?(text) }
        }
    }

    private func press(_ key: Key) {
        haptics.impactOccurred()
        onKey?(key.sequence)
    }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil {
            repeatTimer?.invalidate()
            repeatTimer = nil
        }
    }
}
