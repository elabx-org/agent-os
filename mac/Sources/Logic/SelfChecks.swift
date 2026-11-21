import Foundation

/// The LinkPolicy and SessionLink cases, shared by Tests/main.swift and the
/// app's --self-test (its `pure` check), so both run the same table.
enum SelfChecks {
  struct Outcome {
    let name: String
    let ok: Bool
    let detail: String
  }

  static func linkPolicy(port: Int) -> [Outcome] {
    let p = LinkPolicy(port: port)
    let ours = "http://127.0.0.1:\(port)"
    // (name, url, mainFrame, linkActivated, newWindow, sourceIsOurMainFrame, expected)
    let cases: [(String, String, Bool, Bool, Bool, Bool, LinkDecision)] = [
      ("our root", "\(ours)/", true, false, false, true, .load),
      ("our session link", "\(ours)/?session=x", true, true, false, true, .load),
      ("our proxy", "\(ours)/proxy/5173/", true, true, false, true, .openInBrowser),
      ("/proxy", "\(ours)/proxy", true, true, false, true, .openInBrowser),
      ("//proxy/", "\(ours)//proxy/", true, true, false, true, .openInBrowser),
      ("/%70roxy/", "\(ours)/%70roxy/", true, true, false, true, .openInBrowser),
      ("/PROXY/", "\(ours)/PROXY/", true, true, false, true, .openInBrowser),
      ("/a/../proxy/", "\(ours)/a/../proxy/", true, true, false, true, .openInBrowser),
      ("/absproxy/1/", "\(ours)/absproxy/1/", true, true, false, true, .openInBrowser),
      ("/proxyfoo", "\(ours)/proxyfoo", true, true, false, true, .load),
      ("other port", "http://127.0.0.1:\(port + 1)/", true, true, false, true, .openInBrowser),
      ("localhost", "http://localhost:\(port)/", true, true, false, true, .openInBrowser),
      ("https link", "https://github.com/x", true, true, false, true, .openInBrowser),
      ("foreign redirect", "https://evil.example/", true, false, false, false, .cancel),
      ("mailto from our frame", "mailto:a@b.c", true, true, false, true, .openWithSystem),
      ("mailto from a subframe", "mailto:a@b.c", true, true, false, false, .cancel),
      ("vscode link", "vscode://x", true, true, false, true, .cancel),
      ("system settings", "x-apple.systempreferences:com.apple.preference", true, true, false, true, .cancel),
      ("file", "file:///etc/passwd", true, true, false, true, .cancel),
      ("data main frame", "data:text/html,hi", true, false, false, true, .cancel),
      ("data subframe", "data:text/html,hi", false, false, false, true, .load),
      ("our blob", "blob:\(ours)/0b1c2d3e", true, false, false, true, .load),
      ("foreign blob", "blob:https://evil/0b1c2d3e", true, false, false, true, .cancel),
      ("about:blank new window", "about:blank", true, true, true, true, .cancel),
      ("about:blank frame", "about:blank", false, false, false, true, .load),
      ("javascript", "javascript:alert(1)", true, true, false, true, .cancel),
      ("foreign subframe", "https://youtube.example/embed", false, false, false, true, .load),
      ("new window from our frame", "https://example.com/", true, true, true, true, .openInBrowser),
      ("new window from a subframe", "https://example.com/", true, true, true, false, .cancel),
    ]
    return cases.map { c in
      guard let url = URL(string: c.1) else { return Outcome(name: "link " + c.0, ok: false, detail: "bad URL") }
      let got = p.decide(url, mainFrame: c.2, linkActivated: c.3, newWindow: c.4, sourceIsOurMainFrame: c.5)
      return Outcome(name: "link " + c.0, ok: got == c.6, detail: "expected \(c.6), got \(got)")
    }
  }

  static func sessionLink(port: Int) -> [Outcome] {
    var out: [Outcome] = []
    func check(_ name: String, _ ok: Bool, _ detail: String = "") {
      out.append(Outcome(name: "session " + name, ok: ok, detail: detail))
    }
    check("uuid accepted", SessionLink.isValidId("7362ae9a-075a-49e9-a96c-c4a358e5f3bd"))
    for bad in ["../x", "", String(repeating: "a", count: 65), "a\"b", "a b", "a/b", "é"] {
      check("rejects \(bad.count > 10 ? "65 characters" : "'\(bad)'")", !SessionLink.isValidId(bad))
    }
    check("64 characters accepted", SessionLink.isValidId(String(repeating: "a", count: 64)))
    let url = SessionLink.url(port: port, id: "abc-1").absoluteString
    check("url", url == "http://127.0.0.1:\(port)/?session=abc-1", url)
    let root = URL(string: "http://127.0.0.1:\(port)/")
    check("in place at /", SessionLink.canDispatchInPlace(currentURL: root, port: port, isLoading: false))
    check(
      "not in place at /x",
      !SessionLink.canDispatchInPlace(currentURL: URL(string: "http://127.0.0.1:\(port)/x"), port: port, isLoading: false))
    check("not in place while loading", !SessionLink.canDispatchInPlace(currentURL: root, port: port, isLoading: true))
    check(
      "not in place on a foreign page",
      !SessionLink.canDispatchInPlace(currentURL: URL(string: "https://example.com/"), port: port, isLoading: false))
    check("not in place with no page", !SessionLink.canDispatchInPlace(currentURL: nil, port: port, isLoading: false))
    return out
  }
}
