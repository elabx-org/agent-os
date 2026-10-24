import UIKit

/// The terminal keys Claude Code needs, on the keyboard itself: Esc, Tab,
/// ^C set apart, the arrows and a new line, then a key to put the keyboard away.
final class KeyboardBar: UIInputView {
    var onKey: ((String) -> Void)?
    var onDismiss: (() -> Void)?
    /// The bar is in a window exactly while the keyboard shows
    var onVisibilityChange: ((Bool) -> Void)?

    private struct Key {
        let title: String
        var symbol: String?
        let sequence: String
        var label: String?
        var destructive = false
    }

    private let groups: [[Key]] = [
        [
            Key(title: "Esc", sequence: "\u{1b}", label: "Escape"),
            Key(title: "Tab", sequence: "\t"),
        ],
        [Key(title: "^C", sequence: "\u{03}", label: "Control C", destructive: true)],
        [
            Key(title: "", symbol: "arrow.left", sequence: "\u{1b}[D", label: "Left"),
            Key(title: "", symbol: "arrow.up", sequence: "\u{1b}[A", label: "Up"),
            Key(title: "", symbol: "arrow.down", sequence: "\u{1b}[B", label: "Down"),
            Key(title: "", symbol: "arrow.right", sequence: "\u{1b}[C", label: "Right"),
        ],
        [Key(title: "", symbol: "return", sequence: "\n", label: "New line")],
    ]

    private let haptics = UIImpactFeedbackGenerator(style: .light)

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 52), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: 52)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        onVisibilityChange?(window != nil)
    }

    private func build() {
        let keys = UIStackView(arrangedSubviews: groups.map { group in
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
            scroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            scroll.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor),
            dismiss.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -4),
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
        button.addAction(UIAction { [weak self] _ in
            self?.haptics.impactOccurred()
            self?.onKey?(key.sequence)
        }, for: .touchUpInside)
        return button
    }
}
