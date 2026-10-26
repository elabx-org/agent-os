import UIKit
import UIKit.UIGestureRecognizerSubclass
import UniformTypeIdentifiers

/// The terminal keys Claude Code needs, on the keyboard itself, following
/// what the page says you're in (its `keys` message): Claude Code with the
/// keyboard up, a plain shell, or the chat box, in the user's key order when
/// the page sends one. ^C and / hold rarer keys behind a long press. Open
/// flat on iPhone Duo the keys part around the hinge; a key to put the
/// keyboard away sits at the edge.
final class KeyboardBar: UIInputView {
    var onKey: ((String) -> Void)?
    /// Text from the system Paste button
    var onPaste: ((String) -> Void)?
    /// Add image: the page's picker (not in the chat box, which has none)
    var onImage: (() -> Void)?
    /// Copy: the page's select mode, to pick text on the screen
    var onSelect: (() -> Void)?
    /// File: the page's snippets sheet
    var onSnippets: (() -> Void)?
    var onDismiss: (() -> Void)?
    /// The bar is in a window exactly while the keyboard shows
    var onVisibilityChange: ((Bool) -> Void)?

    /// The page's key row context: "claude-up", "claude", "shell" or "chat"
    private(set) var context = "claude-up"
    /// The page's key order for that context (the user's Keys settings), if
    /// it sent one; older pages don't, and the bar keeps its own sets
    private(set) var ids: [String]?

    /// The page's `keys` message; rebuilds once, only when something changed
    func setKeys(context: String, ids: [String]?) {
        guard context != self.context || ids != self.ids else { return }
        self.context = context
        self.ids = ids
        // A new row gets its own chance to part around the hinge
        splitOverflows = false
        let wanted = wantedLayout
        if wanted != layout { layout = wanted }
        build()
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
        /// A flick up sends these instead (apart), shown small in the corner
        var flick: (title: String, sequences: [String])?
    }

    private enum Item {
        case key(Key)
        case paste
        /// A key the page answers with a sheet or a mode
        case tool(Tool)
        /// ⋯: every key, as a menu
        case allKeys
    }

    private enum Tool {
        case select, image, snippets
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

    private static let space = Key(title: "Space", sequence: " ")
    private static let backspace = Key(
        title: "", symbol: "delete.left", sequence: "\u{7f}", label: "Delete", repeats: true
    )

    /// A page key id (components/Terminal/toolbar-config.ts) as a bar item,
    /// with the web row's group so runs of a kind sit together. Keys the bar
    /// can't offer (mic) are nil and skipped.
    private static func item(for id: String) -> (item: Item, group: String)? {
        guard var entry = baseItem(for: id) else { return nil }
        if case .key(var key) = entry.item, !key.repeats, let flick = flicks[id] {
            key.flick = flick
            entry.item = .key(key)
        }
        return entry
    }

    /// The adaptive row's flicks (lib/adaptive-keys.ts); arrows repeat when
    /// held instead
    private static let flicks: [String: (title: String, sequences: [String])] = [
        "esc": ("Esc Esc", ["\u{1b}", "\u{1b}"]),
        "tab": ("⇧Tab", ["\u{1b}[Z"]),
        "shift-tab": ("Tab", ["\t"]),
        "enter": ("⇧↵", ["\n"]),
        "ctrl-c": ("^D", ["\u{04}"]),
        "char-slash": ("@", ["@"]),
        "ctrl-r": ("^L", ["\u{0c}"]),
    ]

