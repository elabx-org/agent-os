import SwiftUI

/// The page with Agent-OS's navigation in the system bar. Built with the
/// iOS 27.1 SDK, the bar goes vertical in the iPhone Duo's right-hand column
/// under the status glyphs; elsewhere it is the usual top bar.
struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack {
            AgentWebContainer(model: model)
                // Edge to edge: under the system column, so the page shows
                // through its Liquid Glass, and under the status strip at the
                // top. The page keeps its content clear of both (env(safe-area-*)).
                // Not the keyboard: the page still sits above it.
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .ignoresSafeArea(.all, edges: .trailing)
                // Half open: the page puts its input below the fold (laptop pose)
                .onGeometryChange(for: Fold?.self) { Fold($0) } action: { model.fold = $0 }
                // Whatever the page doesn't cover matches it, not the launch colour
                .background(model.pageBackground ?? Color("LaunchBackground"))
                .toolbarTitleDisplayMode(.inline)
                .navColumn(model: model, wide: sizeClass == .regular)
                .modifier(HingeReader { model.hinge(present: $0) })
        }
        .sheet(isPresented: $model.showingServer) {
            ServerSheet(model: model)
        }
        // The app's theme, not the phone's: Default light stays light in dark mode
        .preferredColorScheme(model.scheme)
        .overlay {
            if model.lock.locked || model.lock.covered {
                LockCover(lock: model.lock)
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            model.lock.phaseChanged(to: phase)
        }
    }
}

extension View {
    /// The app's column: the page's own (NativeState.column) when it sends
    /// one, else the fixed list; hidden only for an explicitly empty column,
    /// where the page draws its own tab bar or tabletop bar
    func navColumn(model: AppModel, wide: Bool) -> some View {
        toolbar { NavToolbar(model: model, wide: wide) }
            .toolbar(model.columnHidden ? .hidden : .automatic, for: .navigationBar)
    }
}

/// Whether the device has a hinge (iPhone Duo), once the system says
struct HingeReader: ViewModifier {
    let report: (Bool) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.onHingeChange { _, update in report(update.hinge != nil) }
        } else {
            content
        }
    }
}

struct NavToolbar: ToolbarContent {
    let model: AppModel
    /// The inner display (regular width): More offers Open beside
    let wide: Bool

    var body: some ToolbarContent {
        if let column = model.column {
            ColumnToolbar(model: model, items: column, wide: wide)
        } else {
            FixedToolbar(model: model)
        }
    }
}

/// The page's column, in its order: separators become gaps between the
/// glass groups, More a native menu. Each item sends its id as the nav
/// action, as the fixed list's buttons do
struct ColumnToolbar: ToolbarContent {
    let model: AppModel
    let items: [ColumnEntry]
    let wide: Bool

    private struct Slot: Identifiable {
        let id: String
        let item: ColumnEntry
        let gap: Bool
    }

    private var slots: [Slot] {
        items.enumerated().map { index, item in
            Slot(id: "\(index)-\(item.id)", item: item, gap: item.sep && index > 0)
        }
    }

    var body: some ToolbarContent {
        ForEach(slots) { slot in
            ColumnToolbarItem(model: model, item: slot.item, gap: slot.gap, wide: wide)
        }

        // Links minimised (Browser); only while there are any
        if !model.browser.pages.isEmpty {
            ToolbarItem(placement: .topBarTrailing) {
                PagesMenu(browser: model.browser)
            }
            .barPriority(true)
        }
    }
}

struct ColumnToolbarItem: ToolbarContent {
    let model: AppModel
    let item: ColumnEntry
    let gap: Bool
    let wide: Bool

    /// The page's accent, else Agent-OS purple (#7C3AED)
    private var accent: Color {
        model.accentColor ?? Color(red: 0x7C / 255, green: 0x3A / 255, blue: 0xED / 255)
    }

