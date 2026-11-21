import AppKit

/// What the running app does for the command channel
@MainActor
protocol CommandTarget: AnyObject {
  func channelShow()
  func channelHide()
  func channelOpen(session id: String)
  func channelReload()
  func channelCapture(_ name: String, done: @escaping ([String]) -> Void)
  func channelDumpState() -> [String: Any]
  func channelQuit()
  func channelDumpMenu() -> String
  func channelPlan(session id: String, path: String) -> [String: Any]
  func channelNotifyStatus(_ done: @escaping ([String: Any]) -> Void)
  func channelDelivered(_ done: @escaping ([String: Any]) -> Void)
  func channelNotifyTest(_ done: @escaping ([String: Any]) -> Void)
}

/// The one way in from outside, for tests and second launches: a
/// distributed notification `com.agentos.mac.command`. It can only show,
/// hide, open, reload, capture or read. It never answers, replies, starts,
/// stops or uninstalls, never runs caller-supplied script, and never brings
/// the app in front of another app. Replies go to the test folder.
enum CommandChannel {
  static let name = Notification.Name("com.agentos.mac.command")
  static let bundleId = "com.agentos.mac"

  /// True while a command runs, so no Click can be made during one
  @MainActor static var isHandling: Bool { handling > 0 }
  @MainActor private static var handling = 0

  // MARK: Sending (Foundation only: never touches NSApplication.shared)

  static func othersRunning() -> Bool {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
      .contains { $0.processIdentifier != getpid() && !$0.isTerminated }
  }

  static func newToken() -> String {
    var rng = SystemRandomNumberGenerator()
    return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &rng)) }.joined()
  }

  /// Sends one command and prints the reply. 0: done; 1: the app said no;
  /// 2: no reply in time; 3: the app isn't running; 64: no command given.
  static func send(_ cmd: String, _ args: [String], timeout: TimeInterval = 10, quiet: Bool = false) -> Int32 {
    func say(_ text: String) { if !quiet { print(text) } }
    guard !cmd.isEmpty else {
      say(#"{"error":"usage: --command <name> [args]"}"#)
      return 64
    }
    guard othersRunning() else {
      say(#"{"error":"not running"}"#)
      return 3
    }
    let token = newToken()
    DistributedNotificationCenter.default().postNotificationName(
      name, object: nil, userInfo: ["cmd": cmd, "args": args, "token": token], deliverImmediately: true)
    let reply = TestFiles.dir.appendingPathComponent("reply-\(token).json")
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if let data = try? Data(contentsOf: reply) {
        unlink(reply.path)
        say(String(decoding: data, as: UTF8.self))
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["error"] == nil ? 0 : 1
      }
      usleep(50_000)
    }
    say(#"{"error":"no reply"}"#)
    return 2
  }

  /// A second launch hands over to the copy already running. False when
  /// none runs, or when it didn't answer (an older app without the channel).
  static func forwardIfRunning(_ opts: AppOptions) -> Bool {
    guard othersRunning() else { return false }
    if opts.atLogin { return true }
    let rc: Int32
    if let id = opts.openSession, SessionLink.isValidId(id) {
      rc = send("open-session", [id], timeout: 3, quiet: true)
    } else {
      rc = send("show", [], timeout: 3, quiet: true)
    }
    return rc == 0 || rc == 1
  }

  // MARK: Argument checks

  static func isToken(_ s: String) -> Bool {
    s.utf8.count == 32 && s.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
  }

  static func arguments(_ raw: Any?) -> [String]? { LaunchMode.channelArguments(raw) }

  /// A menu item path under a session's row: "3" or "0.2"
  static func isItemPath(_ s: String) -> Bool {
    let parts = s.split(separator: ".", omittingEmptySubsequences: false)
    return (1...4).contains(parts.count)
      && parts.allSatisfy { (1...3).contains($0.utf8.count) && $0.utf8.allSatisfy { $0 >= 0x30 && $0 <= 0x39 } }
  }

  static func isCaptureName(_ s: String) -> Bool {
    (1...32).contains(s.utf8.count)
      && s.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x7A) || $0 == 0x2D }
  }

  // MARK: Listening (the running app)

  @MainActor
  final class Listener: NSObject {
    private weak var target: CommandTarget?

    init(target: CommandTarget) {
      self.target = target
      super.init()
    }

    func start() {
      TestFiles.ensureDir()
      DistributedNotificationCenter.default().addObserver(
        self, selector: #selector(received(_:)), name: CommandChannel.name, object: nil,
        suspensionBehavior: .deliverImmediately)
    }

    @objc private func received(_ note: Notification) {
      guard let info = note.userInfo, let token = info["token"] as? String, CommandChannel.isToken(token),
        let cmd = info["cmd"] as? String
      else { return }
      CommandChannel.handling += 1
      // Arguments are strings or nothing; a list with anything else in it is
      // refused whole, so a dropped item can't shift the rest into place
      guard let args = CommandChannel.arguments(info["args"]) else {
        TestFiles.publish(name: "reply-\(token).json", data: TestFiles.json(["error": "bad args"]))
        CommandChannel.handling -= 1
        return
      }
      handle(cmd, args) { reply in
        TestFiles.publish(name: "reply-\(token).json", data: TestFiles.json(reply))
        CommandChannel.handling -= 1
      }
    }

    private func handle(_ cmd: String, _ args: [String], reply: @escaping ([String: Any]) -> Void) {
      guard let target else { return reply(["error": "not ready"]) }
      switch cmd {
      case "show":
        target.channelShow()
        reply(["ok": true])
      case "hide":
        target.channelHide()
        reply(["ok": true])
      case "open-session":
        guard args.count == 1, SessionLink.isValidId(args[0]) else { return reply(["error": "bad id"]) }
        target.channelOpen(session: args[0])
        reply(["ok": true])
      case "reload":
        target.channelReload()
        reply(["ok": true])
      case "capture":
        guard args.count == 1, CommandChannel.isCaptureName(args[0]) else { return reply(["error": "bad name"]) }
        target.channelCapture(args[0]) { files in reply(["files": files]) }
      case "dump-state":
        reply(target.channelDumpState())
      case "quit":
        reply(["ok": true])
        target.channelQuit()
      case "dump-menu":
        reply(["menu": target.channelDumpMenu()])
      case "plan":
        // Prints what the item would send. It never sends.
        guard args.count == 2, SessionLink.isValidId(args[0]) else { return reply(["error": "bad id"]) }
        guard CommandChannel.isItemPath(args[1]) else { return reply(["error": "bad path"]) }
        reply(target.channelPlan(session: args[0], path: args[1]))
      case "notify-status":
        target.channelNotifyStatus(reply)
      case "delivered":
        target.channelDelivered(reply)
      case "notify-test":
        target.channelNotifyTest(reply)
      default:
        // apply-update arrives with Stage 3
        reply(["error": "unknown"])
      }
    }
  }
}