    private static func baseItem(for id: String) -> (item: Item, group: String)? {
        if id.hasPrefix("digit-") {
            let digit = String(id.dropFirst(6))
            return (.key(Key(title: digit, sequence: digit, label: "Option \(digit)")), "digits")
        }
        switch id {
        // With Tab and ⇧Tab, as the bar's own sets have it
        case "esc": return (.key(esc), "control")
        case "enter": return (.key(enter), "editing")
        case "newline": return (.key(newLine), "editing")
        // The page's cursor key is space on a tap
        case "cursor": return (.key(space), "editing")
        case "backspace": return (.key(backspace), "editing")
        case "paste": return (.paste, "tools")
        case "select": return (.tool(.select), "tools")
        case "image": return (.tool(.image), "tools")
        case "snippets": return (.tool(.snippets), "tools")
        case "ctrl-c": return (.key(ctrlC), "control")
        case "ctrl-d": return (.key(Key(title: "^D", sequence: "\u{04}", label: "Control D")), "control")
        case "ctrl-z": return (.key(Key(title: "^Z", sequence: "\u{1a}", label: "Control Z")), "control")
        case "ctrl-l": return (.key(Key(title: "^L", sequence: "\u{0c}", label: "Control L")), "control")
        case "ctrl-r": return (.key(ctrlR), "control")
        case "tab": return (.key(tab), "control")
        case "shift-tab": return (.key(shiftTab), "control")
        case "arrow-left": return (arrows[0], "nav")
        case "arrow-up": return (arrows[1], "nav")
        case "arrow-down": return (arrows[2], "nav")
        case "arrow-right": return (arrows[3], "nav")
        case "char-slash": return (.key(slash), "shell")
        case "char-at": return (.key(at), "shell")
        case "char-tilde": return (.key(Key(title: "~", sequence: "~", label: "Tilde")), "shell")
        case "char-pipe": return (.key(Key(title: "|", sequence: "|", label: "Pipe")), "shell")
        case "char-gt": return (.key(Key(title: ">", sequence: ">", label: "Greater than")), "shell")
        default: return nil
        }
    }

    /// Consecutive keys of the same kind as one group
    private static func groups(_ entries: [(item: Item, group: String)]) -> [[Item]] {
        var result: [[Item]] = []
        var last: String?
        for entry in entries {
            if entry.group == last, !result.isEmpty {
                result[result.count - 1].append(entry.item)
            } else {
                result.append([entry.item])
            }
            last = entry.group
        }
        return result
    }

    /// The page's order, parted where a group ends nearest the middle (so the
    /// arrows stay together) when split; nil when it leaves nothing to show
    private static func set(ids: [String]) -> KeySet? {
        let all = groups(ids.compactMap(item(for:)))
        guard !all.isEmpty else { return nil }
        guard all.count > 1 else {
            let keys = all[0], half = (keys.count + 1) / 2
            return KeySet(left: [Array(keys[..<half])], right: half < keys.count ? [Array(keys[half...])] : [])
        }
        let total = all.reduce(0) { $0 + $1.count }
        var cut = 1, before = all[0].count
        var best = abs(2 * before - total)
        for index in 1..<all.count - 1 {
            before += all[index].count
            let off = abs(2 * before - total)
            if off < best { best = off; cut = index + 1 }
        }
        return KeySet(left: Array(all[..<cut]), right: Array(all[cut...]))
    }

    /// Copy, Paste, Photo and File, first in every row
    private static let tools: [Item] = [.tool(.select), .paste, .tool(.image), .tool(.snippets)]

