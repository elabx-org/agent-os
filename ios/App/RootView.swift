import SwiftUI

/// The page with Agent-OS's navigation in the system bar. Built with the
/// iOS 27.1 SDK, the bar goes vertical in the iPhone Duo's right-hand column
/// under the status glyphs; elsewhere it is the usual top bar.
struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

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
                .toolbar { NavToolbar(model: model) }
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

/// Order follows Apple's column rule: the prominent action first, then what's
/// used most. Frequent and badged items stay longest when the column runs
/// out of room; the rest fall into the system overflow menu. The column
/// stays monochrome whatever the theme; badges are the only colour.
struct NavToolbar: ToolbarContent {
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

        viewItem("Chat", symbol: "text.bubble", view: .chat, action: "chat")
        viewItem("Terminal", symbol: "apple.terminal", view: .terminal, action: "terminal")
        viewItem("Changes", symbol: "arrow.triangle.branch", view: .git, action: "git", badge: model.focus ? 0 : model.changes)
        viewItem("Files", symbol: "folder", view: .files, action: "files")

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("find") } label: { Label("Find", systemImage: "magnifyingglass") }
                .tint(.primary)
        }
        .barPriority(true)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("focus") } label: {
                Label {
                    Text("Focus")
                } icon: {
                    Image(systemName: "scope")
                        .symbolVariant(model.focus ? .fill : .none)
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
            .accessibilityAddTraits(model.focus ? .isSelected : [])
            .accessibilityValue(model.focus && model.focusDot ? "Something needs you" : "")
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
            Button { model.nav("sessions") } label: { Label("Sessions", systemImage: "sidebar.left") }
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

extension ToolbarContent {
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

