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

// MARK: Stage 2: TextSafety

for (name, scalar) in [
  ("RLO", "\u{202E}"), ("LRE", "\u{202A}"), ("LRI", "\u{2066}"), ("PDI", "\u{2069}"), ("ZWSP", "\u{200B}"),
  ("RLM", "\u{200F}"), ("LSEP", "\u{2028}"), ("PSEP", "\u{2029}"), ("BOM", "\u{FEFF}"), ("NUL", "\u{0}"),
  ("ESC", "\u{1B}"), ("DEL", "\u{7F}"), ("C1", "\u{85}"), ("CSI", "\u{9B}"),
] {
  check("unsafe \(name)", TextSafety.hasUnsafe("ls \(scalar)x"))
}
check("newline and tab are safe", !TextSafety.hasUnsafe("a\nb\tc"))
check("plain text is safe", !TextSafety.hasUnsafe("touch inbox-test.txt — ✓ é"))
equal("clean replaces", TextSafety.clean("a\u{202E}b\u{1B}c\nd"), "a\u{FFFD}b\u{FFFD}c\nd")
let twenty = (1...20).map { "line \($0)" }.joined(separator: "\n")
equal("wrap cuts at 12 lines", TextSafety.wrap(twenty).lines.count, 12)
check("wrap says cut", TextSafety.wrap(twenty).cut)
check("wrap 12 lines not cut", !TextSafety.wrap((1...12).map { "l\($0)" }.joined(separator: "\n")).cut)
let longLine = String(repeating: "abcdefghij", count: 20)
equal("wrap hard-wraps a long line", TextSafety.wrap(longLine, width: 70).lines.map(\.count), [70, 70, 60])
check("wrap keeps every character", TextSafety.wrap(longLine, width: 70).lines.joined() == longLine)
equal("oneLine", TextSafety.oneLine("a\n  b\tc", max: 10), "a b c")
equal("oneLine cut", TextSafety.oneLine(String(repeating: "x", count: 20), max: 10), String(repeating: "x", count: 9) + "…")

// MARK: Stage 2: NotifyRules

func prompt(
  detail: String = "touch inbox-test.txt", options: [(String, String)] = [("Yes", "allow"), ("No", "deny")],
  title: String = "Bash command"
) -> PermissionPrompt {
  PermissionPrompt(
    title: title, description: "Create empty file", detail: detail, question: "Do you want to proceed?",
    options: options.enumerated().map { PromptOption(index: $0.offset, label: $0.element.0, kind: $0.element.1) },
    selected: 0)
}
func reply(_ p: PermissionPrompt?, _ fp: String? = "abcdef0123456789") -> PromptReply {
  PromptReply(prompt: p, fingerprint: p == nil ? nil : fp)
}
func event(_ kind: String, id: String = "e1", at: Int64 = 1_000_000, title: String = "From the server", session: String = "s1")
  -> NotificationEntry
{
  NotificationEntry(id: id, kind: kind, title: title, body: "It finished the task.", sessionId: session,
    projectName: "App", at: at)
}
var ctx = NotifyRules.NotifyContext(
  toggles: NotifyRules.Toggles(), windowShowingSession: nil, appIsActive: false, cursor: 0, handledIds: [],
  sessionState: ["s1": "waiting"])
let posted = NotifyRules.decide(event("needsYou"), ctx, prompt: reply(prompt()), sessionName: "Build", features: true)
check("needsYou posts", posted != nil)
equal("identifier", posted?.identifier, "s-s1")
equal("title is the app's", posted?.title, "Build needs you")
equal("subtitle is the project", posted?.subtitle, "App")
equal("needsYou category", posted?.category, .permission)
check("needsYou sound", posted?.sound == true)
check("body from the prompt",
  posted?.body.hasPrefix("Bash command: Create empty file\ntouch inbox-test.txt\nDo you want") == true,
  posted?.body ?? "")
check("suppressed when the prompt has gone",
  NotifyRules.decide(event("needsYou"), ctx, prompt: reply(nil), sessionName: "Build", features: true) == nil)
check("suppressed without a prompt read",
  NotifyRules.decide(event("needsYou"), ctx, prompt: nil, sessionName: "Build", features: true) == nil)
var active = ctx
active.appIsActive = true
active.windowShowingSession = "s1"
check("suppressed when the active window shows it",
  NotifyRules.decide(event("needsYou"), active, prompt: reply(prompt()), sessionName: "Build", features: true) == nil)
active.appIsActive = false
check("posted when the window shows it but the app is in the back",
  NotifyRules.decide(event("needsYou"), active, prompt: reply(prompt()), sessionName: "Build", features: true) != nil)
var running = ctx
running.sessionState = ["s1": "running"]
check("finished suppressed while running",
  NotifyRules.decide(event("finished"), running, prompt: nil, sessionName: "Build", features: true) == nil)
let done = NotifyRules.decide(event("finished"), ctx, prompt: nil, sessionName: "Build", features: true)
equal("finished title", done?.title, "Build is done")
equal("finished category", done?.category, .finished)
check("finished is quiet", done?.sound == false)
var off = ctx
off.toggles = NotifyRules.Toggles(needsYou: false, finished: false, limited: false)
let full = NotifyRules.decide(
  event("finished", title: "Full access switched on in Build"), off, prompt: nil, sessionName: "Build", features: true)
