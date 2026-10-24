import SwiftUI

/// Where the fold crosses the web view while the iPhone Duo is half open,
/// in the view's points (the page's CSS pixels). Horizontal is the laptop
/// and tabletop pose; vertical is the book.
struct Fold: Equatable {
    enum Axis: String { case horizontal, vertical }

    let axis: Axis
    let start: Double
    let end: Double

    /// The active `.division` region (only present while half open)
    init?(_ proxy: GeometryProxy) {
        guard #available(iOS 27.1, *) else { return nil }
        guard let frame = proxy.reservedRegions(kind: .division)
                .map(\.frame)
                .first(where: { $0.width > 0 || $0.height > 0 }) else { return nil }
        if frame.width >= frame.height {
            axis = .horizontal
            start = frame.minY
            end = frame.maxY
        } else {
            axis = .vertical
            start = frame.minX
            end = frame.maxX
        }
    }

    var json: [String: Any] {
        ["axis": axis.rawValue, "start": start, "end": end]
    }
}
