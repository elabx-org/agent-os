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

/// The one window: this Mac's AgentOS, desktop layout
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
  let pane: WebPane
  weak var host: WindowHost?
  private var notes: [NSObjectProtocol] = []
  /// The window was shown or minimised when the app was hidden (⌘H)
  private var shownBeforeAppHide = false
  /// hide() was asked for in full screen: it runs once full screen has ended
  private var pendingHide = false

  init(port: Int, persistent: Bool, inspectable: Bool, autosaveName: String, host: WindowHost) {
    pane = WebPane(port: port, persistent: persistent, inspectable: inspectable)
    self.host = host
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.isRestorable = false
    window.collectionBehavior = [.fullScreenPrimary]
    window.minSize = NSSize(width: 480, height: 360)
    window.title = Strings.appName
    window.contentView = pane
    if !window.setFrameUsingName(autosaveName) { window.center() }
    window.setFrameAutosaveName(autosaveName)
    super.init(window: window)
    window.delegate = self
    pane.onChange = { [weak self] in self?.titleChanged() }
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
    window?.title = Strings.windowTitle(pane.webView.title)
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
    hide()
    return false
  }
}
