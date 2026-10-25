import Foundation
import Observation
import SwiftUI
import WebKit

/// The web app's views that the system bar switches between
enum PaneView: String {
    case chat, terminal, git, files, workers
}

/// What the bar shows, mirrored from the page, and the way back to it.
@Observable
@MainActor
final class AppModel {
    static let defaultServer = URL(string: "https://agent.elabx.app")!
    private static let serverKey = "serverURL"

    var server: URL {
        didSet { UserDefaults.standard.set(server.absoluteString, forKey: Self.serverKey) }
    }
    /// The focused pane's view, reported by the page
    var view: PaneView = .terminal
    /// Sessions waiting on an answer (the Inbox badge)
    var waiting = 0
    /// Changed files in the focused session (the Changes badge)
    var changes = 0
    var showingServer = false
    /// The page's background colour, for the edges it doesn't cover
    var pageBackground: Color?
    var fold: Fold? {
        didSet { if fold != oldValue { sendFold() } }
    }

    @ObservationIgnored weak var webView: WKWebView?
    /// A session to open once the page has loaded (a notification or link launched the app)
    @ObservationIgnored private var pendingSession: String?
    /// The APNs device token, handed to the server from the page so it carries the login
    @ObservationIgnored private var pushToken: String?

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:))
        server = saved ?? Self.defaultServer
    }

    /// Navigation the web NavRail would do in Safari
    func nav(_ action: String) {
        send(["type": "nav", "action": action])
    }

    /// Terminal input from the keyboard bar
    func key(_ sequence: String) {
        send(["type": "key", "key": sequence])
    }

    /// Text from the system Paste button: the message box, or the terminal as a paste
    func paste(_ text: String) {
        send(["type": "paste", "text": text])
    }

    /// The keyboard bar's Add image: the page opens its picker
    func image() {
        send(["type": "image"])
    }

    func keyboard(visible: Bool) {
        send(["type": "keyboard", "visible": visible])
    }

    /// The page also keeps it on `agentosNative`, for when it loads later
    func sendFold() {
        send(["type": "posture", "fold": fold?.json ?? NSNull()], keep: "fold")
    }

    /// agentos://session/<id>, from an ntfy notification or anywhere else
    func handle(url: URL) {
        guard url.scheme == "agentos", url.host == "session",
              let id = url.pathComponents.dropFirst().first, !id.isEmpty else { return }
        openSession(id)
    }

    func openSession(_ id: String) {
        pendingSession = id
        if webView?.isLoading == false { flushPending() }
    }

    func setPushToken(_ token: Data) {
        pushToken = token.map { String(format: "%02x", $0) }.joined()
        if webView?.isLoading == false { registerPushToken() }
    }

    /// The page finished loading: deliver what waited for it
    func pageLoaded() {
        sendFold()
        flushPending()
        registerPushToken()
    }

    private func flushPending() {
        guard let id = pendingSession else { return }
        pendingSession = nil
        // Kept on agentosNative too, for a page still starting up
        send(["type": "open", "sessionId": id], keep: "open")
    }

    private func registerPushToken() {
        guard let pushToken, let webView else { return }
        webView.evaluateJavaScript("""
            fetch('/api/push/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: '\(pushToken)' }) }).catch(() => {})
            """)
    }

    func reload() {
        webView?.reload()
    }

    func load(_ url: URL) {
        server = url
        webView?.load(URLRequest(url: url))
    }

    /// Reads the page's `state` message
    func receive(_ body: Any) {
        guard let message = body as? [String: Any] else { return }
        if message["type"] as? String == "keybar" {
            // Half open like a laptop, the page's key rows sit right above the keyboard
            (webView as? AgentWebView)?.keyboardBar.collapsed = message["hidden"] as? Bool ?? false
            return
        }
        if message["type"] as? String == "haptic" {
            Haptics.play(message["style"] as? String ?? "light")
            return
        }
        guard message["type"] as? String == "state" else { return }
        if let raw = message["viewMode"] as? String, let mode = PaneView(rawValue: raw) { view = mode }
        if let count = message["waiting"] as? Int { waiting = count }
        if let count = message["changes"] as? Int { changes = count }
        if let css = message["background"] as? String, let color = Self.color(css: css) {
            pageBackground = color
        }
    }

    /// "rgb(r, g, b)" or "rgba(r, g, b, a)" from getComputedStyle
    private static func color(css: String) -> Color? {
        let parts = css.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        return Color(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255)
    }

    /// `keep`: also store the event's value under that key on `window.agentosNative`
    private func send(_ event: [String: Any], keep: String? = nil) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        let store = keep.map { "if (window.agentosNative) window.agentosNative.\($0) = e.\($0);" } ?? ""
        webView.evaluateJavaScript(
            "(() => { const e = \(json); \(store) window.dispatchEvent(new CustomEvent('agentos-native', { detail: e })); })()"
        )
    }
}
