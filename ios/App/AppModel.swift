import Foundation
import Observation
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import UserNotifications
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
    /// Sessions and background agents waiting on you (the Needs you badge),
    /// also on the app icon
    var waiting = 0 {
        didSet {
            guard waiting != oldValue else { return }
            UNUserNotificationCenter.current().setBadgeCount(waiting) { _ in }
        }
    }
    /// Changed files in the focused session (the Changes badge)
    var changes = 0
    var showingServer = false
    /// The web Settings page is showing (the gear fills)
    var settingsOpen = false
    /// The workspace page over the panes ("new", "project", "inbox"…), if any
    var page: String?
    var newOpen: Bool { page == "new" }
    /// Focus mode: the page hides its strip and the column its badges
    var focus = false
    /// Focus is on and something needs you: the amber dot on Focus
    var focusDot = false
    /// Face ID / Touch ID in front of the app (off unless turned on)
    let lock = AppLock()
    /// The page's background colour, for the edges it doesn't cover
    var pageBackground: Color?
    /// The theme's accent, for the app's own confirm buttons and the Safari sheet
    var accent: UIColor?
    var accentColor: Color? { accent.map(Color.init(uiColor:)) }
    /// The app theme's light or dark, which the column, sheets and keyboard follow
    var scheme: ColorScheme? {
        didSet { if scheme != oldValue { applyScheme() } }
    }
    var fold: Fold? {
        didSet { if fold != oldValue { sendFold() } }
    }

    @ObservationIgnored weak var webView: WKWebView?
    /// Links to other sites, in Safari sheets that minimise to pills
    let browser = Browser()
    /// A session to open once the page has loaded (a notification or link launched the app)
    @ObservationIgnored private var pendingSession: String?
    /// A column action to run once the page is listening (a tapped agent notification)
    @ObservationIgnored private var pendingNav: String?
    /// The page has reported its state, so its nav listener is up
    @ObservationIgnored private var pageReady = false
    /// A shared file to hand to the page once it has loaded
    @ObservationIgnored private var pendingFile: [String: String]?
    /// The APNs device token, handed to the server from the page so it carries the login
    @ObservationIgnored private var pushToken: String?

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:))
        server = saved ?? Self.defaultServer
        browser.accent = { [weak self] in self?.accent }
        browser.onChange = { [weak self] closed in self?.sendBrowser(closed: closed) }
    }

    /// The minimised pages for the page's pills, and one just closed (Undo)
    private func sendBrowser(closed: Browser.Page? = nil) {
        var event: [String: Any] = ["type": "browser", "count": browser.pages.count]
        if let closed { event["closed"] = browser.json(closed) }
        send(event)
    }

    /// Navigation the web NavRail would do in Safari
    func nav(_ action: String) {
        send(["type": "nav", "action": action])
    }

    /// New, or with New open, back to the session under it: picking the
    /// view already showing leaves the page without changing the view
    func toggleNew() {
        guard newOpen else { return nav("new") }
        switch view {
        case .chat: nav("chat")
        case .git: nav("git")
        case .files: nav("files")
        case .terminal, .workers: nav("terminal")
        }
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

    /// The keyboard bar's Copy: the page selects text on the screen
    func select() {
        send(["type": "select"])
    }

    /// The keyboard bar's File: the page opens its snippets sheet
    func snippets() {
        send(["type": "snippets"])
    }

    func keyboard(visible: Bool) {
        send(["type": "keyboard", "visible": visible])
    }

    /// The page also keeps it on `agentosNative`, for when it loads later
    func sendFold() {
        send(["type": "posture", "fold": fold?.json ?? NSNull()], keep: "fold")
    }

    /// agentos://session/<id>, from an ntfy notification or anywhere else,
    /// or a file shared to the app
    func handle(url: URL) {
        if url.isFileURL {
            share(file: url)
            return
        }
        if url.scheme == "agentos", url.host == "inbox" {
            openNav("inbox")
            return
        }
        guard url.scheme == "agentos", url.host == "session",
              let id = url.pathComponents.dropFirst().first, !id.isEmpty else { return }
        openSession(id)
    }

    /// A nav action that may arrive before the page has started (cold launch)
    func openNav(_ action: String) {
        pendingNav = action
        if pageReady { flushNav() }
    }

    private func flushNav() {
        guard let action = pendingNav else { return }
        pendingNav = nil
        nav(action)
    }

    /// A new document: its listeners aren't up until it reports its state
    func pageStarted() {
        pageReady = false
    }

    func openSession(_ id: String) {
        pendingSession = id
        if webView?.isLoading == false { flushPending() }
    }

    /// The page uploads it into the focused session, as with a picked image
    func share(file url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
            // Copies land in the app's Inbox; they're uploaded now
            if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) }
        }
        guard let data = try? Data(contentsOf: url), data.count <= Self.maxShare else {
            Haptics.play("error")
            return
        }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
        pendingFile = [
            "name": url.lastPathComponent,
            "mimeType": type ?? "application/octet-stream",
            "base64": data.base64EncodedString(),
        ]
        if webView?.isLoading == false { flushPending() }
    }

    /// Bigger files are better copied to the server another way
    private static let maxShare = 25 * 1024 * 1024

    func setPushToken(_ token: Data) {
        pushToken = token.map { String(format: "%02x", $0) }.joined()
        if webView?.isLoading == false { registerPushToken() }
    }

    /// The page finished loading: deliver what waited for it
    func pageLoaded() {
        applyScheme()
        sendFold()
        flushPending()
        registerPushToken()
    }

    private func flushPending() {
        if let id = pendingSession {
            pendingSession = nil
            // Kept on agentosNative too, for a page still starting up
            send(["type": "open", "sessionId": id], keep: "open")
        }
        if let file = pendingFile {
            pendingFile = nil
            send(["type": "file", "file": file], keep: "file")
        }
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
            let hidden = message["hidden"] as? Bool ?? false
            if let web = webView as? AgentWebView, web.keyboardBar.collapsed != hidden {
                web.keyboardBar.collapsed = hidden
                web.reloadKeyboardBar()
            }
            return
        }
        if message["type"] as? String == "keys" {
            // The terminal or chat box took focus: the bar shows that context's keys
            if let context = message["context"] as? String {
                // The user's key order for it, when the page sends one
                let ids = (message["ids"] as? [Any])?.compactMap { $0 as? String }
                (webView as? AgentWebView)?.keyboardBar.setKeys(context: context, ids: ids)
            }
            return
        }
        if message["type"] as? String == "browser" {
            // The Undo on the page's "Closed …" toast
            if message["action"] as? String == "undo" { browser.undo() }
            return
        }
        if message["type"] as? String == "haptic" {
            Haptics.play(message["style"] as? String ?? "light")
            return
        }
        if message["type"] as? String == "server" {
            // Settings → Server: the app's own server and lock screen
            showingServer = true
            return
        }
        guard message["type"] as? String == "state" else { return }
        pageReady = true
        flushNav()
        if let raw = message["viewMode"] as? String, let mode = PaneView(rawValue: raw) { view = mode }
        if let count = message["waiting"] as? Int { waiting = count }
        if let count = message["changes"] as? Int { changes = count }
        settingsOpen = message["settings"] as? Bool ?? false
        page = message["page"] as? String
        focus = message["focus"] as? Bool ?? false
        focusDot = message["focusDot"] as? Bool ?? false
        if let css = message["background"] as? String, let color = Self.color(css: css) {
            pageBackground = Color(uiColor: color)
        }
        if let css = message["accent"] as? String, let color = Self.color(css: css) {
            accent = color
        }
        switch message["scheme"] as? String {
        case "light": scheme = .light
        case "dark": scheme = .dark
        default: break
        }
    }

    /// UIKit's part (alerts, the keyboard and its bar) follows the window
    private func applyScheme() {
        let style: UIUserInterfaceStyle = scheme == .light ? .light : scheme == .dark ? .dark : .unspecified
        webView?.window?.overrideUserInterfaceStyle = style
    }

    /// "rgb(r, g, b)" or "rgba(r, g, b, a)" from getComputedStyle
    private static func color(css: String) -> UIColor? {
        let parts = css.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
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