    private static func set(for context: String) -> KeySet {
        switch context {
        case "shell":
            return KeySet(
                left: [tools, [.key(tab), .key(ctrlR)]],
                right: [arrows, [.key(slash), .key(enter)], [.key(ctrlC)]]
            )
        case "chat":
            return KeySet(left: [[.paste]], right: [[.key(newLine)]])
        default:
            // Claude Code with the keyboard up (and "claude", sent while it comes up)
            return KeySet(
                left: [tools, [.key(esc), .key(shiftTab), .key(tab)]],
                right: [[.key(slash), .key(at)], arrows, [.key(newLine)], [.key(ctrlC)]]
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
    /// The user's row is too wide for a page either side of the hinge, so
    /// it scrolls as one row instead of running into the hinge or off the edge
    private var splitOverflows = false
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

    private var wantedLayout: Layout {
        bounds.width >= 700 && hinge != nil && !splitOverflows ? .split : .row(compact: bounds.width < 600)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Open flat the inner display is wide enough to part the keys; a
        // phone in landscape just gets a gap in the middle
        let wanted = wantedLayout
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

        var keys = ids.flatMap { Self.set(ids: $0) } ?? Self.set(for: context)
        if context != "chat" {
            // ⋯ last: every key, whatever the row leaves out
            var right = keys.right.isEmpty ? keys.left : keys.right
            if right.isEmpty { right = [[]] }
            right[right.count - 1].append(.allKeys)
            keys = keys.right.isEmpty
                ? KeySet(left: right, right: [])
                : KeySet(left: keys.left, right: right)
        }
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

        // Add image sits beside the hide-keyboard key, outside the key groups,
        // when the row has no Photo key of its own (the bar's own rows do)
        var trailing = dismiss.leadingAnchor
        if context != "chat", let ids, !ids.contains("image") {
            let image = UIButton(configuration: .plain())
            image.configuration?.image = UIImage(systemName: "photo.badge.plus")
            image.accessibilityLabel = "Add image"
            image.addAction(UIAction { [weak self] _ in self?.onImage?() }, for: .touchUpInside)
            image.translatesAutoresizingMaskIntoConstraints = false
            addSubview(image)
            built.append(image)
            NSLayoutConstraint.activate([
                image.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor),
                image.centerYAnchor.constraint(equalTo: centerYAnchor),
                image.widthAnchor.constraint(equalToConstant: dismissWidth),
                image.heightAnchor.constraint(equalToConstant: 44),
            ])
            trailing = image.leadingAnchor
        }

        if layout == .split {
            let left = stack(keys.left, compact: false)
            let right = stack(keys.right, compact: false)
            // Rows are the user's now, so check each half fits its page
            let middle = hinge ?? bounds.midX
            let leftRoom = middle - 20 - 8
            let rightRoom = bounds.width - 4 - dismissWidth - 8 - (middle + 20)
            let size = UIView.layoutFittingCompressedSize
            if left.systemLayoutSizeFitting(size).width > leftRoom
                || right.systemLayoutSizeFitting(size).width > rightRoom {
                splitOverflows = true
                layout = wantedLayout
                build()
                return
            }
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
                right.trailingAnchor.constraint(lessThanOrEqualTo: trailing, constant: -8),
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
                scroll.trailingAnchor.constraint(equalTo: trailing),

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
        case .tool(let tool):
            return toolButton(tool, compact: compact)
        case .allKeys:
            return allKeysButton(compact: compact)
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
        if let flick = key.flick {
            button.accessibilityHint = "Flick up for \(flick.title)"
            addFlick(flick, to: button)
        }
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

    /// Every key, as a menu: the row's override for what it leaves out
    private func allKeysButton(compact: Bool) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.cornerStyle = .medium
        config.image = UIImage(systemName: "ellipsis")
        let button = UIButton(configuration: config)
        button.accessibilityLabel = "All keys"
        button.widthAnchor.constraint(equalToConstant: compact ? 40 : 44).isActive = true
        let send = { [weak self] (sequences: [String]) in
            guard let self else { return }
            self.haptics.impactOccurred()
            for (index, sequence) in sequences.enumerated() {
                if index == 0 { self.onKey?(sequence) } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08 * Double(index)) { [weak self] in
                        self?.onKey?(sequence)
                    }
                }
            }
        }
        func keys(_ title: String, _ entries: [(String, String)]) -> UIMenu {
            UIMenu(title: title, options: .displayInline, children: entries.map { name, sequence in
                UIAction(title: name) { _ in send([sequence]) }
            })
        }
        let tools = UIMenu(title: "", options: .displayInline, children: [
            UIAction(title: "Copy", image: UIImage(systemName: "text.cursor")) { [weak self] _ in self?.onSelect?() },
            UIAction(title: "Paste", image: UIImage(systemName: "doc.on.clipboard")) { [weak self] _ in
                if let text = UIPasteboard.general.string, !text.isEmpty { self?.onPaste?(text) }
            },
            UIAction(title: "Photo", image: UIImage(systemName: "photo")) { [weak self] _ in self?.onImage?() },
            UIAction(title: "File", image: UIImage(systemName: "doc.text")) { [weak self] _ in self?.onSnippets?() },
        ])
        button.menu = UIMenu(title: "All keys", children: [
            tools,
            keys("Keys", [
                ("Esc", "\u{1b}"), ("Tab", "\t"), ("⇧Tab", "\u{1b}[Z"),
                ("↵ Return", "\r"), ("⇧↵ New line", "\n"), ("Space", " "), ("⌫ Delete", "\u{7f}"),
            ]),
            keys("Control", [
                ("^C", "\u{03}"), ("^D", "\u{04}"), ("^Z", "\u{1a}"), ("^L", "\u{0c}"), ("^R", "\u{12}"),
            ]),
            keys("Move", [
                ("← Left", "\u{1b}[D"), ("↑ Up", "\u{1b}[A"), ("↓ Down", "\u{1b}[B"), ("→ Right", "\u{1b}[C"),
                ("Home", "\u{1b}[H"), ("End", "\u{1b}[F"), ("Page up", "\u{1b}[5~"), ("Page down", "\u{1b}[6~"),
            ]),
            keys("Symbols", ["/", "@", "~", "|", ">", "-", "_"].map { ($0, $0) }),
            UIMenu(title: "", options: .displayInline, children: [
                UIAction(title: "Esc Esc") { _ in send(["\u{1b}", "\u{1b}"]) },
            ]),
        ])
        button.showsMenuAsPrimaryAction = true
        return button
    }

    private func toolButton(_ tool: Tool, compact: Bool) -> UIButton {
        let symbol: String, label: String
        switch tool {
        case .select: (symbol, label) = ("text.cursor", "Copy")
        case .image: (symbol, label) = ("photo", "Photo")
        case .snippets: (symbol, label) = ("doc.text", "File")
        }
        var config = UIButton.Configuration.gray()
        config.cornerStyle = .medium
        config.image = UIImage(systemName: symbol)
        let button = UIButton(configuration: config)
        button.accessibilityLabel = label
        button.widthAnchor.constraint(equalToConstant: compact ? 40 : 44).isActive = true
        button.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.haptics.impactOccurred()
            switch tool {
            case .select: self.onSelect?()
            case .image: self.onImage?()
            case .snippets: self.onSnippets?()
            }
        }, for: .touchUpInside)
        return button
    }

