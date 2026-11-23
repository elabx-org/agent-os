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
  static let startAtLogin = "Start at login"
  static let uninstall = "Uninstall AgentOS…"
  static let quit = "Quit"

  // MARK: Status menu: busy lines and alerts (today's wording)

  static let turningOff = "Turning off…"
  static let turningOn = "Turning on…"
  static let turningThatOff = "Turning that off…"
  static let allowing = "Allowing…"
  static let changingFolder = "Changing the folder…"
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
  static func endTitle(_ name: String) -> String { "End \"\(name)\"?" }
  static let stopBody = "Its agent and terminal end. The session stays in AgentOS and starts again when you open it."
  static let endButton = "End Session"
  static let turnOffTitle = "Turn AgentOS off on this Mac?"
  static let turnOffBody =
    "Nothing can reach this Mac until you turn it on again. Sessions already running keep running in the background."
  static let turnOffButton = "Turn Off"
  static let uninstallTitle = "Remove AgentOS from this Mac?"
  static let uninstallButton = "Remove AgentOS"
  static let keepSessionsRunning = "Keep my running sessions running"
  static let removing = "Removing AgentOS…"
  static let uninstallDoneTitle = "AgentOS was removed from this Mac"
  static let uninstallDoneBody =
    "The app is in the Trash. Your repositories and Claude's conversations (~/.claude) are untouched. Remove this Mac on your phone too: AgentOS, Settings, Machines."
  static func workKeptIn(_ path: String) -> String { "Work not yet pushed is kept in \(path)." }
  static let partlyTitle = "AgentOS was only partly removed"
  static func partlyBody(_ left: [(String, String)]) -> String {
    "Still here:\n" + left.map { "• \($0.0): \($0.1)" }.joined(separator: "\n")
      + "\n\nChoose Uninstall AgentOS… again to retry."
  }
  static let cantFindUninstaller = "This app can't find AgentOS's uninstaller. Run agent-os uninstall in Terminal."
  static let uninstallerStopped = "the uninstaller stopped before it finished"
  static let refusedHub =
    "This is the AgentOS your Macs link to, not a linked Mac. agent-os uninstall only removes AgentOS from a linked Mac. Nothing was removed."
  static let refusedRoot = "Run this as yourself, not with sudo. Nothing was removed."
  static let refusedNotInstalled = "AgentOS isn't installed on this Mac."
  static let refusedInSession = "Run this in Terminal, not in an AgentOS session. Nothing was removed."
  static let refusedHome = "This Terminal's home folder isn't your account's home folder. Nothing was removed."

  // MARK: App update (Stage 3)

  static let restartToUpdate = "Restart the app to update it"
  static let updateReady = "App update ready"
  static let updateFailed = "Couldn't update the app. Run agent-os link app update in Terminal."
  static let buildFailed = "This menu couldn't update itself. Details: ~/.agent-os/logs/app-build.log"
  static let noAnswer = "AgentOS on this Mac didn’t answer."
  static let refusedChange =
    "AgentOS on this Mac refused the change. Change it in AgentOS on your phone instead (Settings, Machines)."
  static func errorCode(_ status: Int) -> String { "AgentOS answered with an error (\(status))." }

  // MARK: Session submenus (Stage 2)

  static let claudeAsks = "Claude asks"
  static func claudeAsksAbout(_ header: String) -> String { "Claude asks · \(header)" }
  static let tooLong = "Too long to show here. Open it in the window to allow it."
  static let needsUpdate = "Answer it in the AgentOS window. AgentOS on this Mac needs an update first."
  static func hasQuestions(_ n: Int) -> String { "This has \(n) questions. Answer them in the window." }
  static let answerInWindow = "Answer in the AgentOS window"
  static let typeOwnAnswer = "Type my own answer…"
  static let replyMenu = "Reply…"
  static let stopWhatItsDoing = "Stop what it's doing"
  static let openInWindow = "Open in the AgentOS window"
  static let endSession = "End session…"
  static let answering = "Answering…"
  static let sending = "Sending…"
  static let stoppingBusy = "Stopping…"
  static let startingSession = "Starting a session…"
  static let newSessionMenu = "New session…"
  static let notificationsMenu = "Notifications"

  // MARK: Alerts after an answer

  static let changedTitle = "That question changed"
  static let changedBody = "It now asks something else. Look again before you answer."
  static let showMe = "Show me"
  static let refusedTitle = "AgentOS on this Mac didn't take that"
  static let refusedBody = "Answer it in the AgentOS window instead."
  static let openWindow = "Open window"
  static let guardedTitle = "It's asking for permission now"
  static let guardedBody = "Answer that first, then send your reply."

  // MARK: Reply panel

  static func replyTo(_ name: String) -> String { "Reply to \(name)" }
  static let typeYourReply = "Type your reply"
  static let send = "Send"

  // MARK: New session panel

  static let newSessionTitle = "New session on this Mac"
  static let projectLabel = "Project"
  static let noProject = "No project (home folder)"
  static let taskLabel = "What should it do?"
  static let taskPlaceholder = "Describe the task. Leave empty to start it and type later."
  static func defaultsLine(_ agent: String, _ model: String, _ folder: String) -> String {
    "\(agent) · \(model) · In \(folder)"
  }
  static let usualModel = "its usual model"
  static let askNote = "It will ask you before it acts. For Full access, start it in the AgentOS window."
  static let openItInWindow = "Open it in the window"
  static let start = "Start"
  static let noProjects = "No projects yet. Add one in the AgentOS window."
  static func agentName(_ type: String?) -> String {
    ["claude": "Claude", "codex": "Codex", "gemini": "Gemini", "shell": "Shell"][type ?? "claude"]
      ?? (type ?? "Claude")
  }

  // MARK: Notifications submenu

  static let whenNeedsYou = "When a session needs you"
  static let whenFinishes = "When a session finishes"
  static let whenLimited = "When a session hits its usage limit"
  static let phoneStillGets = "Your phone still gets them from the server too."
  static let turnOnNotifications = "Turn on notifications…"
  static let notificationsOff = "Notifications are off"
  static let turnOnInSettings = "Turn them on in System Settings…"
  static let notificationSettingsURL =
    "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.agentos.mac"

  // MARK: Notifications (titles built by the app)

  static func notifyNeedsYou(_ name: String) -> String { "\(name) needs you" }
  static func notifyFinished(_ name: String) -> String { "\(name) is done" }
  static func notifyLimited(_ name: String) -> String { "\(name) hit its usage limit" }
  static func notifyFullAccess(_ name: String) -> String { "Full access switched on for \(name)" }
  static let notifyAgentNeedsYou = "A background agent needs you"
  static let aSession = "A session"
  static let allowOnce = "Allow once"
  static let deny = "Deny"
  static let notifyChangedBody = "Open it to see what it asks now."
  static func couldntAnswer(_ name: String) -> String { "Couldn't answer \"\(name)\"" }
  static func couldntReply(_ name: String) -> String { "Couldn't send your reply to \"\(name)\"" }
  static let testTitle = "AgentOS test"
  static let testBody = "If you see this, notifications work on this Mac."

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

  // MARK: The window's toolbar

  static let tabChat = "Chat"
  static let tabTerminal = "Terminal"
  static let tabFiles = "Files"
  static let tabAgents = "Agents"
  /// "Changes", or "Changes 4" with the number of changed files
  static func tabChanges(_ files: Int) -> String { files > 0 ? "Changes \(files)" : "Changes" }
  static let viewsLabel = "View"
  static let sidebarLabel = "Sidebar"
  static let sidebarTip = "Show or hide the sidebar"
  static let inspectorLabel = "Inspector"
  static let inspectorTip = "Show or hide the inspector"
  static let findLabel = "Find"
  static let findTip = "Find sessions, files and projects"
  static let newChatLabel = "New Chat"
  static let newChatTip = "Start a new chat"
  static let openInLabel = "Open In"
  static let openInTip = "Open this session's folder in another app"
  static let openInFinder = "Finder"
  static let openInXcode = "Xcode"
  static let openInTerminal = "Terminal"
  static let showSidebar = "Show Sidebar"
  static let hideSidebar = "Hide Sidebar"
  static let showInspector = "Show Inspector"
  static let hideInspector = "Hide Inspector"
  static let findMenu = "Find…"
  static let allSessionsMenu = "All Sessions"
  static let noFolderTitle = "This session's folder isn't on this Mac"
  static let noFolderBody = "The folder may have been moved or removed. The session itself is not affected."
  static func noAppTitle(_ app: String) -> String { "\(app) isn't installed on this Mac" }

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
      sessionRow("Build", "waiting"), stateWord("running"), stateWord("idle"), andMore(3),
      openAgentOS, openServer, turnOff, turnOn, offNote, letServerSessions, reposFolder("~/AgentOS"),
      showInFinder, chooseFolder, useDefaultFolder, startAtLogin, uninstall, quit, turningOff, turningOn,
      turningThatOff, allowing, changingFolder, cancel, didntChange,
      allowTitle, yourServer, allow, folderMissingTitle, folderMissingBody("~/AgentOS"),
      chooseFolderMessage, useThisFolder, endTitle("Build"), stopBody, endButton, turnOffTitle, turnOffBody,
      turnOffButton,
      noAnswer, refusedChange, errorCode(500), uploadMessage, downloadFailedTitle,
      downloadFailedBody("a.zip", "The disk is full."), ok, aboutAgentOS, hideAgentOS, hideOthers, showAll,
      quitAgentOS, fileMenu, newSession, closeWindow, editMenu, undo, redo, cut, copy, paste,
      pasteAndMatchStyle, selectAll, viewMenu, reloadPage, back, forward, enterFullScreen, windowMenu,
      minimize, zoom, appName, bringAllToFront, windowTitle(nil), aboutCredits("0.5.0"),
    ] + toolbar + stage2 + stage3 + alertDestructiveWords + offline + IconState.samples.map(tooltipFirst)
      + [tooltipFirst(.needsYou(1)), tooltipFirst(.working(3))]
  }

  static var toolbar: [String] {
    [
      tabChat, tabTerminal, tabFiles, tabAgents, tabChanges(0), tabChanges(12), viewsLabel, sidebarLabel,
      sidebarTip, inspectorLabel, inspectorTip, findLabel, findTip, newChatLabel, newChatTip, openInLabel,
      openInTip, openInFinder, openInXcode, openInTerminal, showSidebar, hideSidebar, showInspector,
      hideInspector, findMenu, allSessionsMenu, noFolderTitle, noFolderBody, noAppTitle("Xcode"),
    ]
  }

  static var stage2: [String] {
    [
      claudeAsks, claudeAsksAbout("Colour"), tooLong, needsUpdate, hasQuestions(3), answerInWindow, typeOwnAnswer,
      replyMenu, stopWhatItsDoing, openInWindow, endSession, answering, sending, stoppingBusy, startingSession,
      newSessionMenu, notificationsMenu, changedTitle, changedBody, showMe, refusedTitle, refusedBody, openWindow,
      guardedTitle, guardedBody, replyTo("Build"), typeYourReply, send, newSessionTitle, projectLabel, noProject,
      taskLabel, taskPlaceholder, defaultsLine("Claude", usualModel, "~/AgentOS/app"), usualModel, askNote,
      openItInWindow, start, noProjects, agentName("codex"), whenNeedsYou, whenFinishes, whenLimited,
      phoneStillGets, turnOnNotifications, notificationsOff, turnOnInSettings, notifyNeedsYou("Build"),
      notifyFinished("Build"), notifyLimited("Build"), notifyFullAccess("Build"), notifyAgentNeedsYou, aSession,
      allowOnce, deny, notifyChangedBody, couldntAnswer("Build"), couldntReply("Build"), testTitle, testBody,
    ]
  }

  static var stage3: [String] {
    [
      uninstallTitle, uninstallButton, keepSessionsRunning, removing, uninstallDoneTitle, workKeptIn("~/AgentOS/Kept"),
      partlyTitle, cantFindUninstaller, uninstallerStopped, refusedRoot, refusedNotInstalled, refusedInSession,
      refusedHome, restartToUpdate, updateReady, updateFailed, buildFailed,
    ]
  }

  /// The tooltip's second lines, which may run to 160 characters
  static var long: [String] {
    ["offline", "connecting", "pending", "refused", "signin"].compactMap(tooltipSecond)
  }

  /// Alert bodies, which wrap in the alert and are kept as today's menu has them
  static var paragraphs: [String] {
    [allowBody("hub.example"), uninstallDoneBody, refusedHub, partlyBody([("~/.agent-os", "couldn't remove it")])]
  }
}
