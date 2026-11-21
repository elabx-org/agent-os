import Foundation

// Pure tests for mac/Sources/Logic. Run with ./test.sh.

var passed = 0
var failed = 0

func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
  if ok {
    passed += 1
    print("PASS \(name)")
  } else {
    failed += 1
    print("FAIL \(name): \(detail())")
  }
}

func equal<T: Equatable>(_ name: String, _ got: T, _ want: T) {
  check(name, got == want, "expected \(want), got \(got)")
}

// MARK: LinkPolicy and SessionLink (the table the self-test reruns)

for port in [3011, 4000] {
  for o in SelfChecks.linkPolicy(port: port) + SelfChecks.sessionLink(port: port) {
    check("\(o.name) (\(port))", o.ok, o.detail)
  }
}

equal("normalised path", LinkPolicy.normalisedPath(URL(string: "http://h/A//b/./c/../%64/")!), "/a/b/d/")
equal("normalised root", LinkPolicy.normalisedPath(URL(string: "http://h")!), "/")
equal("download name", LinkPolicy.cleanDownloadName("../..:a/b\u{7}.txt"), "ab.txt")
equal("download name empty", LinkPolicy.cleanDownloadName("..."), "download")
equal("download name long", LinkPolicy.cleanDownloadName(String(repeating: "x", count: 300)).count, 120)
equal("unique name", LinkPolicy.uniqueName("a.txt") { ["a.txt", "a 2.txt"].contains($0) }, "a 3.txt")
equal("unique name no ext", LinkPolicy.uniqueName("a") { $0 == "a" }, "a 2")

// MARK: IconState

func derive(
  installed: Bool = true, answering: Bool = true, loaded: Bool = true, updating: Bool = false,
  down: TimeInterval = 0, waiting: Int = 0, running: Int = 0
) -> IconState {
  IconState.derive(
    installed: installed, answering: answering, serviceLoaded: loaded, updating: updating, downFor: down,
    waiting: waiting, running: running)
}

equal("icon not installed", derive(installed: false, answering: false, loaded: false), .notInstalled)
equal("icon off over needsYou", derive(answering: false, loaded: false, waiting: 2), .off)
equal("icon updating over starting", derive(answering: false, updating: true, down: 3), .updating)
equal("icon notAnswering over idle", derive(answering: false, down: 60), .notAnswering)
equal("icon 19 s down is starting", derive(answering: false, down: 19), .starting)
equal("icon 21 s down is notAnswering", derive(answering: false, down: 21), .notAnswering)
equal("icon needsYou over working", derive(waiting: 1, running: 3), .needsYou(1))
equal("icon working", derive(running: 2), .working(2))
equal("icon idle", derive(), .idle)
equal("icon name", IconState.needsYou(2).name, "needsYou")
equal("icon count", IconState.needsYou(2).count, 2)
for status in ["offline", "connecting", "pending", "refused", "signin"] {
  check("linkDown \(status)", IconState.linkDown(status))
}
for status in ["linked", "off", nil] as [String?] {
  check("linkDown not for \(status ?? "nil")", !IconState.linkDown(status))
}

// MARK: LaunchMode

func parse(_ args: String...) -> LaunchMode { LaunchMode.parse(["/x/AgentOS"] + args) }

equal("launch plain", parse(), .app(AppOptions()))
equal("launch --version", parse("--version"), .version)
equal("launch --command", parse("--command", "dump-state"), .command("dump-state", []))
equal("launch --command args", parse("--command", "open-session", "abc"), .command("open-session", ["abc"]))
equal("launch --command none", parse("--command"), .command("", []))
equal("launch --self-test", parse("--self-test"), .selfTest([]))
equal("launch --self-test names", parse("--self-test", "load", "icon"), .selfTest(["load", "icon"]))
equal("launch -psn", parse("-psn_0_123"), .app(AppOptions()))
equal("launch -psn then --version", parse("-psn_0_123", "--version"), .version)
equal("launch unknown", parse("--bogus", "x"), .app(AppOptions()))
var opts = AppOptions()
opts.atLogin = true
equal("launch --at-login", parse("--at-login"), .app(opts))
opts = AppOptions()
opts.applyUpdate = true
equal("launch --apply-update", parse("--apply-update"), .app(opts))
opts = AppOptions()
opts.openSession = "abc"
equal("launch --open-session", parse("--open-session", "abc"), .app(opts))
equal("launch --open-session missing", parse("--open-session"), .app(AppOptions()))
opts = AppOptions()
opts.afterUpdate = true
opts.restoreWindow = true
opts.restorePath = "/x"
equal("launch --after-update", parse("--after-update", "window=1", "path=/x"), .app(opts))
opts = AppOptions()
opts.afterUpdate = true
equal("launch --after-update bare", parse("--after-update"), .app(opts))
opts.atLogin = true
equal("launch --after-update window=0 --at-login", parse("--after-update", "window=0", "--at-login"), .app(opts))