equal("Full access posts with every toggle off", full?.title, "Full access switched on for Build")
equal("Full access is INFO", full?.category, .info)
check("needsYou toggle off",
  NotifyRules.decide(event("needsYou"), off, prompt: reply(prompt()), sessionName: "Build", features: true) == nil)
check("finished toggle off", NotifyRules.decide(event("finished"), off, prompt: nil, sessionName: "Build", features: true) == nil)
equal("limited", NotifyRules.decide(event("limited"), ctx, prompt: nil, sessionName: "Build", features: true)?.title,
  "Build hit its usage limit")
equal("agentNeedsYou", NotifyRules.decide(event("agentNeedsYou"), ctx, prompt: nil, sessionName: "Build", features: true)?.title,
  "A background agent needs you")
for kind in ["resumed", "settled", "fromMachine", "test", "agentFinished", "somethingNew"] {
  check("\(kind) ignored", NotifyRules.decide(event(kind), ctx, prompt: reply(prompt()), sessionName: "B", features: true) == nil)
}
var seen = ctx
seen.handledIds = ["e1"]
check("dedupe by id", NotifyRules.decide(event("finished"), seen, prompt: nil, sessionName: "B", features: true) == nil)
var later = ctx
later.cursor = 1_000_000
check("at the cursor is old", NotifyRules.decide(event("finished"), later, prompt: nil, sessionName: "B", features: true) == nil)
check("a bad session id is ignored",
  NotifyRules.decide(event("finished", session: "../x"), ctx, prompt: nil, sessionName: "B", features: true) == nil)
equal("cold cursor", NotifyRules.startCursor(stored: nil, nowMs: 10_000_000), 10_000_000 - 120_000)
equal("stale cursor", NotifyRules.startCursor(stored: 1, nowMs: 10_000_000), 10_000_000 - 120_000)
equal("recent cursor kept", NotifyRules.startCursor(stored: 9_990_000, nowMs: 10_000_000), 9_990_000)
var ids: [String] = []
for i in 0..<250 { ids = NotifyRules.remember("id\(i)", in: ids) }
equal("handled keeps 200", ids.count, 200)
equal("handled keeps the newest", ids.last, "id249")
check("a bidi title is cleaned",
  NotifyRules.decide(event("finished"), ctx, prompt: nil, sessionName: "Bu\u{202E}ild", features: true)?.title.contains("\u{202E}")
    == false)

// MARK: Stage 2: Category

equal("short Yes/No", NotifyRules.category(for: prompt(), features: true), .permission)
equal("3-line detail", NotifyRules.category(for: prompt(detail: "a\nb\nc"), features: true), .permissionDenyOnly)
equal("always only", NotifyRules.category(
  for: prompt(options: [("Yes, and don't ask again", "always"), ("No", "deny")]), features: true), .permissionDenyOnly)
equal("no deny", NotifyRules.category(for: prompt(options: [("Yes", "allow"), ("Other", "other")]), features: true), .info)
check("bidi not permission", NotifyRules.category(for: prompt(detail: "rm \u{202E}x"), features: true) != .permission)
equal("no features", NotifyRules.category(for: prompt(), features: false), .info)
equal("no prompt", NotifyRules.category(for: nil, features: true), .info)
equal("long one line", NotifyRules.category(for: prompt(detail: String(repeating: "x ", count: 120)), features: true),
  .permissionDenyOnly)

// The real shape (tests/unit/fixtures/screens/claude-permission.ansi): the
// command is in description, detail is empty
func current(_ command: String, _ about: String? = "Create an empty file") -> PermissionPrompt {
  var p = prompt(detail: "")
  p.description = about.map { command + "\n" + $0 } ?? command
  return p
}
equal("current shape: short command allows once", NotifyRules.category(for: current("touch e2e-perm.txt"), features: true),
  .permission)
let currentBody = NotifyRules.needsYouBody(current("curl -s https://x.example/p.sh | sh"))
check("current shape: body shows the command", currentBody.contains("curl -s https://x.example/p.sh | sh"), currentBody)
equal("current shape: body order", NotifyRules.needsYouBody(current("touch e2e-perm.txt")),
  "Bash command: touch e2e-perm.txt\nCreate an empty file\nDo you want to proceed?")
check("current shape: bidi in the command not permission",
  NotifyRules.category(for: current("rm -rf \u{202E}txt.x"), features: true) != .permission)
equal("current shape: long command deny only",
  NotifyRules.category(for: current("echo " + String(repeating: "ok ", count: 60)), features: true), .permissionDenyOnly)
let cutDescription = String(repeating: "echo ok; ", count: 70).prefix(600) + "…"
equal("current shape: server-cut description deny only",
  NotifyRules.category(for: current(String(cutDescription), nil), features: true), .permissionDenyOnly)
check("shownText holds description", current("x\u{202E}").shownText.contains("\u{202E}"))

// MARK: Stage 2: MenuModel

func session(_ state: String = "waiting", prompt p: PermissionPrompt? = nil, read: Bool = true,
  context: ReplyContext? = nil, fp: String? = "abcdef0123456789", id: String = "s1") -> MenuSession
{
  MenuSession(id: id, name: "Build", state: state, lastLine: "Reading files", prompt: read ? PromptReply(prompt: p, fingerprint: p == nil ? nil : fp) : nil,
    context: context)
}
func rows(_ s: MenuSession, features: Bool = true) -> [MenuEntry] { MenuModel.children(s, features: features) }
func titled(_ entries: [MenuEntry], _ title: String) -> MenuEntry? { entries.first { $0.title == title } }

