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
        /// Sent after the key, apart (Esc Esc, ^B twice for tmux)
        var followUp: [String] = []
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
    /// `id`, or `id/flick/hold` when the page sets them: a flick key's id
    /// (empty: none) and "repeat" or "menu" (empty: neither)
    private static func item(for spec: String) -> (item: Item, group: String)? {
        let parts = spec.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let id = parts[0]
        guard var entry = baseItem(for: id) else { return nil }
        guard case .key(var key) = entry.item else { return entry }
        if parts.count > 1 {
            key.flick = parts[1].isEmpty ? nil : flick(for: parts[1])
            let hold = parts.count > 2 ? parts[2] : ""
            key.repeats = hold == "repeat"
            if hold != "menu" { key.menu = [] }
        } else if let flick = flicks[id] {
            key.flick = flick
        }
        entry.item = .key(key)
        return entry
    }

    /// Another key as a flick: its title and what it sends
    private static func flick(for id: String) -> (title: String, sequences: [String])? {
        guard case .key(let key)? = baseItem(for: id)?.item else { return nil }
        let symbols = ["arrow-left": "←", "arrow-up": "↑", "arrow-down": "↓", "arrow-right": "→", "enter": "↵", "backspace": "⌫"]
        return (key.title.isEmpty ? symbols[id] ?? id : key.title, [key.sequence] + key.followUp)
    }

    /// The adaptive row's flicks (lib/adaptive-keys.ts); arrows flick too
    /// and repeat when held
    private static let flicks: [String: (title: String, sequences: [String])] = [
        "esc": ("^C", ["\u{03}"]),
        "tab": ("⇧Tab", ["\u{1b}[Z"]),
        "shift-tab": ("Tab", ["\t"]),
        "enter": ("⇧↵", ["\n"]),
        "ctrl-c": ("^D", ["\u{04}"]),
        "char-slash": ("@", ["@"]),
        "ctrl-r": ("^L", ["\u{0c}"]),
        "arrow-up": ("PgUp", ["\u{1b}[5~"]),
        "arrow-down": ("PgDn", ["\u{1b}[6~"]),
        "arrow-left": ("Home", ["\u{1b}[H"]),
        "arrow-right": ("End", ["\u{1b}[F"]),
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
        // The system Paste button keeps its own corners, so it stands alone
        case "paste": return (.paste, "paste")
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
        case "char-bang": return (.key(Key(title: "!", sequence: "!", label: "Shell mode")), "shell")
        case "char-question": return (.key(Key(title: "?", sequence: "?", label: "Shortcuts")), "shell")
        case "page-up": return (.key(Key(title: "PgUp", sequence: "\u{1b}[5~", label: "Page up")), "nav")
        case "page-down": return (.key(Key(title: "PgDn", sequence: "\u{1b}[6~", label: "Page down")), "nav")
        case "home": return (.key(Key(title: "Home", sequence: "\u{1b}[H")), "nav")
        case "end": return (.key(Key(title: "End", sequence: "\u{1b}[F")), "nav")
        case "esc-esc":
            return (.key(Key(title: "Esc Esc", sequence: "\u{1b}", label: "Escape twice, rewind", followUp: ["\u{1b}"])), "control")
        case "more": return (.allKeys, "more")
        default:
            guard let extra = claudeKeys[id] ?? editKeys[id] else { return nil }
            return (.key(extra), claudeKeys[id] != nil ? "claude" : "edit")
        }
    }

    /// Claude Code's own shortcuts (code.claude.com/docs/en/interactive-mode)
    private static let claudeKeys: [String: Key] = [
        "ctrl-o": Key(title: "^O", sequence: "\u{0f}", label: "Transcript"),
        "ctrl-t": Key(title: "^T", sequence: "\u{14}", label: "To-do list"),
        // tmux takes the first ^B as its prefix
        "ctrl-b": Key(title: "^B", sequence: "\u{02}", label: "Background task", followUp: ["\u{02}"]),
        "alt-p": Key(title: "⌥P", sequence: "\u{1b}p", label: "Switch model"),
        "alt-o": Key(title: "⌥O", sequence: "\u{1b}o", label: "Fast mode"),
        "ctrl-g": Key(title: "^G", sequence: "\u{07}", label: "Edit in editor"),
        "ctrl-s": Key(title: "^S", sequence: "\u{13}", label: "Stash prompt"),
        "send-queued": Key(title: "^X^S", sequence: "\u{18}", label: "Send queued now", followUp: ["\u{13}"]),
        "ctrl-underscore": Key(title: "^_", sequence: "\u{1f}", label: "Undo edit"),
    ]

    /// The prompt's line editing
    private static let editKeys: [String: Key] = [
        "ctrl-a": Key(title: "^A", sequence: "\u{01}", label: "Line start"),
        "ctrl-e": Key(title: "^E", sequence: "\u{05}", label: "Line end"),
        "ctrl-k": Key(title: "^K", sequence: "\u{0b}", label: "Delete to line end"),
        "ctrl-u": Key(title: "^U", sequence: "\u{15}", label: "Delete to line start"),
        "ctrl-w": Key(title: "^W", sequence: "\u{17}", label: "Delete word"),
        "ctrl-y": Key(title: "^Y", sequence: "\u{19}", label: "Paste deleted text"),
        "alt-b": Key(title: "⌥B", sequence: "\u{1b}b", label: "Word back"),
        "alt-f": Key(title: "⌥F", sequence: "\u{1b}f", label: "Word forward"),
    ]

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

    /// No bar: the page shows its own rows above the keyboard
    /// (AgentWebView answers no accessory and reloads the keyboard's)
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

    /// A tap; ^C knocks harder, a flick bumps, a held key ticks softly as
    /// it repeats, and a flick ticks as it passes the point where it counts
    /// The theme's accent, for a held key
    var accent: UIColor?
    private let haptics = UIImpactFeedbackGenerator(style: .light)
    private let knock = UIImpactFeedbackGenerator(style: .rigid)
    private let bump = UIImpactFeedbackGenerator(style: .medium)
    private let tick = UISelectionFeedbackGenerator()
    private let repeatTick = UIImpactFeedbackGenerator(style: .soft)
    private var repeatTimer: Timer?
    /// The held key started repeating, so letting go sends nothing more
    private var repeated = false

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
        // Collapsed, it leaves with the keyboard still up: the keyboard's
        // notifications report instead (AgentWebView)
        if !collapsed { onVisibilityChange?(window != nil) }
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
        let placed = (keys.left + keys.right).contains { group in
            group.contains { if case .allKeys = $0 { return true } else { return false } }
        }
        if context != "chat", !placed {
            // ⋯ last: every key, whatever the row leaves out
            var right = keys.right.isEmpty ? keys.left : keys.right
            if right.isEmpty { right = [[]] }
            right.append([.allKeys])
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
        if context != "chat", let ids, !ids.contains(where: { $0 == "image" || $0.hasPrefix("image/") }) {
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
                hug(view)
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
            hug(row)
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

    /// Keys at their own widths: with one edge pinned (the hinge) and the
    /// other only bounded, a half filled its page by stretching a key. Held
    /// at its measured width, above any key's hugging but under its
    /// compression resistance, so a label is never cut to fit
    private func hug(_ stack: UIView) {
        let width = stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).width
        let snug = stack.widthAnchor.constraint(equalToConstant: width)
        snug.priority = .defaultHigh - 1
        snug.isActive = true
    }

    /// Groups side by side, set apart from each other
    /// Each group one segmented control: its keys 2 pt apart, round only
    /// at the group's ends
    private func stack(_ groups: [[Item]], compact: Bool) -> UIStackView {
        let rows = groups.map { group in
            let views = group.map { itemView($0, compact: compact) }
            for (index, view) in views.enumerated() {
                segment(view, first: index == 0, last: index == views.count - 1)
            }
            let row = UIStackView(arrangedSubviews: views)
            row.spacing = 2
            return row
        }
        let stack = UIStackView(arrangedSubviews: rows)
        stack.spacing = compact ? 7 : 16
        return stack
    }

    /// Keys and tools a shade apart, as the keyboard's letter and function keys
    private static let keyColor = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.24, green: 0.24, blue: 0.26, alpha: 1) : .white }
    private static let toolColor = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.18, green: 0.18, blue: 0.20, alpha: 1)
        : UIColor(red: 0.68, green: 0.70, blue: 0.74, alpha: 1) }

    /// A raised cap, 10 pt round at the group's ends and 3 pt inside it;
    /// held (or flicked past the point where it counts) it takes the theme's accent
    private func segment(_ view: UIView, first: Bool, last: Bool) {
        guard let button = view as? UIButton, var config = button.configuration else { return }
        let fill = config.baseBackgroundColor ?? Self.keyColor
        let ink = config.baseForegroundColor ?? .label
        let cap = KeyCap(fill: fill, leading: first ? 10 : 3, trailing: last ? 10 : 3)
        config.background.customView = cap
        config.background.cornerRadius = 0
        button.configuration = config
        button.configurationUpdateHandler = { [weak self] button in
            let lit = button.isHighlighted || (button as? KeyButton)?.armed == true
            cap.fill = lit ? self?.accent ?? .systemPurple : fill
            var config = button.configuration
            config?.baseForegroundColor = lit ? .white : ink
            if let key = button as? KeyButton, let rest = key.restTitle {
                config?.attributedTitle = key.armed ? key.flickTitle : rest
                config?.image = key.armed ? nil : key.restImage
            }
            button.configuration = config
        }
    }

    private func itemView(_ item: Item, compact: Bool) -> UIView {
        switch item {
        case .key(let key):
            return button(key, compact: compact)
        case .paste:
            var paste = UIPasteControl.Configuration()
            paste.displayMode = .iconOnly
            paste.cornerStyle = .fixed
            paste.cornerRadius = 10
            paste.baseBackgroundColor = Self.toolColor
            paste.baseForegroundColor = .label
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
        config.baseBackgroundColor = Self.keyColor
        config.baseForegroundColor = key.destructive ? .systemRed : .label

        let button = KeyButton(configuration: config)
        if let flick = key.flick {
            // Flicked past the point where it counts, the key shows what it will send
            var title = AttributedString(flick.title)
            title.font = .monospacedSystemFont(ofSize: compact ? 14 : 15, weight: .semibold)
            button.flickTitle = title
            button.restTitle = config.attributedTitle ?? AttributedString("")
            button.restImage = config.image
        }
        // Ready the tap's haptic as the finger lands
        button.addAction(UIAction { [weak self] _ in self?.haptics.prepare() }, for: .touchDown)
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
        if key.repeats, key.flick != nil {
            // Not at once, so a flick sends only its own key: held a moment
            // it presses and repeats, let go before that it presses once
            button.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.repeated = false
                self.repeatTimer?.invalidate()
                self.repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { [weak self] _ in
                    guard let self else { return }
                    self.repeated = true
                    self.press(key)
                    self.startRepeating(key)
                }
            }, for: .touchDown)
            button.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.repeatTimer?.invalidate()
                self.repeatTimer = nil
                if !self.repeated { self.press(key) }
                self.repeated = false
            }, for: .touchUpInside)
            button.addAction(UIAction { [weak self] _ in
                self?.repeatTimer?.invalidate()
                self?.repeatTimer = nil
                self?.repeated = false
            }, for: [.touchUpOutside, .touchCancel])
        } else if key.repeats {
            // Fires on touch down, then again after a pause while held
            button.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.press(key)
                self.repeatTimer?.invalidate()
                self.repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
                    self?.startRepeating(key)
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
        config.baseBackgroundColor = Self.toolColor
        config.baseForegroundColor = .label
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
            UIMenu(title: "Claude Code", options: .displayInline, children: [
                "ctrl-o", "ctrl-t", "ctrl-b", "alt-p", "alt-o", "ctrl-g", "ctrl-s", "send-queued", "ctrl-underscore",
            ].compactMap { id in
                Self.claudeKeys[id].map { key in
                    UIAction(title: "\(key.label ?? key.title)  \(key.title)") { _ in send([key.sequence] + key.followUp) }
                }
            }),
            UIMenu(title: "Editing", options: .displayInline, children: [
                "ctrl-a", "ctrl-e", "alt-b", "alt-f", "ctrl-w", "ctrl-k", "ctrl-u", "ctrl-y",
            ].compactMap { id in
                Self.editKeys[id].map { key in
                    UIAction(title: "\(key.label ?? key.title)  \(key.title)") { _ in send([key.sequence]) }
                }
            }),
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
        config.baseBackgroundColor = Self.toolColor
        config.baseForegroundColor = .label
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
        pan.corner = corner
        button.addGestureRecognizer(pan)
    }

    @objc private func flicked(_ pan: FlickGesture) {
        let armed = pan.translation(in: pan.view).y < -18
        switch pan.state {
        case .began:
            tick.prepare()
            bump.prepare()
        case .changed:
            // Past the point where it counts: a tick, and the corner key lights
            if armed != pan.armed {
                pan.armed = armed
                (pan.view as? KeyButton)?.armed = armed
                tick.selectionChanged()
                pan.corner?.textColor = armed ? .label : .secondaryLabel
                pan.corner?.font = .systemFont(ofSize: 9, weight: armed ? .bold : .regular)
            }
        default:
            break
        }
        guard pan.state == .ended || pan.state == .cancelled || pan.state == .failed else { return }
        pan.armed = false
        (pan.view as? KeyButton)?.armed = false
        pan.corner?.textColor = .secondaryLabel
        pan.corner?.font = .systemFont(ofSize: 9)
        guard pan.state == .ended, armed else { return }
        bump.impactOccurred()
        send(pan.sequences)
    }

    override func paste(itemProviders: [NSItemProvider]) {
        guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: String.self) }) else { return }
        _ = provider.loadObject(ofClass: String.self) { [weak self] text, _ in
            guard let text, !text.isEmpty else { return }
            DispatchQueue.main.async { self?.onPaste?(text) }
        }
    }

    private func press(_ key: Key) {
        if key.destructive { knock.impactOccurred() } else { haptics.impactOccurred() }
        send([key.sequence] + key.followUp)
    }

    /// Sequences apart, 80 ms between (two Escs in one chunk read as Alt+Esc)
    private func send(_ sequences: [String]) {
        for (index, sequence) in sequences.enumerated() {
            if index == 0 { onKey?(sequence) } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08 * Double(index)) { [weak self] in
                    self?.onKey?(sequence)
                }
            }
        }
    }

    /// Held: the key again every 80 ms, each with a soft tick
    private func startRepeating(_ key: Key) {
        repeatTick.prepare()
        repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            self?.repeatTick.impactOccurred(intensity: 0.5)
            self?.onKey?(key.sequence)
        }
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
    /// The key's corner label, lit while the flick would send it
    weak var corner: UILabel?
    /// Past the flick point
    var armed = false

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard state == .began || state == .possible, let view else { return }
        let t = translation(in: view)
        if t.y > 6 || abs(t.x) > abs(t.y) + 8 { state = .failed }
    }
}

