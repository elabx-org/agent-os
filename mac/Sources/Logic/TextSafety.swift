import Foundation

/// Text from a session's screen, before the menu or a notification shows
/// it: characters that reorder or hide text are found and replaced, and long
/// lines wrap rather than run off.
enum TextSafety {
  /// Bidi overrides and isolates, zero-width and direction marks, line and
  /// paragraph separators, the byte-order mark, and C0/C1 controls other
  /// than newline and tab
  static func isUnsafe(_ u: Unicode.Scalar) -> Bool {
    switch u.value {
    case 0x0A, 0x09: return false
    case 0x00...0x1F, 0x7F...0x9F: return true
    case 0x202A...0x202E, 0x2066...0x2069, 0x200B...0x200F, 0x2028, 0x2029, 0xFEFF: return true
    // Also invisible: the Arabic letter mark (a bidi mark), word joiner and
    // invisible operators, the deprecated format controls, interlinear
    // annotation, the Mongolian vowel separator and tag characters
    case 0x061C, 0x180E, 0x2060...0x2064, 0x206A...0x206F, 0xFFF9...0xFFFB, 0xE0000...0xE007F: return true
    default: return false
    }
  }

  static func hasUnsafe(_ s: String) -> Bool { s.unicodeScalars.contains(where: isUnsafe) }

  /// Unsafe characters become U+FFFD
  static func clean(_ s: String) -> String {
    var out = String.UnicodeScalarView()
    for u in s.unicodeScalars { out.append(isUnsafe(u) ? "\u{FFFD}" : u) }
    return String(out)
  }

  /// Hard-wraps every line at `width` characters. `cut` is true when more
  /// than `maxLines` lines would be needed; `lines` then holds the first ones.
  static func wrap(_ s: String, width: Int = 70, maxLines: Int = 12) -> (lines: [String], cut: Bool) {
    var lines: [String] = []
    for raw in s.components(separatedBy: "\n") {
      let line = raw.replacingOccurrences(of: "\t", with: "  ")
      if line.isEmpty {
        lines.append("")
        continue
      }
      var rest = Substring(line)
      while !rest.isEmpty {
        if rest.count <= width {
          lines.append(String(rest))
          break
        }
        // Break at the last space inside the width when there is one
        let head = rest.prefix(width)
        if let space = head.lastIndex(of: " "), space > head.startIndex {
          lines.append(String(rest[rest.startIndex..<space]))
          rest = rest[rest.index(after: space)...]
        } else {
          lines.append(String(head))
          rest = rest.dropFirst(width)
        }
      }
    }
    while let last = lines.last, last.trimmingCharacters(in: .whitespaces).isEmpty, lines.count > 1 {
      lines.removeLast()
    }
    if lines.count > maxLines { return (Array(lines.prefix(maxLines)), true) }
    return (lines, false)
  }

  /// One line: whitespace runs become one space, cut at `max` with "…"
  static func oneLine(_ s: String, max: Int) -> String {
    let flat = s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    guard flat.count > max else { return flat }
    return String(flat.prefix(Swift.max(0, max - 1))) + "…"
  }

  /// Whether oneLine(s, max:) shows all of it
  static func fitsOneLine(_ s: String, max: Int) -> Bool {
    s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").count <= max
  }

  /// At most `max` characters, with "…" when cut
  static func cap(_ s: String, _ max: Int) -> String {
    guard s.count > max else { return s }
    return String(s.prefix(Swift.max(0, max - 1))) + "…"
  }
}
