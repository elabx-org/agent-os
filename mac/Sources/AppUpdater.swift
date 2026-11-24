import AppKit
import Security

@MainActor
protocol UpdaterHost: AnyObject {
  var windowVisible: Bool { get }
  var menuIsOpen: Bool { get }
  var isBusy: Bool { get }
  var windowPath: String? { get }
  func updaterChanged()
  /// The swap asked for as the app opened couldn't start: show the window
  func swapOnOpenFailed()
}

/// The one updater (D6). The service builds the new app into
/// ~/.agent-os/mac-app/next and writes next/ready; on each poll the app
/// reads it and swaps itself when nobody is looking, or offers a restart in
/// the menu. An update that is waiting when the person opens the app goes
/// in before its window shows. Only the app replaces itself: it re-checks the staged copy,
/// writes swap.sh, starts it and quits; the script swaps once it has gone.
@MainActor
final class AppUpdater {
  let paths: UpdatePaths
  weak var host: UpdaterHost?
  /// --apply-update or the channel's apply-update (only while no window shows)
  var requested = false
  private(set) var readyHash: String?
  private(set) var stagedExists = false
  private(set) var decision: UpdateAction = .none
  private(set) var failedSwap = false
  private(set) var buildFailed = false
  private(set) var lastSwap: UpdateDecision.SwapLine?
  private(set) var swapping = false
  /// The person is opening the app: the new copy shows the window
  private var opening = false
  private let queue = DispatchQueue(label: "agentos.updater")

  init(paths: UpdatePaths = Swapper.paths()) {
    self.paths = paths
  }

  /// The installed app this copy replaces; nil for a build run from elsewhere
  var target: String? {
    paths.target(bundlePath: Swapper.bundlePath, existing: { FileManager.default.fileExists(atPath: $0) })
  }

  func poll() {
    guard !swapping else { return }
    let own = AppInfo.sourceHash
    let before = (readyHash, decision, failedSwap, buildFailed)
    readyHash = UpdateDecision.readyHash(try? String(contentsOfFile: paths.ready, encoding: .utf8))
    stagedExists = FileManager.default.isExecutableFile(atPath: paths.staged + "/Contents/MacOS/AgentOS")
    lastSwap = UpdateDecision.lastSwap(Swapper.tail(paths.log))
    failedSwap = UpdateDecision.swapFailed(ownHash: own, readyHash: readyHash, last: lastSwap)
    let json = (try? Data(contentsOf: URL(fileURLWithPath: paths.updateJSON)))
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    buildFailed = UpdateDecision.buildFailed(json, ownHash: own)
    var d = UpdateAction.none
    if target != nil {
      d = UpdateDecision.decide(
        ownHash: own, readyHash: readyHash, stagedExists: stagedExists, windowVisible: host?.windowVisible ?? false,
        menuOpen: host?.menuIsOpen ?? false, busy: host?.isBusy ?? false, requested: requested)
      // A swap to this version failed once: not again by itself
      if failedSwap && !requested { d = .none }
    }
    decision = d
    // A request is for what is staged now, never for a later one
    if d == .none { requested = false }
    if before != (readyHash, decision, failedSwap, buildFailed) { host?.updaterChanged() }
    if d == .swapNow { swap() }
  }

  /// As the app opens, before its window: swaps to the update that was
  /// waiting. True when the swap has started (the app is about to quit and
  /// come back as the new one, with its window).
  func swapOnOpen() -> Bool {
    opening = true
    poll()
    if !swapping { opening = false }
    return swapping
  }

  /// The menu's "Restart the app to update it" (a real click)
  func restartNow() {
    requested = true
    poll()
  }

  private func swap() {
    guard !swapping, let target, let ready = readyHash, let exe = Bundle.main.executablePath else { return }
    swapping = true
    let paths = self.paths
    let input = SwapScript.Input(
      pid: getpid(), executable: exe, target: target, staged: paths.staged, paths: paths,
      fromHash: AppInfo.sourceHash, toHash: ready, window: opening || (host?.windowVisible ?? false),
      path: host?.windowPath.flatMap { WindowMemory.sanitize(path: $0) }, installing: false)
    queue.async { [weak self] in
      let started = Swapper.start(input)
      DispatchQueue.main.async {
        guard let self else { return }
        if started {
          NSApp.terminate(nil)
        } else {
          let wasOpening = self.opening
          self.opening = false
          self.swapping = false
          self.requested = false
          self.poll()
          if wasOpening { self.host?.swapOnOpenFailed() }
        }
      }
    }
  }
}

/// The parts of a swap that need no AppKit: also used by the staged copy,
/// which installs itself before any NSApplication exists
enum Swapper {
  static func paths() -> UpdatePaths {
    UpdatePaths.make(
      home: canonical(FileManager.default.homeDirectoryForCurrentUser.path),
      testRoot: ProcessInfo.processInfo.environment["AGENTOS_APP_TEST_ROOT"].map(canonical),
      tempDir: NSTemporaryDirectory())
  }

  /// A path with its links resolved (/var is /private/var), as the system
  /// reports this app's own bundle; the path itself when it doesn't exist
  static func canonical(_ path: String) -> String {
    guard let resolved = realpath(path, nil) else { return path }
    defer { free(resolved) }
    return String(cString: resolved)
  }

  static var bundlePath: String { canonical(Bundle.main.bundlePath) }

