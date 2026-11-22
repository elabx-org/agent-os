import AppKit

/// The menu bar while the window shows. Standard items go to the first
/// responder; About, New Session… and the AgentOS window item go to `target`
/// (selectors showAbout:, newSession:, showMainWindow:).
@MainActor
enum MainMenu {
  static func build(target: AnyObject?) -> NSMenu {
    let bar = NSMenu()

    func item(
      _ title: String, _ action: String?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command,
      to: AnyObject? = nil
    ) -> NSMenuItem {
      let row = NSMenuItem(title: title, action: action.map(NSSelectorFromString), keyEquivalent: key)
      row.keyEquivalentModifierMask = key.isEmpty ? [] : mods
      row.target = to
      return row
    }

    func top(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      for row in items { menu.addItem(row) }
      let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      holder.submenu = menu
      bar.addItem(holder)
      return menu
    }

    _ = top(Strings.appName, [
      item(Strings.aboutAgentOS, "showAbout:", to: target),
      .separator(),
      item(Strings.hideAgentOS, "hide:", "h"),
      item(Strings.hideOthers, "hideOtherApplications:", "h", [.command, .option]),
      item(Strings.showAll, "unhideAllApplications:"),
      .separator(),
      item(Strings.quitAgentOS, "terminate:", "q"),
    ])
    _ = top(Strings.fileMenu, [
      item(Strings.newSession, "newSession:", "n", to: target),
      item(Strings.closeWindow, "performClose:", "w"),
    ])
    _ = top(Strings.editMenu, [
      item(Strings.undo, "undo:", "z"),
      item(Strings.redo, "redo:", "z", [.command, .shift]),
      .separator(),
      item(Strings.cut, "cut:", "x"),
      item(Strings.copy, "copy:", "c"),
      item(Strings.paste, "paste:", "v"),
      item(Strings.pasteAndMatchStyle, "pasteAsPlainText:", "v", [.command, .option, .shift]),
      item(Strings.selectAll, "selectAll:", "a"),
    ])
    _ = top(Strings.viewMenu, [
      item(Strings.reloadPage, "reload:", "r"),
      item(Strings.back, "goBack:", "["),
      item(Strings.forward, "goForward:", "]"),
      .separator(),
      item(Strings.enterFullScreen, "toggleFullScreen:", "f", [.command, .control]),
    ])
    let window = top(Strings.windowMenu, [
      item(Strings.minimize, "performMiniaturize:", "m"),
      item(Strings.zoom, "performZoom:"),
      .separator(),
      item(Strings.appName, "showMainWindow:", "1", to: target),
      .separator(),
      item(Strings.bringAllToFront, "arrangeInFront:"),
    ])
    NSApp.windowsMenu = window
    return bar
  }

  /// Every item, depth first, for the self-test
  static func allItems(_ menu: NSMenu) -> [NSMenuItem] {
    menu.items.flatMap { row in [row] + (row.submenu.map(allItems) ?? []) }
  }
}
