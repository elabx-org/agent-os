import AppKit
import Carbon.HIToolbox

/// The one system-wide shortcut: it opens quick ask from any app. It is a
/// registered hot key, which needs no permission and sees no other key the
/// person presses.
@MainActor
enum HotKey {
  private static var ref: EventHotKeyRef?
  private static var handler: EventHandlerRef?
  /// The shortcut asked for couldn't be registered
  private(set) static var failed = false
  static var onPress: (() -> Void)?

  private static func install() {
    guard handler == nil else { return }
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, _, _ in
        DispatchQueue.main.async { MainActor.assumeIsolated { HotKey.onPress?() } }
        return noErr
      }, 1, &spec, nil, &handler)
  }

  static func set(_ key: QuickKey) {
    if let old = ref {
      UnregisterEventHotKey(old)
      ref = nil
    }
    failed = false
    guard key != .off else { return }
    install()
    // 'AGOS'
    let id = EventHotKeyID(signature: 0x4147_4F53, id: 1)
    var made: EventHotKeyRef?
    let status = RegisterEventHotKey(key.keyCode, key.modifiers, id, GetApplicationEventTarget(), 0, &made)
    if status == noErr, let made {
      ref = made
    } else {
      failed = true
    }
  }
}
