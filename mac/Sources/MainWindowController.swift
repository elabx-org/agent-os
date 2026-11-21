import AppKit

@MainActor
protocol WindowHost: AnyObject {
  func updatePolicy()
}

/// The Dock icon and app menu show only while the window does
@MainActor
enum AppPolicy {
  static func wantsRegular(_ window: NSWindow?) -> Bool {
    guard let window else { return false }
    // A minimised window needs the Dock to come back from
    return window.isVisible || window.isMiniaturized
  }

  static func apply(_ window: NSWindow?) {
    let policy: NSApplication.ActivationPolicy = wantsRegular(window) ? .regular : .accessory
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
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  private func titleChanged() {
    window?.title = Strings.windowTitle(pane.webView.title)
  }

  var isShown: Bool { window?.isVisible == true }

  /// `activate` only for a real click (our menu, the Dock, our notification)
  func show(activate: Bool) {
    guard let window else { return }
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
    window?.orderOut(nil)
    WindowMemory.save(path: pane.currentPath)
    pane.forgetSession()
    host?.updatePolicy()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    hide()
    return false
  }
}
