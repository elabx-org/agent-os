import AppKit

/// The menu bar robot head, drawn per state. Coordinates are in the 24-unit
/// grid of public/icon.svg, top-left origin, scaled to 18×18 points.
@MainActor
enum IconRenderer {
  static let size = NSSize(width: 18, height: 18)

  /// The status item's image. A template (macOS tints it) except while a
  /// session needs you, when the head is drawn in the label colour of the
  /// appearance it is drawn in, plus an orange dot.
  static func image(for state: IconState, linkDown: Bool, appearance: NSAppearance? = nil) -> NSImage {
    let needs: Bool
    if case .needsYou = state { needs = true } else { needs = false }
    let image = NSImage(size: size, flipped: true) { _ in
      draw(state, linkDown: linkDown, ink: needs ? NSColor.labelColor : NSColor.black)
      return true
    }
    image.isTemplate = !needs
    image.accessibilityDescription = Strings.appName
    return image
  }

  /// A PNG at 2x of how the icon looks in `appearance`; `highlight` draws it
  /// on the selected-menu background, as when its menu is open
  static func png(for state: IconState, linkDown: Bool, appearance: NSAppearance, highlight: Bool = false) -> Data {
    let px = Int(size.width * 2)
    guard
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return Data() }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return Data() }
    NSGraphicsContext.current = ctx
    appearance.performAsCurrentDrawingAppearance {
      // Flip to the top-left grid
      let flip = NSAffineTransform()
      flip.translateX(by: 0, yBy: size.height)
      flip.scaleX(by: 1, yBy: -1)
      flip.concat()
      if highlight {
        NSColor.selectedContentBackgroundColor.setFill()
        NSRect(origin: .zero, size: size).fill()
      } else {
        (appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
          ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.93, alpha: 1)).setFill()
        NSRect(origin: .zero, size: size).fill()
      }
      draw(state, linkDown: linkDown, ink: highlight ? .white : .labelColor)
    }
    ctx.flushGraphics()
    return rep.representation(using: .png, properties: [:]) ?? Data()
  }

  /// Draws into the current context, in a flipped 18×18 space
  nonisolated private static func draw(_ state: IconState, linkDown: Bool, ink: NSColor) {
    let k: CGFloat = 18.0 / 24.0
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * k, y: y * k) }
    func line(_ a: NSPoint, _ b: NSPoint, width: CGFloat = 2) {
      let path = NSBezierPath()
      path.move(to: a)
      path.line(to: b)
      path.lineWidth = width * k
      path.lineCapStyle = .round
      path.stroke()
    }
    func dot(_ c: NSPoint, _ r: CGFloat, fill: Bool) {
      let path = NSBezierPath(ovalIn: NSRect(x: c.x - r * k, y: c.y - r * k, width: 2 * r * k, height: 2 * r * k))
      if fill {
        path.fill()
      } else {
        path.lineWidth = 1.6 * k
        path.stroke()
      }
    }

    let dim: Bool
    switch state {
    case .starting, .updating, .notAnswering, .notInstalled, .off: dim = true
    default: dim = false
    }
    let color = dim ? ink.withAlphaComponent(0.45) : ink
    color.setStroke()
    color.setFill()

    // Head
    let head = NSBezierPath(
      roundedRect: NSRect(x: 5 * k, y: 8 * k, width: 14 * k, height: 11 * k), xRadius: 3 * k, yRadius: 3 * k)
    head.lineWidth = 2 * k
    head.stroke()

    // Antenna
    var working = false
    if case .working = state { working = true }
    line(p(12, 8), p(12, 5.2))
    dot(p(12, 3.6), 1.6, fill: working)

    // Eyes
    switch state {
    case .working:
      dot(p(9.5, 13.5), 1.5, fill: true)
      dot(p(14.5, 13.5), 1.5, fill: true)
    case .off:
      line(p(8.5, 15.6), p(10.5, 15.6))
      line(p(13.5, 15.6), p(15.5, 15.6))
    default:
      line(p(9.5, 12.5), p(9.5, 14.5))
      line(p(14.5, 12.5), p(14.5, 14.5))
    }

    switch state {
    case .notAnswering, .notInstalled:
      line(p(3, 21.5), p(21, 2.5))
    case .needsYou:
      NSColor.systemOrange.setFill()
      // 4 pt across, top right
      let r: CGFloat = 2 / k
      dot(p(21.3, 3.3), r, fill: true)
    case .idle, .working:
      if linkDown { line(p(9.2, 6.8), p(14.8, 1.6), width: 1.6) }
    default:
      break
    }
  }
}
