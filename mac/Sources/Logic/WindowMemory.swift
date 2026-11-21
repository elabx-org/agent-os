import Foundation

/// The page the window was on when it closed, so it opens there again.
/// Never a session: those open from the menu or a notification.
enum WindowMemory {
  static let key = "lastPath"
  static let maxLength = 256
  static let keptQueryKeys: Set<String> = ["view", "project"]

  static func sanitize(path: String) -> String? {
    guard path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
    guard var parts = URLComponents(string: path), parts.scheme == nil, parts.host == nil else { return nil }
    parts.fragment = nil
    let kept = (parts.queryItems ?? []).filter { keptQueryKeys.contains($0.name) }
    parts.queryItems = kept.isEmpty ? nil : kept
    guard let result = parts.string, result.hasPrefix("/"), !result.hasPrefix("//") else { return nil }
    // The port proxy's pages never load in the window, so never reopen one
    if let url = URL(string: "http://127.0.0.1" + result), LinkPolicy.isProxyPath(LinkPolicy.normalisedPath(url)) {
      return nil
    }
    if result.count <= maxLength { return result }
    let bare = parts.percentEncodedPath
    return bare.count <= maxLength ? bare : "/"
  }

  static func save(path: String?, defaults: UserDefaults = .standard) {
    if let path, let clean = sanitize(path: path) {
      defaults.set(clean, forKey: key)
    } else {
      defaults.removeObject(forKey: key)
    }
  }

  static func restorePath(defaults: UserDefaults = .standard) -> String? {
    guard let saved = defaults.string(forKey: key) else { return nil }
    return sanitize(path: saved)
  }
}
