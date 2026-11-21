import AppKit

/// "Uninstall AgentOS…" (a real menu click; no user proof is used). The
/// uninstaller script plans and does the work; the app shows its plan,
/// asks, runs it outside tmux, then clears its own data and goes to the
/// Trash.
@MainActor
final class UninstallFlow {
  private let queue = DispatchQueue(label: "agentos.uninstall")
  /// The status line while it runs ("Removing AgentOS…"), nil after
  var setBusy: (String?) -> Void = { _ in }
  private(set) var running = false

  /// The uninstaller: the installed copy, else the one inside this app
  nonisolated static func script() -> String? {
    let installed = Backend.agentHome.appendingPathComponent("repo/scripts/agentos-uninstall.sh").path
    if FileManager.default.isExecutableFile(atPath: installed) { return installed }
    return Bundle.main.url(forResource: "agentos-uninstall", withExtension: "sh")?.path
  }

  /// Runs the script (TMUX removed from its environment); its exit code and
  /// what it printed. Nil when it couldn't start or ran past `timeout`.
  nonisolated static func runScript(_ args: [String], timeout: TimeInterval) -> (Int32, Data)? {
    guard let script = script() else { return nil }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/bash")
    task.arguments = [script] + args
    var env = ProcessInfo.processInfo.environment
    env["TMUX"] = nil
    env["TMUX_PANE"] = nil
    task.environment = env
    let out = Pipe()
    task.standardOutput = out
    task.standardError = FileHandle.nullDevice
    task.standardInput = FileHandle.nullDevice
    nonisolated(unsafe) var data = Data()
    let reader = DispatchQueue(label: "agentos.uninstall.read")
    let readDone = DispatchSemaphore(value: 0)
    reader.async {
      data = out.fileHandleForReading.readDataToEndOfFile()
      readDone.signal()
    }
    do { try task.run() } catch { return nil }
    let end = Date().addingTimeInterval(timeout)
    while task.isRunning && Date() < end { usleep(100_000) }
    if task.isRunning {
      task.terminate()
      return nil
    }
    _ = readDone.wait(timeout: .now() + 5)
    return (task.terminationStatus, data)
  }

  /// --uninstall-plan: the dry run's JSON, printed (Foundation only)
  nonisolated static func printPlan() -> Int32 {
    guard let (code, data) = runScript(["--dry-run", "--json"], timeout: 60) else {
      print(#"{"error":"no uninstaller"}"#)
      return 4
    }
    FileHandle.standardOutput.write(data)
    return code
  }

  func start() {
    guard !running else { return }
    running = true
    guard UninstallFlow.script() != nil else {
      running = false
      return alert(Strings.cantFindUninstaller, "")
    }
    queue.async { [weak self] in
      let result = UninstallFlow.runScript(["--dry-run", "--json"], timeout: 60)
      DispatchQueue.main.async { self?.planned(result) }
    }
  }

  private func planned(_ result: (Int32, Data)?) {
    guard let (code, data) = result, let plan = UninstallPlan.decode(data) else {
      running = false
      return alert(Strings.cantFindUninstaller, "")
    }
    if code != 0 || plan.refused != nil {
      running = false
      return alert(UninstallText.refusal(plan.refused), "")
    }
    let home = Backend.home.path
    let text = UninstallText.dialogText(plan, home: home)
    let a = NSAlert()
    a.messageText = text.title
    a.informativeText = text.body
    a.alertStyle = .warning
    a.addButton(withTitle: Strings.uninstallButton).hasDestructiveAction = true
    a.addButton(withTitle: Strings.cancel)
    let hasSessions = !(plan.sessions ?? []).isEmpty
    if hasSessions {
      a.showsSuppressionButton = true
      a.suppressionButton?.title = Strings.keepSessionsRunning
      a.suppressionButton?.state = .off
    }
    NSApp.activate(ignoringOtherApps: true)
    guard a.runModal() == .alertFirstButtonReturn else {
      running = false
      return
    }
    let keep = hasSessions && a.suppressionButton?.state == .on
    setBusy(Strings.removing)
    var args = ["--yes", "--from-app", "--json"]
    if keep { args.append("--keep-sessions") }
    queue.async { [weak self] in
      let result = UninstallFlow.runScript(args, timeout: 120)
      DispatchQueue.main.async { self?.ran(result) }
    }
  }

  private func ran(_ result: (Int32, Data)?) {
    setBusy(nil)
    running = false
    let home = Backend.home.path
    let parsed = result.flatMap { UninstallPlan.decode($0.1) }
    guard let (code, _) = result, code == 0 else {
      let text = UninstallText.partlyText(parsed, home: home, fallback: Strings.uninstallerStopped)
      return alert(text.title, text.body)
    }
    // The app's own data, then the done alert, then the Trash, then gone
    UserDefaults.standard.removePersistentDomain(forName: "com.agentos.mac")
    let library = Backend.home.appendingPathComponent("Library")
    for folder in [
      "WebKit/com.agentos.mac", "Caches/com.agentos.mac", "HTTPStorages/com.agentos.mac",
      "Saved Application State/com.agentos.mac.savedState",
    ] {
      try? FileManager.default.removeItem(at: library.appendingPathComponent(folder))
    }
    let text = UninstallText.doneText(parsed ?? UninstallPlan(), home: home)
    alert(text.title, text.body)
    let bundle = Bundle.main.bundleURL
    if bundle.pathExtension == "app" { try? FileManager.default.trashItem(at: bundle, resultingItemURL: nil) }
    exit(0)
  }

  private func alert(_ title: String, _ body: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = body
    a.addButton(withTitle: Strings.ok)
    NSApp.activate(ignoringOtherApps: true)
    a.runModal()
  }
}
