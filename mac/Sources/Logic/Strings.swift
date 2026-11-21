import Foundation

/// Every string the person reads. Tests/main.swift audits them all.
enum Strings {
  // MARK: Status menu

  static let isOn = "AgentOS is on"
  static let isOff = "AgentOS is off"
  static let notInstalled = "AgentOS isn't installed on this Mac"
  static func linkedTo(_ hub: String) -> String { "Linked to \(hub)" }
  static let notLinked = "Not linked to a server"
  static func version(_ v: String) -> String { "Version \(v)" }
  static let sessionsHere = "Sessions on this Mac"
  static let noSessions = "No sessions running on this Mac"
  static func sessionRow(_ name: String, _ state: String) -> String { "\(name)  —  \(stateWord(state))" }
  static func stateWord(_ state: String) -> String {
    ["waiting": "Needs you", "running": "Working", "idle": "Idle"][state] ?? state
  }
  static func andMore(_ n: Int) -> String { "and \(n) more" }
  static let stopASession = "Stop a session…"
  static let openAgentOS = "Open AgentOS"
  static let openServer = "Open your server's AgentOS"
  static let turnOff = "Turn AgentOS off"
  static let turnOn = "Turn AgentOS on"
  static let offNote = "Off: nothing can reach this Mac. Running sessions keep running."
  static let letServerSessions = "Let server sessions use this Mac"
  static func reposFolder(_ folder: String) -> String { "Repositories folder: \(folder)" }
  static let showInFinder = "Show in Finder"
  static let chooseFolder = "Choose another folder…"
  static let useDefaultFolder = "Use ~/AgentOS again"
  static let showAtLogin = "Show this menu at login"
  static let uninstall = "Uninstall AgentOS…"
  static let quit = "Quit"

  // MARK: Status menu: busy lines and alerts (today's wording)

  static let turningOff = "Turning off…"
  static let turningOn = "Turning on…"
  static let turningThatOff = "Turning that off…"
  static let allowing = "Allowing…"
  static let changingFolder = "Changing the folder…"
  static func stopping(_ name: String) -> String { "Stopping \(name)…" }
  static let uninstalling = "Uninstalling…"
  static let cancel = "Cancel"
  static let didntChange = "That didn’t change"
  static let allowTitle = "Let server sessions use this Mac?"
  static func allowBody(_ hub: String) -> String {
    "Sessions running on \(hub) will be able to start sessions on this Mac and give them work, without asking you each time. You can turn this off here or in AgentOS (Settings, Machines)."
  }
  static let yourServer = "your server"
  static let allow = "Allow"
  static let folderMissingTitle = "That folder isn’t there yet"
  static func folderMissingBody(_ folder: String) -> String {
    "AgentOS makes \(folder) the first time it puts a repository on this Mac."
  }
  static let chooseFolderMessage = "Where AgentOS finds your repositories on this Mac, and puts the ones it clones."
  static let useThisFolder = "Use This Folder"
  static func stopTitle(_ name: String) -> String { "Stop “\(name)”?" }
  static let stopBody = "Its agent and terminal end. The session stays in AgentOS and starts again when you open it."
  static let stop = "Stop"
  static let turnOffTitle = "Turn AgentOS off on this Mac?"
  static let turnOffBody =
    "Nothing can reach this Mac until you turn it on again. Sessions already running keep running in the background."
  static let turnOffButton = "Turn Off"
  static let loginFailedTitle = "Couldn’t change that"
  static func loginFailedBody(_ why: String) -> String {
    "macOS refused: \(why). Keep the app in Applications and try again."
  }
  static let uninstallTitle = "Uninstall AgentOS from this Mac?"
  static func uninstallBody(_ list: String) -> String {
    "This removes:\n\(list)\n\nIt stays: your repositories and sessions’ folders, Claude’s own conversations (~/.claude), Homebrew’s node and tmux. Sessions still running keep running until you close them. Also remove this Mac in AgentOS on your phone (Settings, Machines)."
  }
  static let uninstallButton = "Uninstall"
  static let uninstallList = [
    "~/.agent-os (AgentOS, its session list, logs and the key that links this Mac)",
    "~/Library/LaunchAgents/com.agentos.machine.plist (starts it at login)",
    "~/.local/bin/agent-os (the command)",
    "This app",
  ]
  static let removedTitle = "AgentOS was removed from this Mac"
  static let removedBody = "The app is in the Trash."
  static let noAnswer = "AgentOS on this Mac didn’t answer."
  static let refusedChange =
    "AgentOS on this Mac refused the change. Change it in AgentOS on your phone instead (Settings, Machines)."
  static func errorCode(_ status: Int) -> String { "AgentOS answered with an error (\(status))." }

