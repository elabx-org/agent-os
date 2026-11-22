import Foundation

/// Where the window goes
enum Destination: Equatable {
  case home
  case session(String)
}

enum SessionLink {
  /// A session id as AgentOS makes them, and nothing that could break out of
  /// a URL or a script argument
  static func isValidId(_ id: String) -> Bool {
    guard (1...64).contains(id.utf8.count) else { return false }
    return id.utf8.allSatisfy { byte in
      (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
        || byte == 0x5F || byte == 0x2D
    }
  }

  /// http://127.0.0.1:<port>/?session=<id>
  static func url(port: Int, id: String) -> URL {
    var parts = URLComponents()
    parts.scheme = "http"
    parts.host = "127.0.0.1"
    parts.port = port
    parts.path = "/"
    parts.queryItems = [URLQueryItem(name: "session", value: id)]
    return parts.url!
  }

  static func home(port: Int, path: String = "/") -> URL {
    URL(string: "http://127.0.0.1:\(port)\(path.hasPrefix("/") ? path : "/")")
      ?? URL(string: "http://127.0.0.1:\(port)/")!
  }

  /// The page is our home page and done loading, so it can take an open
  /// event instead of a reload
  static func canDispatchInPlace(currentURL: URL?, port: Int, isLoading: Bool) -> Bool {
    guard let url = currentURL, !isLoading, LinkPolicy(port: port).isOurs(url) else { return false }
    return url.path.isEmpty || url.path == "/"
  }
}
