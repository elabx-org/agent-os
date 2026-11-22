import Foundation

/// What the app does about a staged update (pure)
enum UpdateAction: String, Equatable {
  case none, swapNow, offer
}

enum UpdateDecision {
  /// Swap when nobody is looking (no window, no menu, nothing in flight) or
  /// when asked to; otherwise offer it in the menu
  static func decide(
    ownHash: String, readyHash: String?, stagedExists: Bool, windowVisible: Bool, menuOpen: Bool, busy: Bool,
    requested: Bool
  ) -> UpdateAction {
    guard let readyHash, readyHash != ownHash, stagedExists else { return .none }
    if (!windowVisible && !menuOpen && !busy) || requested { return .swapNow }
    return .offer
  }

  /// A source hash: 16 lowercase hex characters
  static func isHash(_ s: String) -> Bool {
    s.utf8.count == 16 && s.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
  }

  /// The hash in `next/ready`, or nil when it isn't one
  static func readyHash(_ text: String?) -> String? {
    guard let text else { return nil }
    let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return isHash(line) ? line : nil
  }

  /// One line of `app-update.log`:
  /// `<at> ok from <old> to <new>` or `<at> failed from <old> to <new>: <why>`
  struct SwapLine: Equatable {
    var at: String
    var ok: Bool
    var from: String
    var to: String
  }

  static func swapLine(_ line: String) -> SwapLine? {
    let words = line.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
    guard words.count >= 6, words[1] == "ok" || words[1] == "failed", words[2] == "from", words[4] == "to" else {
      return nil
    }
    let to = words[5].hasSuffix(":") ? String(words[5].dropLast()) : words[5]
    guard isHash(words[3]) || words[3] == "unknown", isHash(to) else { return nil }
    return SwapLine(at: words[0], ok: words[1] == "ok", from: words[3], to: to)
  }

  /// The last swap the log records
  static func lastSwap(_ log: String?) -> SwapLine? {
    guard let log else { return nil }
    for line in log.split(separator: "\n").reversed() {
      if let s = swapLine(String(line)) { return s }
    }
    return nil
  }

  /// A swap to this hash was tried and failed: the app came back on its old
  /// version. It isn't tried again by itself (the menu says so instead).
  static func swapFailed(ownHash: String, readyHash: String?, last: SwapLine?) -> Bool {
    guard let readyHash, let last, !last.ok else { return false }
    return last.to == readyHash && readyHash != ownHash
  }

  /// `app-update.json` says the last build failed (for a source other than
  /// this app's own)
  static func buildFailed(_ json: [String: Any]?, ownHash: String) -> Bool {
    guard let json, json["state"] as? String == "failed" else { return false }
    return (json["hash"] as? String) != ownHash
  }
}

/// Where the updater looks. A test root (an absolute folder under the temp
/// folder) moves every one of them, so tests never reach /Applications.
struct UpdatePaths: Equatable {
  /// The only places the app is ever installed
  var installed: [String]
  /// ~/.agent-os/mac-app: next/ (staged), next/ready, prev.app
  var macApp: String
  var log: String
  var buildLog: String
  var updateJSON: String
  var testRoot: String?

  var next: String { macApp + "/next" }
  var staged: String { next + "/AgentOS.app" }
  var ready: String { next + "/ready" }
  var prev: String { macApp + "/prev.app" }
  var swapScript: String { macApp + "/swap.sh" }

  static func make(home: String, testRoot: String?, tempDir: String) -> UpdatePaths {
    if let root = testRoot.flatMap({ acceptedTestRoot($0, tempDir: tempDir) }) {
      return UpdatePaths(
        installed: [root + "/Applications/AgentOS.app", root + "/HomeApplications/AgentOS.app"],
        macApp: root + "/mac-app", log: root + "/logs/app-update.log", buildLog: root + "/logs/app-build.log",
        updateJSON: root + "/mac-app/app-update.json", testRoot: root)
    }
    let agentHome = home + "/.agent-os"
    return UpdatePaths(
      installed: ["/Applications/AgentOS.app", home + "/Applications/AgentOS.app"],
      macApp: agentHome + "/mac-app", log: agentHome + "/logs/app-update.log",
      buildLog: agentHome + "/logs/app-build.log", updateJSON: agentHome + "/mac-app/app-update.json",
      testRoot: nil)
  }