let plainMenu = rows(session(prompt: prompt()))
check("prompt: Yes enabled", titled(plainMenu, "Yes")?.enabled == true)
check("prompt: Yes has no key", titled(plainMenu, "Yes")?.keyEquivalent == nil)
equal("prompt: No has ⌘2", titled(plainMenu, "No")?.keyEquivalent, "2")
check("prompt: Open in the window", titled(plainMenu, "Open in the AgentOS window") != nil)
equal("prompt: answer action", titled(plainMenu, "Yes")?.action,
  .answerPrompt(id: "s1", index: 0, label: "Yes", fingerprint: "abcdef0123456789"))
check("prompt: no Stop what it's doing", titled(plainMenu, "Stop what it's doing") == nil)
equal("prompt: golden", MenuModel.text(plainMenu), """
  Bash command | disabled | -
  Create empty file | disabled | -
  touch inbox-test.txt | disabled | -
  Do you want to proceed? | disabled | -
  ---
  Yes | enabled | - | POST /api/sessions/s1/prompt proof=yes
  No | enabled | ⌘2 | POST /api/sessions/s1/prompt proof=yes
  ---
  Open in the AgentOS window | enabled | - | open

  """)
let longMenu = rows(session(prompt: prompt(detail: twenty, options: [("Yes", "allow"), ("Yes, always", "always"), ("No", "deny")])))
check("long: allow disabled", titled(longMenu, "Yes")?.enabled == false)
check("long: always disabled", titled(longMenu, "Yes, always")?.enabled == false)
check("long: always has no key", titled(longMenu, "Yes, always")?.keyEquivalent == nil)
check("long: deny enabled", titled(longMenu, "No")?.enabled == true)
check("long: Too long line", titled(longMenu, "Too long to show here. Open it in the window to allow it.") != nil)
// Description and detail share the 12 lines: one description line, 11 of detail
equal("long: 12 lines in all", longMenu.filter { $0.style == .mono || $0.style == .secondary && $0.title != Strings.tooLong }.count, 12)
let bidiMenu = rows(session(prompt: prompt(detail: "rm -rf \u{202E}txt.x")))
check("unsafe: allow disabled", titled(bidiMenu, "Yes")?.enabled == false)
check("unsafe: shown cleaned", bidiMenu.contains { $0.title.contains("\u{FFFD}") && !$0.title.contains("\u{202E}") })
// The server cuts a detail past 600 characters and adds "…": allow stays off
let serverCutDetail = String(repeating: "echo ok; ", count: 70).prefix(600) + "…"
let cutMenu = rows(session(prompt: prompt(detail: String(serverCutDetail))))
check("server-cut detail: fits 12 lines", cutMenu.filter { $0.style == .mono }.count <= 12)
check("server-cut detail: allow disabled", titled(cutMenu, "Yes")?.enabled == false)
check("server-cut detail: Too long line", titled(cutMenu, "Too long to show here. Open it in the window to allow it.") != nil)
check("server-cut detail: deny enabled", titled(cutMenu, "No")?.enabled == true)
check("600 characters and an ellipsis of its own: allowed", !MenuModel.serverCut(String(repeating: "x", count: 599) + "…"))
// A question naming a long file is wrapped, never cut; past 3 lines, allow is off
var editPrompt = prompt(detail: "")
editPrompt.question = "Do you want to make this edit to " + String(repeating: "a", count: 60) + "/settings.json?"
let editMenu = rows(session(prompt: editPrompt))
check("long question: file name shown", editMenu.filter { $0.style == .plain && !$0.enabled }.map(\.title).joined()
  .contains("/settings.json?"))
check("long question: allow enabled", titled(editMenu, "Yes")?.enabled == true)
editPrompt.question = String(repeating: "word ", count: 60)
check("question past 3 lines: allow disabled", titled(rows(session(prompt: editPrompt)), "Yes")?.enabled == false)
let longTitle = rows(session(prompt: prompt(title: String(repeating: "T", count: 71))))
check("title too long: allow disabled", titled(longTitle, "Yes")?.enabled == false)
// The real shape in the menu: the command is shown in full, wrapped, and a
// long one keeps allow off
let tail = "; rm -rf ~/work"
let longCommand = "echo " + String(repeating: "harmless ", count: 15) + tail
let currentMenu = rows(session(prompt: current(longCommand)))
check("current menu: whole command shown",
  currentMenu.filter { $0.style == .secondary }.map(\.title).joined(separator: " ").contains("rm -rf ~/work"))
