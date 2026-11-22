import AppKit
import UserNotifications

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

  /// A press of a button in one of our two panels (Send, Start), from a
  /// fresh real event in that panel (⌘Return arrives as a keyDown there)
  static func fromPanel(_ sender: Any?, panel: NSPanel) -> Click? {
    guard !CommandChannel.isHandling, let button = sender as? NSButton, button.window === panel else { return nil }
    guard panel === Panels.reply || panel === Panels.newSession else { return nil }
    guard freshEvent(in: panel) else { return nil }
    return Click()
  }

  /// One of our action buttons on a notification this app posted and
  /// recorded, with the nonce it was posted with
  static func fromNotification(_ r: NotificationReply, record: PostedRecord) -> Click? {
    guard !CommandChannel.isHandling, let posted = Notifier.posted[r.identifier] else { return nil }
    guard posted.nonce == record.nonce, r.nonce == record.nonce, posted.sessionId == record.sessionId else {
      return nil
    }
    guard Notifier.actionIds.contains(r.actionId) else { return nil }
    return Click()
  }

  #if SELFTEST
    /// The stub action test only (never in the shipped binary)
    static func forTest() -> Click { Click() }
  #endif
}

/// What a notification response carried, read off the system's response
/// object. Only `NotificationReply.from` makes one, from a real
/// UNNotificationResponse.
struct NotificationReply: Sendable {
  let identifier: String
  let nonce: String?
  let actionId: String
  let text: String?

  fileprivate init(identifier: String, nonce: String?, actionId: String, text: String?) {
    self.identifier = identifier
    self.nonce = nonce
    self.actionId = actionId
    self.text = text
  }

  nonisolated static func from(_ r: UNNotificationResponse) -> NotificationReply {
    let request = r.notification.request
    return NotificationReply(
      identifier: request.identifier, nonce: request.content.userInfo["nonce"] as? String,
      actionId: r.actionIdentifier, text: (r as? UNTextInputNotificationResponse)?.userText)
  }

  #if SELFTEST
    static func forTest(identifier: String, nonce: String?, actionId: String, text: String?) -> NotificationReply {
      NotificationReply(identifier: identifier, nonce: nonce, actionId: actionId, text: text)
    }
  #endif
}
