import Foundation

enum LinkDecision: Equatable {
  case load, openInBrowser, openWithSystem, cancel
}

/// What the window may show. Its main frame only ever holds this Mac's own
/// AgentOS on http://127.0.0.1:<port> (never localhost, which keeps its own
/// cookies), about:blank and our own blob: URLs. Everything else goes to the
/// browser, to the system (mailto: only) or nowhere.
struct LinkPolicy {
  let port: Int

  /// Schemes handed to the system. An allowlist: add others only by name.
  static let systemSchemes: Set<String> = ["mailto"]

  func decide(
    _ url: URL, mainFrame: Bool, linkActivated: Bool, newWindow: Bool, sourceIsOurMainFrame: Bool
  ) -> LinkDecision {
    let scheme = (url.scheme ?? "").lowercased()
    switch scheme {
    case "about":
      let text = url.absoluteString.lowercased()
      guard text == "about:blank" || text == "about:srcdoc" else { return .cancel }
      return newWindow ? .cancel : .load
    case "blob":
      guard !newWindow, let inner = URL(string: String(url.absoluteString.dropFirst("blob:".count))) else {
        return .cancel
      }
      return isOurs(inner) ? .load : .cancel
    case "data":
      return !mainFrame && !newWindow ? .load : .cancel
    case "javascript", "file":
      // WebKit runs javascript: links without asking; this is a fallback
      return .cancel
    case "http", "https":
      break
    default:
      let allowed = Self.systemSchemes.contains(scheme) && linkActivated && sourceIsOurMainFrame
      return allowed ? .openWithSystem : .cancel
    }
    if newWindow { return sourceIsOurMainFrame ? .openInBrowser : .cancel }
    // Subframes: WebKit and the server's CSP sandbox apply
    if !mainFrame { return .load }
    if isOurs(url) { return .load }
    return linkActivated || sourceIsOurMainFrame ? .openInBrowser : .cancel
  }

  /// This Mac's AgentOS, outside its port proxy
  func isOurs(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "http", url.host == "127.0.0.1" else { return false }
    guard (url.port ?? 80) == port else { return false }
    return !Self.isProxyPath(Self.normalisedPath(url))
  }

  /// The server's port proxy serves other apps under /proxy/<port>/ and
  /// /absproxy/<port>/ (lib/port-proxy.ts). Those pages are not AgentOS and
  /// never load in the window.
  static func isProxyPath(_ path: String) -> Bool {
    for prefix in ["/proxy", "/absproxy"] where path.hasPrefix(prefix) {
      let rest = path.dropFirst(prefix.count)
      if rest.isEmpty || rest.hasPrefix("/") { return true }
    }
    return false
  }

  /// The path as a server might read it: percent-decoded, repeated slashes
  /// collapsed, . and .. resolved, lowercased
  static func normalisedPath(_ url: URL) -> String {
    let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
    let decoded = raw.removingPercentEncoding ?? raw
    var parts: [Substring] = []
    for part in decoded.split(separator: "/", omittingEmptySubsequences: true) {
      if part == "." { continue }
      if part == ".." {
        if !parts.isEmpty { parts.removeLast() }
        continue
      }
      parts.append(part)
    }
    var path = "/" + parts.joined(separator: "/")
    if decoded.hasSuffix("/") && !parts.isEmpty { path += "/" }
    return path.lowercased()
  }

  /// A downloaded file's name, safe to save in ~/Downloads
  static func cleanDownloadName(_ suggested: String) -> String {
    var name = String(
      suggested.unicodeScalars.filter { scalar in
        scalar != "/" && scalar != ":" && !CharacterSet.controlCharacters.contains(scalar)
      }.map(Character.init))
    while name.hasPrefix(".") { name.removeFirst() }
    name = name.trimmingCharacters(in: .whitespaces)
    if name.count > 120 { name = String(name.prefix(120)) }
    return name.isEmpty ? "download" : name
  }

  /// "a.txt", then "a 2.txt", "a 3.txt" … until `taken` says no
  static func uniqueName(_ name: String, taken: (String) -> Bool) -> String {
    guard taken(name) else { return name }
    let ext = (name as NSString).pathExtension
    let stem = ext.isEmpty ? name : (name as NSString).deletingPathExtension
    var n = 2
    while true {
      let candidate = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
      if !taken(candidate) { return candidate }
      n += 1
    }
  }
}
