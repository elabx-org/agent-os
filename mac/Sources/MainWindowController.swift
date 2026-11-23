import AppKit

@MainActor
protocol WindowHost: AnyObject {
  func updatePolicy()
}

/// The Dock icon and app menu show only while the window does
@MainActor
enum AppPolicy {
  /// `inUse` is MainWindowController.inUse: shown, minimised, or shown
  /// before the app was hidden (⌘H). Each needs the Dock to come back from.
  static func apply(inUse: Bool) {
    let policy: NSApplication.ActivationPolicy = inUse ? .regular : .accessory
    if NSApp.activationPolicy() != policy { NSApp.setActivationPolicy(policy) }
  }

  static func name(_ policy: NSApplication.ActivationPolicy) -> String {
    switch policy {
    case .regular: return "regular"
    case .accessory: return "accessory"
    case .prohibited: return "prohibited"
    @unknown default: return "unknown"
    }
  }
}

/// The one window: this Mac's AgentOS. The window draws the toolbar (the
/// session's name, its views, Find, New, Open In and the two pane buttons)
/// over a blurred backdrop; the page lays its panes out under it. The
/// toolbar shows what the page says is in front (PageState) and its buttons
/// send the page one fixed word each (PageAction).
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, NSMenuItemValidation {
  let pane: WebPane
  /// Finds the folder of a session for Open In. A seam for the self-test.
  var sessionRows: () -> [[String: Any]] = {
    ((Backend.request("/api/sessions") as? [String: Any])?["sessions"] as? [[String: Any]]) ?? []
  }
  /// Opens a file or folder with an app. A seam for the self-test.
  var openWith: (URL, URL) -> Void = { target, app in
    NSWorkspace.shared.open([target], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
  }
  private let views = NSSegmentedControl()
  private var tabs: [ToolbarModel.Tab] = []
  private var toolbarItems: [NSToolbarItem.Identifier: NSToolbarItem] = [:]
  weak var host: WindowHost?
  private var notes: [NSObjectProtocol] = []
  /// The window was shown or minimised when the app was hidden (⌘H)
  private var shownBeforeAppHide = false
  /// hide() was asked for in full screen: it runs once full screen has ended
  private var pendingHide = false
  /// A chat in a window of its own: it closes for good, and joins the other
  /// chat windows as a tab. The first window only hides.
  let secondary: Bool
  /// A secondary window closed
  var onClosed: (() -> Void)?
  /// A menu's action for a page that is still loading
  private var pendingAction: (action: PageAction, at: Date)?

  init(
    port: Int, persistent: Bool, inspectable: Bool, autosaveName: String, host: WindowHost, secondary: Bool = false
  ) {
    self.secondary = secondary
    pane = WebPane(port: port, persistent: persistent, inspectable: inspectable)
    self.host = host
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered,
      defer: false)
    window.isReleasedWhenClosed = false
    window.tabbingMode = secondary ? .preferred : .disallowed
    if secondary { window.tabbingIdentifier = "AgentOSChats" }
    window.isRestorable = false
    window.collectionBehavior = [.fullScreenPrimary]
    window.minSize = NSSize(width: 480, height: 360)
    window.title = Strings.appName
    window.titlebarAppearsTransparent = true
    window.toolbarStyle = .unified
    // The backdrop the page's panes float over, behind the toolbar too
    let backdrop = NSVisualEffectView()
    backdrop.material = .sidebar
    backdrop.blendingMode = .behindWindow
    backdrop.state = .followsWindowActiveState
    window.contentView = backdrop
    pane.translatesAutoresizingMaskIntoConstraints = false
    backdrop.addSubview(pane)
    // The page starts under the toolbar, not behind it
    let top = (window.contentLayoutGuide as? NSLayoutGuide)?.topAnchor ?? backdrop.topAnchor
    NSLayoutConstraint.activate([
      pane.leadingAnchor.constraint(equalTo: backdrop.leadingAnchor),
      pane.trailingAnchor.constraint(equalTo: backdrop.trailingAnchor),
      pane.topAnchor.constraint(equalTo: top),
      pane.bottomAnchor.constraint(equalTo: backdrop.bottomAnchor),
    ])
    if !window.setFrameUsingName(autosaveName) { window.center() }
    window.setFrameAutosaveName(autosaveName)
    super.init(window: window)
    window.delegate = self
    views.segmentStyle = .automatic
    views.trackingMode = .selectOne
    views.target = self
    views.action = #selector(pickView(_:))
    let toolbar = NSToolbar(identifier: "AgentOSMain")
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
    if #available(macOS 13.0, *) { toolbar.centeredItemIdentifiers = [Self.viewsItem] }
    window.toolbar = toolbar
    pane.onChange = { [weak self] in self?.titleChanged() }
    pane.onState = { [weak self] _ in self?.stateChanged() }
    stateChanged()
    let center = NotificationCenter.default
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didMiniaturizeNotification,
      NSWindow.didDeminiaturizeNotification]
    {
      notes.append(
        center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.host?.updatePolicy() }
        })
    }
    notes.append(
      center.addObserver(forName: NSApplication.willHideNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self, let w = self.window else { return }
          self.shownBeforeAppHide = w.isVisible || w.isMiniaturized
        }
      })
    notes.append(
      center.addObserver(forName: NSApplication.didUnhideNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.shownBeforeAppHide = false
          self?.host?.updatePolicy()
        }
      })
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  private func titleChanged() {
    let shown = ToolbarModel.title(pane.state, pageTitle: pane.webView.title)
    window?.title = shown.title
    window?.subtitle = shown.subtitle
  }

  // MARK: Toolbar

  static let sidebarItem = NSToolbarItem.Identifier("sidebar")
  static let viewsItem = NSToolbarItem.Identifier("views")
  static let newItem = NSToolbarItem.Identifier("new")
  static let findItem = NSToolbarItem.Identifier("find")
  static let openInItem = NSToolbarItem.Identifier("openIn")
  static let inspectorItem = NSToolbarItem.Identifier("inspector")

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [
      Self.sidebarItem, .flexibleSpace, Self.viewsItem, .flexibleSpace, Self.newItem, Self.findItem,
      Self.openInItem, Self.inspectorItem,
    ]
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  private func button(
    _ id: NSToolbarItem.Identifier, _ label: String, _ tip: String, symbol: String, _ action: Selector
  ) -> NSToolbarItem {
    let item = NSToolbarItem(itemIdentifier: id)
    item.label = label
    item.toolTip = tip
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
    item.isBordered = true
    item.target = self
    item.action = action
    return item
  }

  func toolbar(
    _ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool
  ) -> NSToolbarItem? {
    let item: NSToolbarItem
    switch id {
    case Self.sidebarItem:
      item = button(id, Strings.sidebarLabel, Strings.sidebarTip, symbol: "sidebar.left", #selector(toggleSidebarPane(_:)))
    case Self.inspectorItem:
      item = button(
        id, Strings.inspectorLabel, Strings.inspectorTip, symbol: "sidebar.right", #selector(toggleInspectorPane(_:)))
    case Self.newItem:
      item = button(id, Strings.newChatLabel, Strings.newChatTip, symbol: "square.and.pencil", #selector(newChat(_:)))
    case Self.findItem:
      item = button(id, Strings.findLabel, Strings.findTip, symbol: "magnifyingglass", #selector(findInPage(_:)))
    case Self.viewsItem:
      item = NSToolbarItem(itemIdentifier: id)
      item.label = Strings.viewsLabel
      item.view = views
    case Self.openInItem:
      let menu = NSMenuToolbarItem(itemIdentifier: id)
      menu.label = Strings.openInLabel
      menu.toolTip = Strings.openInTip
      menu.image = NSImage(systemSymbolName: "arrow.up.forward.app", accessibilityDescription: Strings.openInLabel)
      menu.showsIndicator = true
      let list = NSMenu()
      list.autoenablesItems = false
      for app in OpenIn.App.allCases {
        let row = NSMenuItem(title: app.title, action: #selector(openIn(_:)), keyEquivalent: "")
        row.target = self
        row.representedObject = app.rawValue
        list.addItem(row)
      }
      menu.menu = list
      item = menu
    default:
      return nil
    }
    toolbarItems[id] = item
    applyState()
    return item
  }

  /// Tells the page now, or as soon as it says it is there (within 15 s)
  func actWhenReady(_ action: PageAction) {
    if pane.state != nil {
      pane.act(action)
    } else {
      pendingAction = (action, Date())
    }
  }

  private func stateChanged() {
    titleChanged()
    applyState()
    if let pending = pendingAction, pane.state != nil {
      pendingAction = nil
      if Date().timeIntervalSince(pending.at) < 15 { pane.act(pending.action) }
    }
    // The window's look follows the page's: light or dark
    window?.appearance = pane.state.map { NSAppearance(named: $0.dark ? .darkAqua : .aqua) } ?? nil
  }

  /// The toolbar from the page's state: with no state (another page, the
  /// offline view) only the window's own buttons stay
  private func applyState() {
    let state = pane.state
    let next = ToolbarModel.tabs(state)
    if next != tabs {
      tabs = next
      views.segmentCount = next.count
      for (i, tab) in next.enumerated() {
        views.setLabel(tab.label, forSegment: i)
        views.setWidth(0, forSegment: i)
      }
      views.sizeToFit()
    }
    if let index = ToolbarModel.selected(state) {
      views.selectedSegment = index
    } else {
      for i in 0..<views.segmentCount { views.setSelected(false, forSegment: i) }
    }
    let known = state != nil
    let session = state?.session != nil
    func set(_ id: NSToolbarItem.Identifier, shown: Bool) {
      guard let item = toolbarItems[id] else { return }
      if #available(macOS 15.0, *) { item.isHidden = !shown }
      item.isEnabled = shown
    }
    set(Self.viewsItem, shown: session)
    set(Self.openInItem, shown: session)
    for id in [Self.sidebarItem, Self.inspectorItem, Self.newItem, Self.findItem] { set(id, shown: known) }
  }

  /// What the toolbar shows now, for the state dump
  var toolbarDump: [String: Any] {
    let state = pane.state
    func shown(_ id: NSToolbarItem.Identifier) -> Bool { toolbarItems[id]?.isEnabled ?? false }
    return [
      "known": state != nil,
      "session": state?.session ?? NSNull() as Any,
      "tabs": tabs.map(\.label),
      "selected": views.selectedSegment,
      "views": shown(Self.viewsItem),
      "openIn": shown(Self.openInItem),
      "panes": shown(Self.sidebarItem) && shown(Self.inspectorItem),
      "sidebar": state?.sidebar ?? false,
      "inspector": state?.inspector ?? false,
      "dark": state?.dark ?? false,
      "seeThrough": !(pane.webView.value(forKey: "drawsBackground") as? Bool ?? true),
    ]
  }

  @objc private func pickView(_ sender: NSSegmentedControl) {
    let index = sender.selectedSegment
    guard tabs.indices.contains(index) else { return }
    pane.act(tabs[index].action)
  }

  @objc func toggleSidebarPane(_ sender: Any?) { pane.act(.sidebar) }
  @objc func toggleInspectorPane(_ sender: Any?) { pane.act(.inspector) }
  @objc func findInPage(_ sender: Any?) { pane.act(.find) }
  @objc func showAllSessions(_ sender: Any?) { pane.act(.all) }
  @objc func newChat(_ sender: Any?) { pane.act(.new) }
  @objc func showChat(_ sender: Any?) { pane.act(.chat) }
  @objc func showChanges(_ sender: Any?) { pane.act(.changes) }
  @objc func showTerminal(_ sender: Any?) { pane.act(.terminal) }
  @objc func showFiles(_ sender: Any?) { pane.act(.files) }

  /// The View menu's two pane items say what they will do
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let state = pane.state
    switch item.action {
    case #selector(toggleSidebarPane(_:)):
      item.title = state?.sidebar == true ? Strings.hideSidebar : Strings.showSidebar
      return state != nil
    case #selector(toggleInspectorPane(_:)):
      item.title = state?.inspector == true ? Strings.hideInspector : Strings.showInspector
      return state?.session != nil
    case #selector(showChat(_:)), #selector(showChanges(_:)), #selector(showTerminal(_:)), #selector(showFiles(_:)):
      let views: [Selector: PageAction] = [
        #selector(showChat(_:)): .chat, #selector(showChanges(_:)): .changes,
        #selector(showTerminal(_:)): .terminal, #selector(showFiles(_:)): .files,
      ]
      item.state = item.action.flatMap { views[$0] } == state?.view && state?.view != nil ? .on : .off
      return state?.session != nil
    case #selector(findInPage(_:)), #selector(showAllSessions(_:)):
      return state != nil
    default:
      return true
    }
  }

  // MARK: Open In

  /// The folder comes from this Mac's AgentOS, not from the page: the page
  /// only says which session is in front
  @objc private func openIn(_ sender: NSMenuItem) {
    guard let raw = sender.representedObject as? String, let app = OpenIn.App(rawValue: raw),
      let id = pane.state?.session
    else { return }
    let rows = sessionRows
    let home = NSHomeDirectory()
    DispatchQueue.global(qos: .userInitiated).async {
      let folder = OpenIn.folder(of: id, in: rows(), home: home)
      var isFolder: ObjCBool = false
      let there = folder.map { FileManager.default.fileExists(atPath: $0, isDirectory: &isFolder) && isFolder.boolValue }
      let entries = (folder.flatMap { try? FileManager.default.contentsOfDirectory(atPath: $0) }) ?? []
      DispatchQueue.main.async { [weak self] in
        MainActor.assumeIsolated {
          guard let self else { return }
          guard let folder, there == true else {
            return self.tell(Strings.noFolderTitle, Strings.noFolderBody)
          }
          guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: app.bundleId) else {
            return self.tell(Strings.noAppTitle(app.title), "")
          }
          let target = app == .xcode ? OpenIn.xcodeTarget(folder: folder, entries: entries) : folder
          self.openWith(URL(fileURLWithPath: target), appURL)
        }
      }
    }
  }

  private func tell(_ title: String, _ body: String) {
    guard let window else { return }
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = body
    alert.addButton(withTitle: Strings.ok)
    alert.beginSheetModal(for: window)
  }

  var isShown: Bool { window?.isVisible == true }

  /// The person may come back to the window: it shows, it is minimised to
  /// the Dock, or it showed when the app was hidden. The Dock icon stays
  /// and the updater only offers a restart while this holds.
  var inUse: Bool {
    guard let window else { return false }
    return window.isVisible || window.isMiniaturized || (NSApp.isHidden && shownBeforeAppHide)
  }

  /// `activate` only for a real click (our menu, the Dock, our notification)
  func show(activate: Bool) {
    guard let window else { return }
    pendingHide = false
    NSApp.setActivationPolicy(.regular)
    if window.isMiniaturized { window.deminiaturize(nil) }
    if activate {
      window.makeKeyAndOrderFront(nil)
      if #available(macOS 14.0, *) {
        NSApp.activate()
      } else {
        NSApp.activate(ignoringOtherApps: true)
      }
    } else {
      window.orderFront(nil)
      // Cooperative: only when we are already the active app
      if NSApp.isActive {
        window.makeKey()
        if #available(macOS 14.0, *) { NSApp.activate() }
      }
    }
    host?.updatePolicy()
  }

  func open(_ d: Destination, activate: Bool) {
    pane.open(d)
    show(activate: activate)
  }

  func hide() {
    // Ordered out in full screen, the window would leave an empty Space
    // behind: leave full screen first, then hide (windowDidExitFullScreen)
    if let window, window.styleMask.contains(.fullScreen) {
      pendingHide = true
      window.toggleFullScreen(nil)
      return
    }
    window?.orderOut(nil)
    WindowMemory.save(path: pane.currentPath)
    pane.forgetSession()
    host?.updatePolicy()
  }

  func windowDidExitFullScreen(_ notification: Notification) {
    guard pendingHide else { return }
    pendingHide = false
    hide()
  }

  func windowDidFailToExitFullScreen(_ window: NSWindow) {
    guard pendingHide else { return }
    pendingHide = false
    window.orderOut(nil)
    WindowMemory.save(path: pane.currentPath)
    pane.forgetSession()
    host?.updatePolicy()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if secondary { return true }
    hide()
    return false
  }

  func windowWillClose(_ notification: Notification) {
    guard secondary else { return }
    pane.forgetSession()
    onClosed?()
  }
}
