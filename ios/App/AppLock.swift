import LocalAuthentication
import Observation
import SwiftUI

/// Face ID / Touch ID in front of the app, if turned on in Server settings:
/// asked on launch and after a minute away, with the device passcode as the
/// fallback. While the app is in the background its page is covered, so the
/// app switcher doesn't show a session.
@Observable
@MainActor
final class AppLock {
    private static let enabledKey = "lockEnabled"
    /// Away this long and the app locks again
    private static let grace: TimeInterval = 60

    var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: Self.enabledKey) }
    }
    private(set) var locked: Bool
    /// The app isn't in front (app switcher, Control Centre): hide the page
    private(set) var covered = false
    private var leftAt: Date?
    private var asking = false

    init() {
        enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        locked = UserDefaults.standard.bool(forKey: Self.enabledKey)
    }

    /// "Face ID", "Touch ID" or "Passcode", for the setting's label
    var method: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Passcode"
        }
    }

    var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func phaseChanged(to phase: ScenePhase) {
        guard enabled else {
            covered = false
            return
        }
        switch phase {
        case .background:
            covered = true
            if leftAt == nil { leftAt = .now }
        case .inactive:
            covered = true
        case .active:
            if let leftAt, Date.now.timeIntervalSince(leftAt) >= Self.grace { locked = true }
            leftAt = nil
            covered = false
            if locked { Task { await unlock() } }
        @unknown default:
            break
        }
    }

    func unlock() async {
        guard locked, !asking else { return }
        asking = true
        defer { asking = false }
        if await authenticate(reason: "Unlock Agent-OS") {
            locked = false
            Haptics.play("success")
        }
    }

    /// Turning the lock on asks first, so it can't lock you out
    func setEnabled(_ on: Bool) async {
        if on, !(await authenticate(reason: "Turn on the lock for Agent-OS")) { return }
        enabled = on
        locked = false
    }

    private func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

/// Over the page while locked, or while the app is in the background
struct LockCover: View {
    let lock: AppLock

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThickMaterial)
            if lock.locked {
                VStack(spacing: 20) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text("Agent-OS is locked")
                        .font(.title3.weight(.semibold))
                    Button {
                        Task { await lock.unlock() }
                    } label: {
                        Label("Unlock with \(lock.method)", systemImage: lock.method == "Face ID" ? "faceid" : "touchid")
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
        }
        .ignoresSafeArea()
    }
}