check("current menu: no line past 70", currentMenu.allSatisfy { $0.title.count <= 70 })
check("current menu: fits, so allow on", titled(currentMenu, "Yes")?.enabled == true)
let hugeMenu = rows(session(prompt: current((1...14).map { "echo line \($0)" }.joined(separator: "\n"))))
check("current menu: past 12 lines allow off", titled(hugeMenu, "Yes")?.enabled == false)
check("current menu: past 12 lines Too long", titled(hugeMenu, Strings.tooLong) != nil)
check("current menu: past 12 lines deny on", titled(hugeMenu, "No")?.enabled == true)
// The server cuts the whole description, so its "…" comes last
let cutDescMenu = rows(session(prompt: current(String(cutDescription), nil)))
check("current menu: server-cut description allow off", titled(cutDescMenu, "Yes")?.enabled == false)
check("current menu: bidi in description allow off", titled(rows(session(prompt: current("rm \u{202E}x"))), "Yes")?.enabled == false)
var both = prompt(detail: (1...8).map { "+ line \($0)" }.joined(separator: "\n"))
both.description = (1...5).map { "about \($0)" }.joined(separator: "\n")
check("description and detail share 12 lines: allow off", titled(rows(session(prompt: both)), "Yes")?.enabled == false)
for (name, scalar) in [("ALM", "\u{061C}"), ("WJ", "\u{2060}"), ("tag", "\u{E0041}"), ("IAA", "\u{FFF9}")] {
  check("unsafe \(name)", TextSafety.hasUnsafe("ls \(scalar)x"))
}
var oddName = session("idle")
oddName.name = "\u{202E}evil\n\tname " + String(repeating: "x", count: 120)
let oddRow = MenuModel.build(MenuSnapshot(on: true, sessions: [oddName], features: true))[1].title
check("odd name: one line", !oddRow.contains("\n") && !oddRow.contains("\t") && !oddRow.contains("\u{202E}"), oddRow)
check("odd name: cut to 60", oddRow.hasPrefix("\u{FFFD}evil name x") && oddRow.hasSuffix("…  —  Idle"), oddRow)
let oldServer = rows(session(prompt: prompt()), features: false)
check("no features: every option disabled", oldServer.filter { if case .answerPrompt? = $0.action { return true }; return false }
  .allSatisfy { !$0.enabled })
check("no features: update line", titled(oldServer, "Answer it in the AgentOS window. AgentOS on this Mac needs an update first.") != nil)
let noFp = rows(session(prompt: prompt(), fp: nil))
check("no fingerprint: options disabled", titled(noFp, "No")?.enabled == false)

let runningMenu = rows(session("running"))
check("running: Stop what it's doing", titled(runningMenu, "Stop what it's doing")?.action == .interrupt(id: "s1"))
check("running: last line", runningMenu.first?.title == "Reading files")
check("running: End session…", titled(runningMenu, "End session…")?.action == .stop(id: "s1"))
let runningPrompt = rows(session("running", prompt: prompt()))
check("running with a prompt: no Stop what it's doing", titled(runningPrompt, "Stop what it's doing") == nil)
equal("idle", rows(session("idle")).map(\.title), ["Open in the AgentOS window", "Reply…", "End session…"])
equal("waiting, not read yet", rows(session(read: false)).map(\.title), ["Open in the AgentOS window", "End session…"])

func ask(_ questions: [AskQuestion]) -> ReplyContext {
  ReplyContext(kind: "ask", question: questions.first?.question, excerpt: "", questions: questions, onScreen: true,
    choices: nil)
}
let colour = AskQuestion(question: "Which colour?", header: "Colour", multiSelect: false,
  options: [AskOption(label: "Red", description: "Warm"), AskOption(label: "Blue", description: nil)])
let askMenu = rows(session(context: ask([colour])))
equal("ask: header", askMenu.first?.title, "Claude asks · Colour")
equal("ask: Blue", titled(askMenu, "Blue")?.action,
  .answerAsk(id: "s1", question: "Which colour?", optionCount: 2, labels: ["Red", "Blue"], pick: 1))
equal("ask: tooltip", titled(askMenu, "Red")?.tooltip, "Warm")
check("ask: own answer", titled(askMenu, "Type my own answer…") != nil)
let twoAsk = rows(session(context: ask([colour, colour])))
check("ask: several questions fall back", titled(twoAsk, "This has 2 questions. Answer them in the window.") != nil
  && titled(twoAsk, "Answer in the AgentOS window")?.action == .open(id: "s1") && titled(twoAsk, "Red") == nil)
var multi = colour
multi.multiSelect = true
check("ask: several choices fall back", titled(rows(session(context: ask([multi]))), "Red") == nil)

let chat = ReplyContext(kind: "message", question: "Shall I go on?", excerpt: "I fixed the build.", questions: nil,
  onScreen: false, choices: MessageChoices(question: "Shall I go on?", choices: [
    MessageChoice(label: "Yes", reply: "1. Yes"), MessageChoice(label: "Bad", reply: "ok\u{202E}"),
    MessageChoice(label: "Long", reply: String(repeating: "x", count: 80)),
  ]))
let chatMenu = rows(session(context: chat))
check("choice title equals the reply", titled(chatMenu, "1. Yes")?.action == .choice(id: "s1", reply: "1. Yes"))
check("unsafe choice hidden", !chatMenu.contains { $0.title.contains("ok") })
check("long choice hidden", !chatMenu.contains { $0.title.hasPrefix("xxxx") })
check("chat: Reply…", titled(chatMenu, "Reply…")?.action == .openPanel(.reply(id: "s1", name: "Build")))
check("chat: question bold", chatMenu.first?.style == .bold)

let many = (0..<15).map { session("idle", id: "s\($0)") }
let top = MenuModel.build(MenuSnapshot(on: true, sessions: many, features: true))
equal("12 rows", top.filter { if case .open? = $0.action { return !$0.children.isEmpty }; return false }.count, 12)
check("and 3 more", titled(top, "and 3 more")?.action == .openHome)
check("New session…", titled(top, "New session…")?.action == .openPanel(.newSession))
equal("no sessions", MenuModel.build(MenuSnapshot(on: true, sessions: [], features: true)).map(\.title),
  ["No sessions running on this Mac", "New session…"])