  /// A test root is honoured only as a plain absolute folder under the temp
  /// folder: no "..", no quotes or spaces (it goes into a script)
  static func acceptedTestRoot(_ root: String, tempDir: String) -> String? {
    var r = root
    while r.count > 1 && r.hasSuffix("/") { r.removeLast() }
    var t = tempDir
    while t.count > 1 && t.hasSuffix("/") { t.removeLast() }
    guard r.hasPrefix("/"), !t.isEmpty, r.hasPrefix(t + "/") || r.hasPrefix("/private" + t + "/") else { return nil }
    guard !r.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else { return nil }
    let ok = r.utf8.allSatisfy { b in
      (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x2F || b == 0x2E
        || b == 0x2D || b == 0x5F
    }
    return ok ? r : nil
  }

  /// Which installed app a swap replaces: this one when it runs from a fixed
  /// path; for the staged copy (it installs itself), the installed app, else
  /// the first fixed path. Anything else: none.
  func target(bundlePath: String, existing: (String) -> Bool) -> String? {
    if installed.contains(bundlePath) { return bundlePath }
    if bundlePath == staged { return installed.first(where: existing) ?? installed.first }
    return nil
  }
}

/// The script that swaps the app while it isn't running (pure text)
enum SwapScript {
  /// A shell word in single quotes
  static func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

  struct Input {
    var pid: Int32
    var executable: String
    var target: String
    var staged: String
    var paths: UpdatePaths
    var fromHash: String
    var toHash: String
    var window: Bool
    var path: String?
    var installing: Bool
  }

  static let lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

  static func text(_ i: Input) -> String {
    let q = quote
    var relaunch = "/usr/bin/open -g"
    if let root = i.paths.testRoot { relaunch += " --env AGENTOS_APP_TEST_ROOT=" + q(root) }
    relaunch += " \"$target\" --args --after-update window=\(i.window ? 1 : 0)"
    if i.window, let p = i.path { relaunch += " " + q("path=" + p) }
    return """
      #!/bin/sh
      # Written by AgentOS.app to swap in its update once it has quit. Runs once.
      pid=\(i.pid)
      exe=\(q(i.executable))
      target=\(q(i.target))
      staged=\(q(i.staged))
      next=\(q(i.paths.next))
      prev=\(q(i.paths.prev))
      log=\(q(i.paths.log))
      from=\(q(i.fromHash))
      to=\(q(i.toHash))
      lsregister=\(q(lsregister))
      mkdir -p "$(dirname "$log")"
      say() { printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$log"; }
      fail() { say "failed from $from to $to: $1"; \(relaunch); exit 1; }
      # The app that wrote this, and only it: wait for it to quit (60 s at most)
      comm=$(ps -o comm= -p "$pid" 2>/dev/null)
      if [ -n "$comm" ] && [ "$comm" != "$exe" ]; then say "failed from $from to $to: not our app"; exit 1; fi
      i=0
      while kill -0 "$pid" 2>/dev/null; do
        i=$((i + 1))
        [ "$i" -gt 600 ] && { say "failed from $from to $to: the app didn't quit"; exit 1; }
        sleep 0.1
      done
      \(i.installing ? installingStop : "")
      rm -rf "$prev"
      had=0
      if [ -e "$target" ]; then
        had=1
        mv "$target" "$prev" 2>/dev/null || { /usr/bin/ditto "$target" "$prev" && rm -rf "$target"; } || fail "couldn't move the old app aside"
      fi
      if mv "$staged" "$target" 2>/dev/null || /usr/bin/ditto "$staged" "$target"; then
        :
      else
        rm -rf "$target"
        if [ "$had" = 1 ]; then mv "$prev" "$target" 2>/dev/null || /usr/bin/ditto "$prev" "$target"; fi
        fail "couldn't put the new app in place"
      fi
      [ -e "$prev" ] && "$lsregister" -u "$prev" >/dev/null 2>&1
      "$lsregister" -f "$target" >/dev/null 2>&1
      rm -rf "$next"
      say "ok from $from to $to"
      \(relaunch)
      rm -f "$0"

      """
  }

  /// Installing from the staged copy: an older app (one without this
  /// updater) may still run from the target. It is asked to quit first.
  static let installingStop = """
    for p in $(pgrep -x AgentOS); do
        [ "$(ps -o comm= -p "$p" 2>/dev/null)" = "$target/Contents/MacOS/AgentOS" ] && kill "$p" 2>/dev/null
      done
      i=0
      while [ "$i" -lt 50 ]; do
        still=0
        for p in $(pgrep -x AgentOS); do
          [ "$(ps -o comm= -p "$p" 2>/dev/null)" = "$target/Contents/MacOS/AgentOS" ] && still=1
        done
        [ "$still" = 0 ] && break
        sleep 0.2
        i=$((i + 1))
      done
    """
}
