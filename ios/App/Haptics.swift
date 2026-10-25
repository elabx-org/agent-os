import UIKit

/// Taps the page asks for: `{type: "haptic", style}`
@MainActor
enum Haptics {
    private static let selection = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()

    static func play(_ style: String) {
        switch style {
        case "selection": selection.selectionChanged()
        case "success": notification.notificationOccurred(.success)
        case "warning": notification.notificationOccurred(.warning)
        case "error": notification.notificationOccurred(.error)
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "rigid": UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