check("off: nothing", MenuModel.build(MenuSnapshot(on: false, sessions: many, features: true)).isEmpty)
let rowPath = MenuModel.entry(top[1].children, path: "1")
equal("entry path", rowPath?.title, "Reply…")
check("entry bad path", MenuModel.entry(top[1].children, path: "9") == nil)

let notes = MenuModel.notifications(authorization: "denied", toggles: NotifyRules.Toggles(needsYou: true, finished: false, limited: true))
check("notifications off line", titled(notes.children, "Notifications are off")?.enabled == false)
check("settings link", titled(notes.children, "Turn them on in System Settings…")?.action == .notifySettings)
check("toggle checks", titled(notes.children, "When a session needs you")?.checked == true
  && titled(notes.children, "When a session finishes")?.checked == false)
check("first ask", titled(MenuModel.notifications(authorization: "notDetermined", toggles: .init()).children,
  "Turn on notifications…") != nil)
check("help line", titled(notes.children, "Your phone still gets them from the server too.")?.enabled == false)

// MARK: Stage 2: Requests

func body(_ a: MenuAction) -> [String: Any] { Requests.request(for: a)?.body ?? [:] }
func describe(_ a: MenuAction) -> String {
  guard let r = Requests.request(for: a) else { return "nil" }
  return "\(r.method) \(r.path) \(r.needsProof)"
}
let newS = NewSession(projectId: "p1", workingDirectory: "~/app", agentType: "claude", model: nil, initialPrompt: "hi")
let table: [(MenuAction, String)] = [
  (.answerPrompt(id: "s1", index: 2, label: "No", fingerprint: "f"), "POST /api/sessions/s1/prompt true"),
  (.answerAsk(id: "s1", question: "Q", optionCount: 2, labels: ["a", "b"], pick: 0), "POST /api/sessions/s1/ask true"),
  (.askOther(id: "s1", question: "Q", optionCount: 2, labels: ["a", "b"], text: "c"), "POST /api/sessions/s1/ask true"),
  (.reply(id: "s1", text: "hi"), "POST /api/sessions/s1/send-keys true"),
  (.choice(id: "s1", reply: "1. Yes"), "POST /api/sessions/s1/send-keys true"),
  (.interrupt(id: "s1"), "POST /api/sessions/s1/interrupt false"),
  (.stop(id: "s1"), "POST /api/sessions/s1/stop false"),
  (.newSession(newS), "POST /api/sessions false"),
  (.open(id: "s1"), "nil"), (.openPanel(.newSession), "nil"), (.openHome, "nil"),
  (.reply(id: "../x", text: "hi"), "nil"),
]
for (a, want) in table { equal("request \(a.name) \(want)", describe(a), want) }
let nb = body(.newSession(newS))
check("newSession launch true", nb["launch"] as? Bool == true)
check("newSession no autoApprove or permissionMode", nb["autoApprove"] == nil && nb["permissionMode"] == nil)
check("newSession no model when none", nb["model"] == nil)
check("reply onlyIfNoPrompt", body(.reply(id: "s1", text: "hi"))["onlyIfNoPrompt"] as? Bool == true)
check("choice onlyIfNoPrompt and its reply", body(.choice(id: "s1", reply: "1. Yes"))["onlyIfNoPrompt"] as? Bool == true
  && body(.choice(id: "s1", reply: "1. Yes"))["text"] as? String == "1. Yes")
let ap = body(.answerPrompt(id: "s1", index: 2, label: "No", fingerprint: "f"))
check("answerPrompt carries index, label, fingerprint", ap["index"] as? Int == 2 && ap["label"] as? String == "No"
  && ap["fingerprint"] as? String == "f")
let aa = body(.answerAsk(id: "s1", question: "Q", optionCount: 2, labels: ["a", "b"], pick: 1))
check("answerAsk carries labels", (aa["labels"] as? [[String]]) == [["a", "b"]])
check("answerAsk picks", ((aa["answers"] as? [[String: Any]])?.first?["picks"] as? [Int]) == [1])
let ao = body(.askOther(id: "s1", question: "Q", optionCount: 2, labels: ["a", "b"], text: "c"))
check("askOther other text", ((ao["answers"] as? [[String: Any]])?.first?["other"] as? String) == "c")
check("features gate", BuildInfo.hasAnswerFeatures(["promptFingerprint", "replyGuard", "askLabels", "x"])
  && !BuildInfo.hasAnswerFeatures(["promptFingerprint", "replyGuard"]) && !BuildInfo.hasAnswerFeatures(nil))