    var body: some ToolbarContent {
        if gap {
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
        }
        ToolbarItem(placement: .topBarTrailing) {
            if item.id == "more" {
                ColumnMoreMenu(model: model, item: item, wide: wide)
            } else if item.prominent {
                Button { model.nav(item.id) } label: { label }
                    .buttonStyle(.glassProminent)
                    .tint(accent)
                    .accessibilityAddTraits(item.selected ? .isSelected : [])
            } else {
                Button { model.nav(item.id) } label: { label }
                    .badge(item.amber ? 0 : item.badge)
                    .accessibilityAddTraits(item.selected ? .isSelected : [])
                    .accessibilityValue(item.badge > 0 ? "\(item.badge)" : "")
                    .tint(.primary)
            }
        }
        .barPriority(true)
        // The amber count's label is a view of its own, which the bar
        // would otherwise move out of the Duo's column into a top row
        .verticalInBar()
    }

    @ViewBuilder private var label: some View {
        if item.amber && item.badge > 0 {
            // The bar reduces a Label or Image to the symbol's shape (an
            // overlaid or drawn-in count came out monochrome), so this
            // label is a view of its own
            Image(systemName: item.symbolName)
                .symbolVariant(item.selected ? .fill : .none)
                .imageScale(.large)
                .frame(width: 32, height: 32)
                // An overlay, so the symbol stays centred in its slot
                .overlay(alignment: .topTrailing) {
                    AmberBadge(count: item.badge).offset(x: 8, y: -4)
                }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(item.label)
        } else {
            Label {
                Text(item.label)
            } icon: {
                Image(systemName: item.symbolName)
                    .symbolVariant(item.selected ? .fill : .none)
            }
        }
    }
}

/// Needs you's count: amber (--needs, #FBBF24) with dark text
struct AmberBadge: View {
    let count: Int

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 11, weight: .bold).monospacedDigit())
            .foregroundStyle(.black)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(Capsule().fill(Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)))
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// ⋯ as a native menu: what the web's More offers on this surface, then the
/// app's own Reload and Server
struct ColumnMoreMenu: View {
    let model: AppModel
    let item: ColumnEntry
    let wide: Bool

    var body: some View {
        let inSession = model.surface == "session" || model.surface == "beside"
        Menu {
            if inSession {
                let waiting = model.focus ? 0 : model.waiting
                Button(waiting > 0 ? "Needs you (\(waiting))" : "Needs you", systemImage: "tray") {
                    model.nav("inbox")
                }
            }
            if model.surface == "now" {
                Button("Live activity", systemImage: "waveform.path.ecg") { model.nav("live") }
            }
            if inSession && wide && model.surface != "beside" {
                Button("Open beside", systemImage: "rectangle.split.2x1") { model.nav("beside") }
            }
            Button("Projects", systemImage: "folder") { model.nav("projects") }
            Button("Settings", systemImage: "gearshape") { model.nav("settings") }
            Divider()
            Button(model.focus ? "Leave Focus" : "Focus", systemImage: "scope") { model.nav("focus") }
            Divider()
            Button("Reload", systemImage: "arrow.clockwise") { model.reload() }
            Button("Server", systemImage: "server.rack") { model.showingServer = true }
        } label: {
            Label(item.label, systemImage: item.symbolName)
        }
        .tint(.primary)
    }
}

