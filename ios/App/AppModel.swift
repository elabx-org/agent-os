import Foundation
import Observation
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
    var showingServer = false
    /// Set when sign-in failed or was cancelled; the page waits behind it
    var signInError: String?
    private var signingIn = false

    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private let nativeSignIn = NativeSignIn()

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

    func keyboard(visible: Bool) {
        send(["type": "keyboard", "visible": visible])
    }

    func reload() {
        webView?.reload()
    }

    func load(_ url: URL) {
        server = url
        webView?.load(URLRequest(url: url))
    }

    /// Signs in with the system sheet, hands the session to the page and
    /// opens `returnTo` (a path on the server)
    func signIn(returnTo: String = "/") async {
        guard !signingIn else { return }
        signingIn = true
        defer { signingIn = false }
        do {
            let cookie = try await nativeSignIn.signIn(server: server)
            await webView?.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
            signInError = nil
            let path = returnTo.hasPrefix("/") && !returnTo.hasPrefix("//") ? returnTo : "/"
            webView?.load(URLRequest(url: URL(string: path, relativeTo: server) ?? server))
        } catch {
            signInError = error.localizedDescription
        }
    }

    /// Reads the page's `state` message
    func receive(_ body: Any) {
        guard let message = body as? [String: Any], message["type"] as? String == "state" else { return }
        if let raw = message["viewMode"] as? String, let mode = PaneView(rawValue: raw) { view = mode }
        if let count = message["waiting"] as? Int { waiting = count }
    }

    private func send(_ event: [String: Any]) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('agentos-native', { detail: \(json) }))"
        )
    }
}
