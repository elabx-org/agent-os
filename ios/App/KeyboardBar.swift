import UIKit
import UniformTypeIdentifiers

/// The terminal keys Claude Code needs, on the keyboard itself: Esc, Tab and
/// Shift-Tab, ^C set apart, the arrows (they repeat while held), / and @ for
/// the pickers, a new line, then a key to put the keyboard away. Paste and
/// Add image come first.
final class KeyboardBar: UIInputView {
    var onKey: ((String) -> Void)?
    /// Text from the system Paste button
    var onPaste: ((String) -> Void)?
    var onDismiss: (() -> Void)?
    /// The page's image picker, for attaching a screenshot or photo
    var onImage: (() -> Void)?
    /// The bar is in a window exactly while the keyboard shows
    var onVisibilityChange: ((Bool) -> Void)?

    private struct Key {
        let title: String
        var symbol: String?
        let sequence: String
        var label: String?
        var destructive = false
        var repeats = false
    }

    private let groups: [[Key]] = [
        [
            Key(title: "Esc", sequence: "\u{1b}", label: "Escape"),
            Key(title: "Tab", sequence: "\t"),
            Key(title: "⇧Tab", sequence: "\u{1b}[Z", label: "Shift Tab"),
        ],
        [Key(title: "^C", sequence: "\u{03}", label: "Control C", destructive: true)],
        [
            Key(title: "", symbol: "arrow.left", sequence: "\u{1b}[D", label: "Left", repeats: true),
            Key(title: "", symbol: "arrow.up", sequence: "\u{1b}[A", label: "Up", repeats: true),
            Key(title: "", symbol: "arrow.down", sequence: "\u{1b}[B", label: "Down", repeats: true),
            Key(title: "", symbol: "arrow.right", sequence: "\u{1b}[C", label: "Right", repeats: true),
        ],
        [
            Key(title: "/", sequence: "/", label: "Slash"),
            Key(title: "@", sequence: "@", label: "At"),
        ],
        [Key(title: "", symbol: "return", sequence: "\n", label: "New line")],
    ]

    /// No keys and no height: the page shows its own rows above the keyboard
    var collapsed = false {
        didSet {
            guard collapsed != oldValue else { return }
            subviews.forEach { $0.isHidden = collapsed }
            invalidateIntrinsicContentSize()
        }
    }

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
    }

    private func build() {
        var paste = UIPasteControl.Configuration()
        paste.displayMode = .iconOnly
        paste.cornerStyle = .medium
        let pasteControl = UIPasteControl(configuration: paste)
        pasteControl.target = self
        pasteControl.widthAnchor.constraint(equalToConstant: 44).isActive = true

        var imageConfig = UIButton.Configuration.gray()
        imageConfig.cornerStyle = .medium
        imageConfig.image = UIImage(systemName: "photo.badge.plus")
        let image = UIButton(configuration: imageConfig)
        image.accessibilityLabel = "Add image"
        image.widthAnchor.constraint(equalToConstant: 44).isActive = true
        image.addAction(UIAction { [weak self] _ in
            self?.haptics.impactOccurred()
            self?.onImage?()
        }, for: .touchUpInside)

        let tools = UIStackView(arrangedSubviews: [pasteControl, image])
        tools.spacing = 6

        let keys = UIStackView(arrangedSubviews: [tools] + groups.map { group in
            let row = UIStackView(arrangedSubviews: group.map(button))
            row.spacing = 6
            return row
        })
        keys.spacing = 16

        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceHorizontal = false
        scroll.addSubview(keys)

        let dismiss = UIButton(configuration: .plain())
        dismiss.configuration?.image = UIImage(systemName: "keyboard.chevron.compact.down")
        dismiss.accessibilityLabel = "Hide keyboard"
        dismiss.addAction(UIAction { [weak self] _ in self?.onDismiss?() }, for: .touchUpInside)

        for view in [scroll, keys, dismiss] { view.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(scroll)
        addSubview(dismiss)
        NSLayoutConstraint.activate([
            // The keyboard runs the full width, so the bar does too; its safe
            // area would leave the system column's inset beside the keyboard
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            scroll.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor),
            dismiss.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
            dismiss.centerYAnchor.constraint(equalTo: centerYAnchor),
            dismiss.widthAnchor.constraint(equalToConstant: 44),
            dismiss.heightAnchor.constraint(equalToConstant: 44),

            keys.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            keys.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            keys.centerYAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerYAnchor),
            keys.heightAnchor.constraint(equalToConstant: 40),
            scroll.contentLayoutGuide.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
        ])
    }

    private func button(_ key: Key) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 10)
        if let symbol = key.symbol {
            config.image = UIImage(systemName: symbol)
        } else {
            var title = AttributedString(key.title)
            title.font = .monospacedSystemFont(ofSize: 15, weight: .medium)
            config.attributedTitle = title
        }
        if key.destructive { config.baseForegroundColor = .systemRed }

        let button = UIButton(configuration: config)
        button.accessibilityLabel = key.label ?? key.title
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
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