/// Order follows Apple's column rule: the prominent action first, then what's
/// used most. Frequent and badged items stay longest when the column runs
/// out of room; the rest fall into the system overflow menu. The column
/// stays monochrome whatever the theme; badges are the only colour.
/// What every page that sends no column gets, exactly as in 0.1.62.
struct FixedToolbar: ToolbarContent {
    let model: AppModel

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            // Filled while the New page shows; tapped again it closes
            Button { model.toggleNew() } label: {
                Label("New", systemImage: model.newOpen ? "plus.circle.fill" : "plus")
            }
            .accessibilityAddTraits(model.newOpen ? .isSelected : [])
            .tint(.primary)
        }
        .barPriority(true)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("inbox") } label: {
                Label("Needs you", systemImage: model.waiting > 0 ? "tray.full" : "tray")
            }
            .badge(model.focus ? 0 : model.waiting)
            .accessibilityValue(model.waiting > 0 ? "\(model.waiting) waiting" : "Nothing waiting")
            .tint(.primary)
        }
        .barPriority(true)

        // Chat and Terminal share one place: it shows the view it switches to
        ToolbarItem(placement: .topBarTrailing) {
            let toChat = model.view == .terminal && !model.newOpen
            Button { model.nav(toChat ? "chat" : "terminal") } label: {
                Label(toChat ? "Chat" : "Terminal", systemImage: toChat ? "text.bubble" : "apple.terminal")
            }
            .tint(.primary)
        }
        .barPriority(true)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("sessions") } label: { Label("Sessions", systemImage: "sidebar.left") }
                .tint(.primary)
        }
        .barPriority(true)

        // Links minimised (Browser); only while there are any
        if !model.browser.pages.isEmpty {
            ToolbarItem(placement: .topBarTrailing) {
                PagesMenu(browser: model.browser)
            }
            .barPriority(true)
        }

        viewItem("Changes", symbol: "arrow.triangle.branch", view: .git, action: "git", badge: model.focus ? 0 : model.changes)
        viewItem("Files", symbol: "folder", view: .files, action: "files")

        ToolbarItem(placement: .topBarTrailing) {
            // Live activity beside the session, or hidden (Focus: the badges
            // go quiet too). Filled while it shows
            Button { model.nav("focus") } label: {
                Label {
                    Text("Live activity")
                } icon: {
                    Image(systemName: "sidebar.right")
                        .symbolVariant(model.focus ? .none : .fill)
                        // Something needs you while the badges are hidden
                        .overlay(alignment: .topTrailing) {
                            if model.focus && model.focusDot {
                                Circle()
                                    .fill(.orange)
                                    .frame(width: 7, height: 7)
                                    .offset(x: 3, y: -2)
                            }
                        }
                }
            }
            .accessibilityAddTraits(model.focus ? [] : .isSelected)
            .accessibilityValue(model.focus && model.focusDot ? "Hidden, something needs you" : model.focus ? "Hidden" : "Showing")
            .tint(.primary)
        }
        .barPriority(true)

        // Last of the column: the first to go to the overflow when Pages shows
        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("find") } label: { Label("Find", systemImage: "magnifyingglass") }
                .tint(.primary)
        }
        .barPriority(true)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("settings") } label: {
                Label("Settings", systemImage: "gearshape")
                    .symbolVariant(model.settingsOpen ? .fill : .none)
            }
            .accessibilityAddTraits(model.settingsOpen ? .isSelected : [])
            .tint(.primary)
        }
        .barPriority(false)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
                .tint(.primary)
        }
        .barPriority(false)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.showingServer = true } label: { Label("Server", systemImage: "server.rack") }
                .tint(.primary)
        }
        .barPriority(false)
    }

    /// A view switch; the current view shows filled, and tapping it again
    /// opens the session list (as the web rail does)
    private func viewItem(
        _ title: String, symbol: String, view: PaneView, action: String, high: Bool = true, badge: Int = 0
    ) -> some ToolbarContent {
        // With New over the panes no view is showing
        let current = model.view == view && !model.newOpen
        return ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav(action) } label: {
                Label(title, systemImage: symbol)
                    .symbolVariant(current ? .fill : .none)
            }
            .badge(badge)
            .accessibilityAddTraits(current ? .isSelected : [])
            .tint(.primary)
        }
        .barPriority(high)
    }
}

/// The minimised pages: a tap brings one back as it was left
struct PagesMenu: View {
    let browser: Browser

    var body: some View {
        Menu {
            ForEach(browser.pages, id: \.id) { page in
                Button(Browser.title(page.url)) { browser.show(page.id) }
            }
            Divider()
            Menu("Close a Page") {
                ForEach(browser.pages, id: \.id) { page in
                    Button(Browser.title(page.url), role: .destructive) { browser.close(page.id) }
                }
            }
            Button("Close All", role: .destructive) { browser.closeAll() }
        } label: {
            Label("Pages", systemImage: "safari")
        }
        .badge(browser.pages.count)
        .tint(.primary)
    }
}

extension ToolbarContent {
    /// Stays in the Duo's vertical column. iOS 27.1 and later.
    @ToolbarContentBuilder
    func verticalInBar() -> some ToolbarContent {
        if #available(iOS 27.1, *) {
            axisBehavior(.verticalPreferred)
        } else {
            self
        }
    }

    /// Overflow order when the bar runs out of room. iOS 27 and later.
    @ToolbarContentBuilder
    func barPriority(_ high: Bool) -> some ToolbarContent {
        if #available(iOS 27.0, *) {
            visibilityPriority(high ? .high : .low)
        } else {
            self
        }
    }
}