equal("channel args absent", LaunchMode.channelArguments(nil), [])
equal("channel args strings", LaunchMode.channelArguments(["a", "b"] as [Any]), ["a", "b"])
equal("channel args number first", LaunchMode.channelArguments([1, "abc"] as [Any]), nil)
equal("channel args number last", LaunchMode.channelArguments(["abc", 2] as [Any]), nil)
equal("channel args not a list", LaunchMode.channelArguments("abc"), nil)
equal("channel args NSArray", LaunchMode.channelArguments(NSArray(array: ["x"])), ["x"])

// MARK: WindowMemory

equal("memory drops session", WindowMemory.sanitize(path: "/?session=abc"), "/")
equal("memory keeps view", WindowMemory.sanitize(path: "/?view=projects&session=abc"), "/?view=projects")
equal("memory keeps project", WindowMemory.sanitize(path: "/?project=p1&x=1"), "/?project=p1")
equal("memory drops fragment", WindowMemory.sanitize(path: "/a#b"), "/a")
equal("memory rejects //evil", WindowMemory.sanitize(path: "//evil/x"), nil)
equal("memory rejects https", WindowMemory.sanitize(path: "https://x/"), nil)
equal("memory rejects relative", WindowMemory.sanitize(path: "x"), nil)
equal("memory rejects the proxy", WindowMemory.sanitize(path: "/proxy/5173/"), nil)
equal("memory rejects an encoded proxy", WindowMemory.sanitize(path: "/a/../%70roxy/1/"), nil)
equal("memory keeps /proxyfoo", WindowMemory.sanitize(path: "/proxyfoo"), "/proxyfoo")
let longPath = "/?view=" + String(repeating: "a", count: 400)
check("memory caps the length", (WindowMemory.sanitize(path: longPath)?.count ?? 0) <= 256)
let suite = "com.agentos.mac.tests.\(getpid())"
if let defaults = UserDefaults(suiteName: suite) {
  WindowMemory.save(path: "/?view=x&session=y", defaults: defaults)
  equal("memory round trip", WindowMemory.restorePath(defaults: defaults), "/?view=x")
  WindowMemory.save(path: "//evil", defaults: defaults)
  equal("memory bad path clears", WindowMemory.restorePath(defaults: defaults), nil)
  defaults.removePersistentDomain(forName: suite)
}

// MARK: Strings audit

let banned = [
  "Agent-OS", "Agent OS", "localhost", "WebView", "loopback", "PID", "daemon", "launchd", "HTTP", "API",
  "socket", "token", "cookie",
]
func audit(_ text: String, limit: Int?) {
  let word = banned.first { text.contains($0) }
  let label = String(text.prefix(40))
  check("string \"\(label)\" wording", word == nil, "contains \(word ?? "")")
  if let limit { check("string \"\(label)\" length", text.count <= limit, "\(text.count) > \(limit)") }
}
for text in Strings.all { audit(text, limit: 140) }
for text in Strings.long { audit(text, limit: 160) }
// Today's two alert paragraphs wrap in their alerts; wording only
for text in Strings.paragraphs { audit(text, limit: nil) }
equal("tooltip one needs you", Strings.tooltip(.needsYou(1), nil), "1 session needs you")
equal("tooltip many need you", Strings.tooltip(.needsYou(3), "pending"),
  "3 sessions need you\nWaiting for you to approve this Mac in AgentOS on your phone")
equal("tooltip working one", Strings.tooltip(.working(1), "linked"), "A session is working")
equal("window title fallback", Strings.windowTitle("  "), "AgentOS")
equal("window title", Strings.windowTitle("Projects"), "Projects")

print("\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