  /// The end of a log file (the last 8 KB)
  static func tail(_ path: String) -> String? {
    guard let h = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? h.close() }
    let size = (try? h.seekToEnd()) ?? 0
    try? h.seek(toOffset: size > 8192 ? size - 8192 : 0)
    return (try? h.readToEnd()).map { String(decoding: $0, as: UTF8.self) }
  }

  static func log(_ paths: UpdatePaths, _ line: String) {
    let dir = (paths.log as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let stamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("\(stamp) \(line)\n".utf8)
    if let h = FileHandle(forWritingAtPath: paths.log) {
      _ = try? h.seekToEnd()
      try? h.write(contentsOf: data)
      try? h.close()
    } else {
      FileManager.default.createFile(atPath: paths.log, contents: data, attributes: [.posixPermissions: 0o600])
    }
  }

  /// The staged copy is sound: a valid signature, our bundle id, and its
  /// --version names the hash in `ready`
  static func verify(_ bundle: String, hash: String) -> Bool {
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: bundle) as CFURL, [], &code) == errSecSuccess,
      let code,
      SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil)
        == errSecSuccess
    else { return false }
    guard Bundle(path: bundle)?.bundleIdentifier == "com.agentos.mac" else { return false }
    guard let line = run(bundle + "/Contents/MacOS/AgentOS", ["--version"], timeout: 10) else { return false }
    return line.contains("hash \(hash)")
  }

  /// Runs a tool and returns what it printed, or nil (failed or too slow)
  static func run(_ tool: String, _ args: [String], timeout: TimeInterval) -> String? {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: tool)
    task.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["TMUX"] = nil
    task.environment = env
    let out = Pipe()
    task.standardOutput = out
    task.standardError = FileHandle.nullDevice
    do { try task.run() } catch { return nil }
    let end = Date().addingTimeInterval(timeout)
    while task.isRunning && Date() < end { usleep(50_000) }
    if task.isRunning {
      task.terminate()
      return nil
    }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    return task.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
  }

  /// Writes swap.sh (new file, 0700, never through a link) in mac-app/
  static func writeScript(_ text: String, at path: String) -> Bool {
    let dir = (path as NSString).deletingLastPathComponent
    var info = stat()
    guard lstat(dir, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR, info.st_uid == getuid() else { return false }
    if lstat(path, &info) == 0 {
      guard (info.st_mode & S_IFMT) == S_IFREG else { return false }
      unlink(path)
    }
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o700)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    let data = Data(text.utf8)
    return data.withUnsafeBytes { raw -> Bool in
      var offset = 0
      while offset < raw.count {
        let n = Foundation.write(fd, raw.baseAddress! + offset, raw.count - offset)
        if n <= 0 { return false }
        offset += n
      }
      return true
    }
  }

  /// Starts /bin/sh swap.sh in its own session, so it outlives the app
  static func spawn(_ script: String) -> Bool {
    var attr: posix_spawnattr_t? = nil
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETSID))
    var actions: posix_spawn_file_actions_t? = nil
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    for fd: Int32 in [0, 1, 2] {
      posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", fd == 0 ? O_RDONLY : O_WRONLY, 0)
    }
    var pid: pid_t = 0
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup("/bin/sh"), strdup(script), nil]
    defer { for p in argv { free(p) } }
    var env = ProcessInfo.processInfo.environment
    env["TMUX"] = nil
    let envp: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { for p in envp { free(p) } }
    return posix_spawn(&pid, "/bin/sh", &actions, &attr, argv, envp) == 0
  }

  /// Checks the staged copy, writes the script and starts it. False: nothing
  /// was started (and the log says why).
  static func start(_ input: SwapScript.Input) -> Bool {
    let paths = input.paths
    guard verify(input.staged, hash: input.toHash) else {
      log(paths, "failed from \(input.fromHash) to \(input.toHash): the update didn't check out")
      return false
    }
    guard writeScript(SwapScript.text(input), at: paths.swapScript), spawn(paths.swapScript) else {
      log(paths, "failed from \(input.fromHash) to \(input.toHash): couldn't start the swap")
      return false
    }
    return true
  }

  /// Run from the staged copy (mac-app/next/AgentOS.app): it installs itself
  /// in place of the installed app (or as the first one) and quits. Nil when
  /// this copy isn't the staged one.
  static func installIfStaged() -> Int32? {
    let paths = paths()
    guard bundlePath == paths.staged else { return nil }
    let own = AppInfo.sourceHash
    guard UpdateDecision.readyHash(try? String(contentsOfFile: paths.ready, encoding: .utf8)) == own,
      let exe = Bundle.main.executablePath,
      let target = paths.target(bundlePath: paths.staged, existing: { FileManager.default.fileExists(atPath: $0) })
    else { return 1 }
    let old = Bundle(path: target)?.object(forInfoDictionaryKey: "AgentOSSourceHash") as? String
    // An installed app with the updater swaps itself, when its window is
    // closed; this copy only stands in for one without it (or none)
    if let old, UpdateDecision.isHash(old) { return 1 }
    let input = SwapScript.Input(
      pid: getpid(), executable: exe, target: target, staged: paths.staged, paths: paths,
      fromHash: "unknown", toHash: own, window: false,
      path: nil, installing: true)
    return start(input) ? 0 : 1
  }
}