  // MARK: Tooltip and accessibility label

  static func tooltipFirst(_ state: IconState) -> String {
    switch state {
    case .notInstalled: return notInstalled
    case .off: return isOff
    case .starting: return "AgentOS is starting"
    case .updating: return "AgentOS is updating"
    case .notAnswering: return "AgentOS isn't answering"
    case .needsYou(let n): return n == 1 ? "1 session needs you" : "\(n) sessions need you"
    case .working(let n): return n == 1 ? "A session is working" : "\(n) sessions are working"
    case .idle: return isOn
    }
  }

  static func tooltipSecond(_ link: String?) -> String? {
    switch link {
    case "offline", "connecting": return "Can't reach your server right now"
    case "pending": return "Waiting for you to approve this Mac in AgentOS on your phone"
    case "refused":
      return "Your server no longer knows this Mac. Add it again in AgentOS on your phone (Settings, Machines)."
    case "signin": return "Your server's sign-in turned this Mac away"
    default: return nil
    }
  }

  static func tooltip(_ state: IconState, _ link: String?) -> String {
    [tooltipFirst(state), tooltipSecond(link)].compactMap { $0 }.joined(separator: "\n")
  }

  // MARK: Offline view

  struct Offline: Equatable {
    let title: String
    let body: String
    /// Button titles, in order
    let buttons: [String]
  }

  static let turnOnButton = "Turn AgentOS On"
  static let tryAgain = "Try Again"
  static let showLog = "Show the Log"
  static let reload = "Reload"
  static let openInBrowser = "Open in Your Browser"

  static let offlineOff = Offline(
    title: "AgentOS is off on this Mac", body: "Turn it on to see your sessions here.",
    buttons: [turnOnButton, tryAgain])
  static let offlineStarting = Offline(
    title: "AgentOS is starting", body: "This takes a few seconds.", buttons: [])
  static let offlineUpdating = Offline(
    title: "AgentOS is updating", body: "It comes back by itself, usually within two minutes.",
    buttons: [tryAgain])
  static let offlineNotAnswering = Offline(
    title: "AgentOS isn't answering",
    body: "This window keeps trying every few seconds. The log may say why.", buttons: [tryAgain, showLog])
  static let offlineNotInstalled = Offline(
    title: "AgentOS isn't installed on this Mac",
    body: "Add this Mac from AgentOS on your phone: Settings, Machines, Add a Mac.", buttons: [])
  static let offlineCrashed = Offline(
    title: "This page stopped working", body: "Reload it to carry on. Your sessions kept running.",
    buttons: [reload])
  static let offlineSignIn = Offline(
    title: "AgentOS on this Mac asks you to sign in",
    body: "Sign-in works in your browser, not in this window.", buttons: [openInBrowser])

  // MARK: Dialogs

  static let uploadMessage = "Choose the files to send to AgentOS"
  static let downloadFailedTitle = "Couldn't download that"
  static func downloadFailedBody(_ file: String, _ reason: String) -> String { "\(file): \(reason)" }
  static let ok = "OK"
  static let alertDestructiveWords = ["Delete", "Kill", "Remove"]

