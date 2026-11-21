import AppKit

/// Proof that the person just clicked one of our own controls. Changes only
/// the user may make (Backend.asUser) take one, and only this file can make
/// one. build.sh fails the build if any other file constructs it.
struct Click {
  fileprivate init() {}
}

@MainActor
enum Clicks {
  /// The event types a real choice in a menu or a panel arrives as
  private static let realEvents: Set<NSEvent.EventType> = [
    .leftMouseUp, .leftMouseDown, .rightMouseUp, .otherMouseUp, .keyDown,
  ]

  /// A click on an item of our status menu, from a fresh real event, and
  /// never while the command channel is running a command
  static func fromMenu(_ sender: Any?) -> Click? {
    guard !CommandChannel.isHandling, let item = sender as? NSMenuItem else { return nil }
    var menu = item.menu
    while let parent = menu?.supermenu { menu = parent }
    guard let top = menu, top === StatusMenu.menu, freshEvent(in: nil) else { return nil }
    return Click()
  }

  private static func freshEvent(in window: NSWindow?) -> Bool {
    guard let event = NSApp.currentEvent, realEvents.contains(event.type) else { return false }
    guard ProcessInfo.processInfo.systemUptime - event.timestamp < 1.0 else { return false }
    if let window, event.window !== window { return false }
    return true
  }

  // Stage 2 adds fromPanel and fromNotification here.
}
