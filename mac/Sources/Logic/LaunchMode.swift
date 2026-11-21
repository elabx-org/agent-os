import Foundation

/// How the binary was started: a flag run (Foundation only), the self-test,
/// or the app itself.
enum LaunchMode: Equatable {
  case version
  case command(String, [String])
  case selfTest([String])
  case app(AppOptions)

  static func parse(_ argv: [String]) -> LaunchMode {
    // Launch Services adds -psn_… on old systems
    let args = argv.dropFirst().filter { !$0.hasPrefix("-psn_") }
    guard let first = args.first else { return .app(AppOptions()) }
    let rest = Array(args.dropFirst())
    switch first {
    case "--version": return .version
    case "--command": return .command(rest.first ?? "", Array(rest.dropFirst()))
    case "--self-test": return .selfTest(rest)
    default: break
    }
    var opts = AppOptions()
    var i = args.startIndex
    while i < args.endIndex {
      let arg = args[i]
      switch arg {
      case "--at-login": opts.atLogin = true
      case "--apply-update": opts.applyUpdate = true
      case "--open-session":
        let next = args.index(after: i)
        if next < args.endIndex, !args[next].hasPrefix("--") {
          opts.openSession = args[next]
          i = next
        }
      case "--after-update":
        opts.afterUpdate = true
        var next = args.index(after: i)
        while next < args.endIndex, !args[next].hasPrefix("--") {
          let word = args[next]
          if word == "window=1" { opts.restoreWindow = true }
          else if word == "window=0" { opts.restoreWindow = false }
          else if word.hasPrefix("path=") { opts.restorePath = String(word.dropFirst(5)) }
          i = next
          next = args.index(after: next)
        }
      default: break  // unknown arguments are ignored
      }
      i = args.index(after: i)
    }
    return .app(opts)
  }
}

extension LaunchMode {
  /// The `args` of a command-channel message: absent means none; otherwise
  /// it must be a list of strings only (nil: refuse the message)
  static func channelArguments(_ raw: Any?) -> [String]? {
    guard let raw else { return [] }
    guard let list = raw as? [Any] else { return nil }
    var out: [String] = []
    for item in list {
      guard let text = item as? String else { return nil }
      out.append(text)
    }
    return out
  }
}

struct AppOptions: Equatable {
  var atLogin = false
  var afterUpdate = false
  var restoreWindow = false
  var restorePath: String? = nil
  var openSession: String? = nil
  var applyUpdate = false
}
