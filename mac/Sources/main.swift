import AppKit

// Launch-mode dispatcher only. --version and --command stay Foundation-only
// and never touch NSApplication.shared.
switch LaunchMode.parse(CommandLine.arguments) {
case .version:
  print(AppInfo.versionLine())
  exit(0)
case .command(let cmd, let args):
  exit(CommandChannel.send(cmd, args))
case .selfTest(let only):
  SelfTest.run(only)
case .uninstallPlan:
  exit(UninstallFlow.printPlan())
case .app(let opts):
  // The staged update installs itself and quits (AppUpdater)
  if let code = Swapper.installIfStaged() { exit(code) }
  if CommandChannel.forwardIfRunning(opts) { exit(0) }
  MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate(opts)
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
    withExtendedLifetime(delegate) {}
  }
}