    /// The second key a flick up sends, small in the corner; the pan cancels
    /// the tap, so a flick never also sends the key itself
    private func addFlick(_ flick: (title: String, sequences: [String]), to button: UIButton) {
        let corner = UILabel()
        corner.text = flick.title
        corner.font = .systemFont(ofSize: 9)
        corner.textColor = .secondaryLabel
        corner.isUserInteractionEnabled = false
        corner.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(corner)
        NSLayoutConstraint.activate([
            corner.topAnchor.constraint(equalTo: button.topAnchor, constant: 2),
            corner.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -4),
        ])
        let pan = FlickGesture(target: self, action: #selector(flicked(_:)))
        pan.sequences = flick.sequences
        button.addGestureRecognizer(pan)
    }

    @objc private func flicked(_ pan: FlickGesture) {
        guard pan.state == .ended, pan.translation(in: pan.view).y < -18 else { return }
        haptics.impactOccurred()
        for (index, sequence) in pan.sequences.enumerated() {
            if index == 0 { onKey?(sequence) } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08 * Double(index)) { [weak self] in
                    self?.onKey?(sequence)
                }
            }
        }
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

/// A flick up on a key: only a mostly vertical, upward pan
private final class FlickGesture: UIPanGestureRecognizer {
    var sequences: [String] = []

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard state == .began || state == .possible, let view else { return }
        let t = translation(in: view)
        if t.y > 6 || abs(t.x) > abs(t.y) + 8 { state = .failed }
    }
}
