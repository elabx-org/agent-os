import ObjectiveC
import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Agent-OS in a web view that fills what the system leaves it: built with
/// the iOS 27.1 SDK it runs edge to edge on iPhone Duo, beside the system's
/// vertical bar instead of under Safari's.
struct AgentWebContainer: UIViewRepresentable {
    let model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> AgentWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        // Keep Safari's tokens so the server sees an ordinary iPhone
        config.applicationNameForUserAgent = "Mobile/15E148 AgentOSiOS/\(Bundle.main.shortVersion)"

        let controller = config.userContentController
        controller.addUserScript(WKUserScript(
            source: Self.bootScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        controller.add(WeakMessageHandler(context.coordinator), name: "agentos")

        let view = AgentWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = UIColor(named: "LaunchBackground")
        view.scrollView.backgroundColor = view.backgroundColor
        // The page lays itself out to the viewport and scrolls inside;
        // the outer scroll view only fights the keyboard
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.delegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        view.isInspectable = true
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.keyboardBar.onKey = { [weak model] key in model?.key(key) }
        view.keyboardBar.onPaste = { [weak model] text in model?.paste(text) }
        view.keyboardBar.onDismiss = { [weak view] in
            view?.evaluateJavaScript("document.activeElement && document.activeElement.blur()")
            view?.endEditing(true)
        }
        view.keyboardBar.onImage = { [weak model] in model?.image() }
        view.keyboardBar.onVisibilityChange = { [weak model] visible in model?.keyboard(visible: visible) }

        model.webView = view
        view.load(URLRequest(url: model.server))
        return view
    }

    func updateUIView(_ view: AgentWebView, context: Context) {}

    /// Runs before the page: tells it it's inside the app (lib/native-bridge.ts)
    private static var bootScript: String {
        """
        window.agentosNative = { platform: 'ios', version: '\(Bundle.main.shortVersion)' };
        document.documentElement.dataset.native = 'ios';
        """
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
        let model: AppModel

        init(model: AppModel) { self.model = model }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            MainActor.assumeIsolated { model.receive(message.body) }
        }

        // The page never scrolls as a whole; undo WebKit nudging it for the keyboard
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero }
        }

        // Links that open a new window show in a Safari sheet over the app;
        // mail, phone and other apps' links go to their apps
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            MainActor.assumeIsolated {
                if Self.isWeb(url) { showInSafari(url, from: webView) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        // A tapped link to another site opens in the sheet rather than
        // replacing Agent-OS; the page's own links and redirects (sign-in)
        // stay in the app
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url,
                  navigationAction.targetFrame?.isMainFrame == true else { return decisionHandler(.allow) }
            if !Self.isWeb(url) && !Self.staysInPage(url) {
                decisionHandler(.cancel)
                MainActor.assumeIsolated { UIApplication.shared.open(url) }
                return
            }
            if navigationAction.navigationType == .linkActivated, Self.isWeb(url),
               let host = url.host(), host != webView.url?.host() {
                decisionHandler(.cancel)
                MainActor.assumeIsolated { showInSafari(url, from: webView) }
                return
            }
            decisionHandler(.allow)
        }

        /// What SFSafariViewController can show
        private static func isWeb(_ url: URL) -> Bool {
            ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        }

        /// Schemes WebKit loads itself (blank frames, inline data, downloads)
        private static func staysInPage(_ url: URL) -> Bool {
            ["about", "data", "blob", "javascript", "file"].contains(url.scheme?.lowercased() ?? "")
        }

        /// Done, Share and Open in Safari come with it; sign-ins made in it
        /// last between links. A page sheet: UIKit can't place a sheet on
        /// one page of the open iPhone Duo.
        @MainActor
        private func showInSafari(_ url: URL, from webView: WKWebView) {
            let config = SFSafariViewController.Configuration()
            config.barCollapsingEnabled = true
            let safari = SFSafariViewController(url: url, configuration: config)
            safari.dismissButtonStyle = .done
            safari.preferredControlTintColor = model.accent
            safari.modalPresentationStyle = .pageSheet
            present(safari, from: webView) {}
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType
        ) async -> WKPermissionDecision {
            origin.host == webView.url?.host ? .grant : .prompt
        }

        // WebKit answers alert(), confirm() and prompt() itself (no, empty)
        // unless the app shows them, so the page's "Delete this?" did nothing
        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            MainActor.assumeIsolated {
                let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
                present(alert, from: webView, orElse: completionHandler)
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            MainActor.assumeIsolated {
                let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
                // Name the button by what it does when the page asks to delete
                let verb = ["Delete", "Kill", "Remove"].first { message.hasPrefix($0) }
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
                alert.addAction(UIAlertAction(title: verb ?? "OK", style: verb == nil ? .default : .destructive) { _ in
                    completionHandler(true)
                })
                present(alert, from: webView) { completionHandler(false) }
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            MainActor.assumeIsolated {
                let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
                alert.addTextField { $0.text = defaultText }
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
                alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
                    completionHandler(alert?.textFields?.first?.text ?? "")
                })
                present(alert, from: webView) { completionHandler(nil) }
            }
        }

        @MainActor
        private func present(_ controller: UIViewController, from webView: WKWebView, orElse fail: () -> Void) {
            var top = webView.window?.rootViewController
            while let next = top?.presentedViewController { top = next }
            guard let top else { return fail() }
            top.present(controller, animated: true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            MainActor.assumeIsolated { model.pageLoaded() }
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// A web view whose keyboard carries the terminal keys. WebKit's text input
/// lives in a private content view, so that view's class gets a subclass
/// answering `inputAccessoryView` with `keyboardBar`. An accessory stays
/// attached to the keyboard when it's split, floating or undocked.
final class AgentWebView: WKWebView {
    let keyboardBar = KeyboardBar()

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        installKeyboardBar()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func installKeyboardBar() {
        guard let content = scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).hasPrefix("WKContent")
        }) else { return }
        let base: AnyClass = type(of: content)
        let name = "AgentOS_\(NSStringFromClass(base))"
        if let existing = NSClassFromString(name) {
            object_setClass(content, existing)
            return
        }
        guard let subclass = objc_allocateClassPair(base, name, 0) else { return }
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        let accessory: @convention(block) (AnyObject) -> UIView? = { this in
            var view = this as? UIView
            while let current = view {
                if let web = current as? AgentWebView { return web.keyboardBar }
                view = current.superview
            }
            return nil
        }
        if let method = class_getInstanceMethod(UIResponder.self, selector) {
            class_addMethod(subclass, selector, imp_implementationWithBlock(accessory), method_getTypeEncoding(method))
        }
        objc_registerClassPair(subclass)
        object_setClass(content, subclass)
    }
}

extension Bundle {
    var shortVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }
}