/// A key that can show its flick in place of its own title
private final class KeyButton: UIButton {
    var armed = false {
        didSet { if armed != oldValue { setNeedsUpdateConfiguration() } }
    }
    var restTitle: AttributedString?
    var restImage: UIImage?
    var flickTitle: AttributedString?
}

/// A key's raised face: its fill, a lit top edge and a hard 1 pt drop edge,
/// with its own corners either side (round at a group's ends)
private final class KeyCap: UIView {
    private let face = UIView()
    private let shine = UIView()
    private let shape = CAShapeLayer()
    private let leading: CGFloat
    private let trailing: CGFloat

    var fill: UIColor {
        didSet { face.backgroundColor = fill }
    }

    init(fill: UIColor, leading: CGFloat, trailing: CGFloat) {
        self.fill = fill
        self.leading = leading
        self.trailing = trailing
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        face.backgroundColor = fill
        face.layer.mask = shape
        shine.backgroundColor = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.07) : UIColor(white: 1, alpha: 0.9) }
        face.addSubview(shine)
        addSubview(face)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOffset = CGSize(width: 0, height: 1)
        layer.shadowRadius = 0
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        face.frame = bounds
        shine.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1)
        let path = Self.path(bounds, leading: leading, trailing: trailing)
        shape.path = path
        layer.shadowPath = path
        layer.shadowOpacity = traitCollection.userInterfaceStyle == .dark ? 0.55 : 0.3
    }

    /// A rect with one corner radius on the left and another on the right
    private static func path(_ rect: CGRect, leading: CGFloat, trailing: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let l = min(leading, rect.height / 2), r = min(trailing, rect.height / 2)
        path.move(to: CGPoint(x: rect.minX + l, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + r), radius: r)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - r, y: rect.maxY), radius: r)
        path.addLine(to: CGPoint(x: rect.minX + l, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - l), radius: l)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + l))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + l, y: rect.minY), radius: l)
        path.closeSubpath()
        return path
    }
}
