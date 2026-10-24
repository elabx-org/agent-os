import SwiftUI

/// The page with Agent-OS's navigation in the system bar. Built with the
/// iOS 27.1 SDK, the bar goes vertical in the iPhone Duo's right-hand column
/// under the status glyphs; elsewhere it is the usual top bar.
struct RootView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            AgentWebContainer(model: model)
                .ignoresSafeArea(.container, edges: .bottom)
                // Half open: the page puts its input below the fold (laptop pose)
                .onGeometryChange(for: Fold?.self) { Fold($0) } action: { model.fold = $0 }
                .background(Color("LaunchBackground"))
                .toolbarTitleDisplayMode(.inline)
                .toolbar { NavToolbar(model: model) }
        }
        .sheet(isPresented: $model.showingServer) {
            ServerSheet(model: model)
        }
    }
}

/// Order follows Apple's column rule: the prominent action first, then what's
/// used most. Frequent and badged items stay longest when the column runs
/// out of room; the rest fall into the system overflow menu.
struct NavToolbar: ToolbarContent {
    let model: AppModel

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("new") } label: { Label("New", systemImage: "plus") }
        }
        .barPriority(true)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("inbox") } label: {
                Label("Inbox", systemImage: model.waiting > 0 ? "tray.full" : "tray")
            }
            .badge(model.waiting)
            .accessibilityValue(model.waiting > 0 ? "\(model.waiting) waiting" : "Nothing waiting")
        }
        .barPriority(true)

        viewItem("Chat", symbol: "text.bubble", view: .chat, action: "chat")
        viewItem("Terminal", symbol: "apple.terminal", view: .terminal, action: "terminal")

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("sessions") } label: { Label("Sessions", systemImage: "sidebar.left") }
        }
        .barPriority(true)

        viewItem("Changes", symbol: "arrow.triangle.branch", view: .git, action: "git", high: false)
        viewItem("Files", symbol: "folder", view: .files, action: "files", high: false)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav("find") } label: { Label("Find", systemImage: "magnifyingglass") }
        }
        .barPriority(false)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
        }
        .barPriority(false)

        ToolbarItem(placement: .topBarTrailing) {
            Button { model.showingServer = true } label: { Label("Server", systemImage: "server.rack") }
        }
        .barPriority(false)
    }

    /// A view switch; the current view shows filled, and tapping it again
    /// opens the session list (as the web rail does)
    private func viewItem(
        _ title: String, symbol: String, view: PaneView, action: String, high: Bool = true
    ) -> some ToolbarContent {
        let current = model.view == view
        return ToolbarItem(placement: .topBarTrailing) {
            Button { model.nav(action) } label: {
                Label(title, systemImage: symbol)
                    .symbolVariant(current ? .fill : .none)
            }
            .accessibilityAddTraits(current ? .isSelected : [])
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