  // MARK: Main menu

  static let aboutAgentOS = "About AgentOS"
  static let hideAgentOS = "Hide AgentOS"
  static let hideOthers = "Hide Others"
  static let showAll = "Show All"
  static let quitAgentOS = "Quit AgentOS"
  static let fileMenu = "File"
  static let newSession = "New Session…"
  static let closeWindow = "Close Window"
  static let editMenu = "Edit"
  static let undo = "Undo"
  static let redo = "Redo"
  static let cut = "Cut"
  static let copy = "Copy"
  static let paste = "Paste"
  static let pasteAndMatchStyle = "Paste and Match Style"
  static let selectAll = "Select All"
  static let viewMenu = "View"
  static let reloadPage = "Reload Page"
  static let back = "Back"
  static let forward = "Forward"
  static let enterFullScreen = "Enter Full Screen"
  static let windowMenu = "Window"
  static let minimize = "Minimize"
  static let zoom = "Zoom"
  static let appName = "AgentOS"
  static let bringAllToFront = "Bring All to Front"

  static func aboutCredits(_ version: String) -> String {
    "AgentOS on this Mac, version \(version). This window shows the sessions on this Mac. Closing or quitting this app doesn't stop your sessions."
  }

  /// The window's title: the page's, else "AgentOS"
  static func windowTitle(_ pageTitle: String?) -> String {
    guard let pageTitle, !pageTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return appName }
    return pageTitle
  }

  // MARK: Audit

  /// Every value, with sample arguments, for the string audit
  static var all: [String] {
    let offline = [
      offlineOff, offlineStarting, offlineUpdating, offlineNotAnswering, offlineNotInstalled, offlineCrashed,
      offlineSignIn,
    ].flatMap { [$0.title, $0.body] + $0.buttons }
    return [
      isOn, isOff, notInstalled, linkedTo("hub.example"), notLinked, version("0.5.0"), sessionsHere, noSessions,
      sessionRow("Build", "waiting"), stateWord("running"), stateWord("idle"), andMore(3), stopASession,
      openAgentOS, openServer, turnOff, turnOn, offNote, letServerSessions, reposFolder("~/AgentOS"),
      showInFinder, chooseFolder, useDefaultFolder, showAtLogin, uninstall, quit, turningOff, turningOn,
      turningThatOff, allowing, changingFolder, stopping("Build"), uninstalling, cancel, didntChange,
      allowTitle, allowBody("hub.example"), yourServer, allow, folderMissingTitle, folderMissingBody("~/AgentOS"),
      chooseFolderMessage, useThisFolder, stopTitle("Build"), stopBody, stop, turnOffTitle, turnOffBody,
      turnOffButton, loginFailedTitle, loginFailedBody("no"), uninstallButton, removedTitle, removedBody,
      noAnswer, refusedChange, errorCode(500), uploadMessage, downloadFailedTitle,
      downloadFailedBody("a.zip", "The disk is full."), ok, aboutAgentOS, hideAgentOS, hideOthers, showAll,
      quitAgentOS, fileMenu, newSession, closeWindow, editMenu, undo, redo, cut, copy, paste,
      pasteAndMatchStyle, selectAll, viewMenu, reloadPage, back, forward, enterFullScreen, windowMenu,
      minimize, zoom, appName, bringAllToFront, windowTitle(nil), aboutCredits("0.5.0"),
    ] + alertDestructiveWords + uninstallList + offline + IconState.samples.map(tooltipFirst)
      + [tooltipFirst(.needsYou(1)), tooltipFirst(.working(3))]
  }

  /// The tooltip's second lines, which may run to 160 characters
  static var long: [String] {
    ["offline", "connecting", "pending", "refused", "signin"].compactMap(tooltipSecond)
  }

  /// Alert bodies, which wrap in the alert and are kept as today's menu has them
  static var paragraphs: [String] {
    [allowBody("hub.example"), uninstallBody("• This app")]
  }
}
