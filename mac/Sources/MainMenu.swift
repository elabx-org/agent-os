import AppKit

/// The menu bar while the window shows. Standard items go to the first
/// responder; the view items go to the window in front; About, Settings…,
/// New Session…, Quick Ask…, the chat window, the watch panel and the
/// AgentOS window item go to `target`.
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
      item(Strings.settingsMenu, "showSettings:", ",", to: target),
      .separator(),
      item(Strings.hideAgentOS, "hide:", "h"),
      item(Strings.hideOthers, "hideOtherApplications:", "h", [.command, .option]),
      item(Strings.showAll, "unhideAllApplications:"),
      .separator(),
      item(Strings.quitAgentOS, "terminate:", "q"),
    ])
    _ = top(Strings.fileMenu, [
      item(Strings.newSession, "newSession:", "n", to: target),
      item(Strings.quickAskMenu, "showQuickAskPanel:", to: target),
      item(Strings.newWindowMenu, "openChatWindow:", "n", [.command, .shift], to: target),
      .separator(),
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
      // These go up the responder chain to the window's controller
      item(Strings.showChat, "showChat:", "1"),
      item(Strings.showChanges, "showChanges:", "2"),
      item(Strings.showTerminal, "showTerminal:", "3"),
      item(Strings.showFiles, "showFiles:", "4"),
      .separator(),
      item(Strings.showSidebar, "toggleSidebarPane:", "s", [.command, .control]),
      item(Strings.showInspector, "toggleInspectorPane:", "i", [.command, .option]),
      item(Strings.findMenu, "findInPage:", "k"),
      item(Strings.allSessionsMenu, "showAllSessions:", "a", [.command, .shift]),
      item(Strings.watchPanelMenu, "toggleWatchPanel:", "w", [.command, .option], to: target),
      .separator(),
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
      item(Strings.appName, "showMainWindow:", "0", to: target),
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