let decoded = Models.decode(ProjectList.self, Data(#"{"projects":[{"id":"u","name":"U","working_directory":"~","is_uncategorized":1},{"id":"p","name":"P","working_directory":"~/p","is_uncategorized":false}]}"#.utf8))
check("projects decode 0/1 and bools", decoded?.projects.map(\.uncategorized) == [true, false])
let pr = Models.decode(PromptReply.self, Data(#"{"prompt":null,"fingerprint":null}"#.utf8))
check("an empty prompt reply decodes", pr != nil && pr?.prompt == nil)

// MARK: Stage 3: UpdateDecision

let own = "aaaaaaaaaaaaaaaa"
let newer = "bbbbbbbbbbbbbbbb"
for ready in [nil, own, newer] as [String?] {
  for staged in [false, true] {
    for window in [false, true] {
      for menu in [false, true] {
        for busy in [false, true] {
          for requested in [false, true] {
            let got = UpdateDecision.decide(
              ownHash: own, readyHash: ready, stagedExists: staged, windowVisible: window, menuOpen: menu,
              busy: busy, requested: requested)
            let want: UpdateAction
            if ready == nil || ready == own || !staged {
              want = .none
            } else if (!window && !menu && !busy) || requested {
              want = .swapNow
            } else {
              want = .offer
            }
            equal(
              "update ready=\(ready ?? "nil") staged=\(staged) window=\(window) menu=\(menu) busy=\(busy) asked=\(requested)",
              got, want)
          }
        }
      }
    }
  }
}
equal("ready hash read", UpdateDecision.readyHash("bbbbbbbbbbbbbbbb\n"), newer)
equal("ready hash junk", UpdateDecision.readyHash("../x"), nil)
equal("ready hash upper", UpdateDecision.readyHash("BBBBBBBBBBBBBBBB"), nil)
let swapLog = """
  2026-11-21T10:00:00Z ok from aaaaaaaaaaaaaaaa to bbbbbbbbbbbbbbbb
  2026-11-21T11:00:00Z failed from bbbbbbbbbbbbbbbb to cccccccccccccccc: couldn't put the new app in place
  noise
  """
let lastSwap = UpdateDecision.lastSwap(swapLog)
equal("swap log last", lastSwap?.to, "cccccccccccccccc")
equal("swap log last failed", lastSwap?.ok, false)
equal("swap log ok line", UpdateDecision.swapLine("2026-11-21T10:00:00Z ok from aaaaaaaaaaaaaaaa to bbbbbbbbbbbbbbbb")?.ok, true)
equal("swap log install line", UpdateDecision.swapLine("t ok from unknown to bbbbbbbbbbbbbbbb")?.from, "unknown")
check("swap failed for that hash", UpdateDecision.swapFailed(ownHash: newer, readyHash: "cccccccccccccccc", last: lastSwap))
check("swap failed not for another", !UpdateDecision.swapFailed(ownHash: newer, readyHash: "dddddddddddddddd", last: lastSwap))
check("build failed", UpdateDecision.buildFailed(["state": "failed", "hash": newer], ownHash: own))
check("build failed is old news", !UpdateDecision.buildFailed(["state": "failed", "hash": own], ownHash: own))
check("build staged", !UpdateDecision.buildFailed(["state": "staged", "hash": newer], ownHash: own))

let realPaths = UpdatePaths.make(home: "/Users/me", testRoot: nil, tempDir: "/var/folders/x/T/")
equal("update paths installed", realPaths.installed, ["/Applications/AgentOS.app", "/Users/me/Applications/AgentOS.app"])
equal("update paths ready", realPaths.ready, "/Users/me/.agent-os/mac-app/next/ready")
equal("update paths prev", realPaths.prev, "/Users/me/.agent-os/mac-app/prev.app")
let testPaths = UpdatePaths.make(home: "/Users/me", testRoot: "/var/folders/x/T/t1", tempDir: "/var/folders/x/T/")
equal("update test root", testPaths.installed.first, "/var/folders/x/T/t1/Applications/AgentOS.app")
check("update test root never /Applications", !testPaths.installed.contains("/Applications/AgentOS.app"))
for bad in ["/Applications", "/var/folders/x/T/../../Applications", "relative", "/var/folders/x/T/a b", "/tmp/x"] {
  equal("update test root refused: \(bad)", UpdatePaths.make(home: "/Users/me", testRoot: bad, tempDir: "/var/folders/x/T/"), realPaths)
}
equal("update test root /private", UpdatePaths.acceptedTestRoot("/private/var/folders/x/T/t", tempDir: "/var/folders/x/T/"), "/private/var/folders/x/T/t")
equal("swap target: installed", realPaths.target(bundlePath: "/Applications/AgentOS.app", existing: { _ in true }), "/Applications/AgentOS.app")
equal("swap target: a build folder", realPaths.target(bundlePath: "/Users/me/src/mac/build/AgentOS.app", existing: { _ in true }), nil)
equal("swap target: staged, none installed", realPaths.target(bundlePath: realPaths.staged, existing: { _ in false }), "/Applications/AgentOS.app")
equal("swap target: staged, home install", realPaths.target(bundlePath: realPaths.staged, existing: { $0.hasPrefix("/Users") }), "/Users/me/Applications/AgentOS.app")
equal("shell quote", SwapScript.quote("a'b"), "'a'\\''b'")
let script = SwapScript.text(SwapScript.Input(
  pid: 42, executable: "/Applications/AgentOS.app/Contents/MacOS/AgentOS", target: "/Applications/AgentOS.app",
  staged: realPaths.staged, paths: realPaths, fromHash: own, toHash: newer, window: true, path: "/?view=x'y", installing: false))
check("swap script waits for the app", script.contains("pid=42") && script.contains("kill -0 \"$pid\""))
check("swap script keeps prev", script.contains("prev='/Users/me/.agent-os/mac-app/prev.app'"))
check("swap script relaunches with the window", script.contains("--after-update window=1 'path=/?view=x'\\''y'"))
check("swap script no test env", !script.contains("--env"))
check("swap script installing only when asked", !script.contains("pgrep"))
let testScript = SwapScript.text(SwapScript.Input(
  pid: 1, executable: "e", target: testPaths.installed[0], staged: testPaths.staged, paths: testPaths, fromHash: "unknown",
  toHash: own, window: false, path: nil, installing: true))
check("swap script test env", testScript.contains("--env AGENTOS_APP_TEST_ROOT='/var/folders/x/T/t1'"))
check("swap script installing stops the old app", testScript.contains("pgrep -x AgentOS"))
check("swap script never names /Applications in a test", !testScript.contains("'/Applications"))

// MARK: Stage 3: UninstallText

let planJSON = #"""
  {"refused":null,"machine":"Studio","hub":"hub.example.app","goes":[{"what":"AgentOS and its updates","path":"/Users/me/.agent-os/repo","size":"1.4G"},{"what":"Its list of sessions, settings, logs, saved checkpoints and handoffs","path":"/Users/me/.agent-os"},{"what":"The key that links this Mac to hub.example.app","path":"Keychain"},{"what":"Starting AgentOS at login","path":"/Users/me/Library/LaunchAgents/com.agentos.machine.plist"},{"what":"The agent-os command","path":"/Users/me/.local/bin/agent-os"},{"what":"The menu bar app and its window settings","path":"/Applications/AgentOS.app"},{"what":"AgentOS's tools in codex","path":"codex"},{"what":"AgentOS's tools in gemini","path":"gemini"}],"stays":[],"sessions":[{"id":"1","name":"Build‮ it","tmux":"claude-1","stop":true}],"worktrees":[{"name":"fix","path":"/x","keep":true,"why":"3 changed files, 2 commits not pushed","to":"/Users/me/AgentOS/Kept from AgentOS/fix"},{"name":"done","path":"/y","keep":false,"why":null,"to":null}],"kept":"/Users/me/AgentOS/Kept from AgentOS","repos":"/Users/me/AgentOS","warnings":[],"done":null}
  """#
let plan = UninstallPlan.decode(Data(planJSON.utf8))
check("uninstall plan decodes", plan != nil)
let dialog = UninstallText.dialogText(plan ?? UninstallPlan(), home: "/Users/me")
equal("uninstall dialog title", dialog.title, "Remove AgentOS from this Mac?")
equal("uninstall dialog body", dialog.body, """
  AgentOS will be removed from this Mac (Studio).

  These go:
    • AgentOS and its updates (~/.agent-os/repo, 1.4G)
    • Its list of sessions, settings, logs, saved checkpoints and handoffs (~/.agent-os)
    • The key that links this Mac to hub.example.app (in your Keychain)
    • Starting AgentOS at login
    • The agent-os command (~/.local/bin/agent-os)
    • The menu bar app (/Applications/AgentOS.app) and its window settings
    • AgentOS's tools in Codex and Gemini

  Running sessions, stopped (their conversations stay in Claude):
    • Build\u{FFFD} it

  Worktrees with work not yet pushed, kept in ~/AgentOS/Kept from AgentOS:
    • fix (3 changed files, 2 commits not pushed)

  Worktrees with nothing unsaved, removed (their branches stay in the repository):
    • done

  These stay:
    • Your repositories (~/AgentOS) and everything in them
    • Claude's conversations and settings (~/.claude and ~/.claude.json)
    • Homebrew, Node and tmux
    • This app's entry in System Settings, Notifications

  Your server still lists this Mac. Remove it there afterwards: AgentOS on your phone, Settings, Machines.
  """)
check("uninstall dialog has no Type yes", !dialog.body.contains("Type yes"))
var bare = plan ?? UninstallPlan()
bare.sessions = []
bare.worktrees = []
let bareBody = UninstallText.dialogText(bare, home: "/Users/me").body
check("uninstall dialog without sessions or worktrees", !bareBody.contains("Running sessions") && !bareBody.contains("Worktrees"))
let doneResult = UninstallPlan.decode(Data(#"{"kept":"/Users/me/AgentOS/Kept from AgentOS","done":{"stopped":1,"kept":2,"removed":[],"left":[]}}"#.utf8))
let doneText = UninstallText.doneText(doneResult ?? UninstallPlan(), home: "/Users/me")
equal("uninstall done title", doneText.title, "AgentOS was removed from this Mac")
check("uninstall done body kept", doneText.body.hasSuffix("Work not yet pushed is kept in ~/AgentOS/Kept from AgentOS."))
let doneNone = UninstallText.doneText(UninstallPlan.decode(Data(#"{"done":{"stopped":0,"kept":0}}"#.utf8)) ?? UninstallPlan(), home: "/Users/me")
equal("uninstall done body plain", doneNone.body, Strings.uninstallDoneBody)
let partly = UninstallText.partlyText(UninstallPlan.decode(Data(#"{"done":{"stopped":0,"kept":0,"left":[{"path":"/Users/me/.agent-os","reason":"worktrees are still in it"}]}}"#.utf8)), home: "/Users/me", fallback: "x")
equal("uninstall partly", partly.body, "Still here:\n• ~/.agent-os: worktrees are still in it\n\nChoose Uninstall AgentOS… again to retry.")
equal("uninstall refusal hub", UninstallText.refusal("hub"), Strings.refusedHub)
equal("uninstall refusal session", UninstallText.refusal("inSession"), "Run this in Terminal, not in an AgentOS session. Nothing was removed.")
equal("uninstall refusal decodes", UninstallPlan.decode(Data(#"{"refused":"hub","message":"m"}"#.utf8))?.refused, "hub")
equal("launch --uninstall-plan", parse("--uninstall-plan"), .uninstallPlan)

// MARK: The window's toolbar (PageState, ToolbarModel, OpenIn)

let frontJSON = #"{"v":1,"session":"a1b2-c3","title":"Widget preview","detail":"fusionha-ios · main · Mac Studio","view":"changes","changes":4,"agents":false,"sidebar":true,"inspector":false,"dark":true,"needs":2}"#
let front = PageState.parse(frontJSON)
equal("state: session", front?.session, "a1b2-c3")
equal("state: view", front?.view, .changes)
equal("state: changes", front?.changes, 4)
check("state: flags", front?.sidebar == true && front?.inspector == false && front?.dark == true)
equal("state: needs", front?.needs, 2)
check("state: none is nil", PageState.parse("null") == nil && PageState.parse(nil) == nil)
check("state: not JSON is nil", PageState.parse("{") == nil)
check("state: another version is nil", PageState.parse(#"{"v":2,"session":"a"}"#) == nil)
check("state: too long is nil", PageState.parse(#"{"v":1,"title":""# + String(repeating: "a", count: 5000) + #""}"#) == nil)
let hostile = PageState.parse(#"{"v":1,"session":"../x","title":"a\u202Eb\nc","detail":"d","view":"settings","changes":-5,"agents":true,"needs":99999999}"#)
check("state: a bad id is no session", hostile != nil && hostile?.session == nil)
equal("state: title is cleaned to one line", hostile?.title, "a\u{FFFD}b c")
check("state: no session, no view, changes or agents", hostile?.view == nil && hostile?.changes == 0 && hostile?.agents == false)
equal("state: counts are capped", hostile?.needs, 9999)
let odd = PageState.parse(#"{"v":1,"session":"s1","view":"sidebar","title":"T"}"#)
check("state: a word that isn't a view is no view", odd?.session == "s1" && odd?.view == nil)
let longTitle = PageState.parse(#"{"v":1,"session":"s1","title":""# + String(repeating: "w", count: 300) + #""}"#)
equal("state: title is capped", longTitle?.title.count, 80)

equal("tabs: none without a session", ToolbarModel.tabs(hostile).count, 0)
equal("tabs: none without a state", ToolbarModel.tabs(nil).count, 0)
equal("tabs: four for a session", ToolbarModel.tabs(front).map(\.action), [.chat, .changes, .terminal, .files])
equal("tabs: Changes carries its count", ToolbarModel.tabs(front)[1].label, "Changes 4")
equal("tabs: the open one is selected", ToolbarModel.selected(front), 1)
check("tabs: nothing selected without a view", ToolbarModel.selected(odd) == nil)
var withAgents = front
withAgents?.agents = true
equal("tabs: Agents joins when the session has any", ToolbarModel.tabs(withAgents).last?.action, .agents)
equal("title: the session's", ToolbarModel.title(front, pageTitle: "x").title, "Widget preview")
equal("title: its line", ToolbarModel.title(front, pageTitle: "x").subtitle, "fusionha-ios · main · Mac Studio")
equal("title: the page's without a state", ToolbarModel.title(nil, pageTitle: "Sign in").title, "Sign in")
equal("title: the app's without either", ToolbarModel.title(nil, pageTitle: nil).title, "AgentOS")
check("actions: every word is one the page knows", PageAction.allCases.map(\.rawValue).sorted() == [
  "agents", "changes", "chat", "files", "find", "inspector", "new", "settings", "sidebar", "terminal",
])

let rows: [[String: Any]] = [
  ["id": "s1", "working_directory": "~/AgentOS/app", "worktree_path": NSNull()],
  ["id": "s2", "working_directory": "/Users/me/AgentOS/app", "worktree_path": "/Users/me/AgentOS/.worktrees/x"],
  ["id": "s3", "working_directory": "relative/path"],
  ["id": "s4", "working_directory": "/Users/me/../other"],
  ["id": "s5", "working_directory": "~"],
]
equal("open in: ~ is the home folder", OpenIn.folder(of: "s1", in: rows, home: "/Users/me"), "/Users/me/AgentOS/app")
equal("open in: the worktree wins", OpenIn.folder(of: "s2", in: rows, home: "/Users/me"), "/Users/me/AgentOS/.worktrees/x")
check("open in: a relative path is refused", OpenIn.folder(of: "s3", in: rows, home: "/Users/me") == nil)
check("open in: .. is refused", OpenIn.folder(of: "s4", in: rows, home: "/Users/me") == nil)
equal("open in: bare ~", OpenIn.folder(of: "s5", in: rows, home: "/Users/me"), "/Users/me")
check("open in: an unknown session has no folder", OpenIn.folder(of: "nope", in: rows, home: "/Users/me") == nil)
check("open in: a bad id has no folder", OpenIn.folder(of: "../s1", in: rows, home: "/Users/me") == nil)
equal("xcode: the one workspace", OpenIn.xcodeTarget(folder: "/p", entries: ["App.xcodeproj", "App.xcworkspace", "README.md"]), "/p/App.xcworkspace")
equal("xcode: the one project", OpenIn.xcodeTarget(folder: "/p/", entries: ["App.xcodeproj", "Sources"]), "/p/App.xcodeproj")
equal("xcode: two projects, the folder", OpenIn.xcodeTarget(folder: "/p", entries: ["A.xcodeproj", "B.xcodeproj"]), "/p")
equal("xcode: none, the folder", OpenIn.xcodeTarget(folder: "/p", entries: ["Package.swift"]), "/p")

print("\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
