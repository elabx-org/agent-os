import Foundation

/// The only place the app writes replies, captures and state files:
/// ~/Library/Caches/com.agentos.mac/test (0700), each file new (0600),
/// never through a link. Nothing here ever holds a cookie or page text.
enum TestFiles {
  static var dir: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/com.agentos.mac/test")
  }

  /// A plain file name: no folders, no dot files
  static func isSafeName(_ name: String) -> Bool {
    guard (1...96).contains(name.utf8.count), !name.hasPrefix("."), !name.contains("..") else { return false }
    return name.utf8.allSatisfy { b in
      (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x2E
        || b == 0x2D || b == 0x5F
    }
  }

  /// Makes the folder (0700) and checks it is a real folder of ours
  @discardableResult
  static func ensureDir() -> Bool {
    let path = dir.path
    let parent = dir.deletingLastPathComponent().path
    try? FileManager.default.createDirectory(atPath: parent, withIntermediateDirectories: true)
    if mkdir(path, 0o700) != 0 && errno != EEXIST { return false }
    var info = stat()
    guard lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR, info.st_uid == getuid() else { return false }
    if info.st_mode & 0o777 != 0o700 { chmod(path, 0o700) }
    return true
  }

  /// Writes a new file (O_EXCL, O_NOFOLLOW, 0600). An old regular file of
  /// that name is removed first; anything else there is left and refused.
  @discardableResult
  static func write(name: String, data: Data) -> URL? {
    guard isSafeName(name), ensureDir() else { return nil }
    let url = dir.appendingPathComponent(name)
    let path = url.path
    var info = stat()
    if lstat(path, &info) == 0 {
      guard (info.st_mode & S_IFMT) == S_IFREG else { return nil }
      unlink(path)
    }
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { return nil }
    defer { close(fd) }
    let ok = data.withUnsafeBytes { raw -> Bool in
      var offset = 0
      while offset < raw.count {
        let n = Foundation.write(fd, raw.baseAddress! + offset, raw.count - offset)
        if n <= 0 { return false }
        offset += n
      }
      return true
    }
    return ok ? url : nil
  }

  /// Writes under a temporary name, then renames, so a reader never sees half
  @discardableResult
  static func publish(name: String, data: Data) -> URL? {
    guard isSafeName(name), let part = write(name: name + ".part", data: data) else { return nil }
    let url = dir.appendingPathComponent(name)
    guard rename(part.path, url.path) == 0 else {
      unlink(part.path)
      return nil
    }
    return url
  }

  static func json(_ object: Any) -> Data {
    (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
  }
}
