import AppKit
import WebKit

/// The window's page: one WKWebView on http://127.0.0.1:<port>/, with the
/// offline view over it. No user scripts, no message handlers and no
/// window.agentosNative: nothing in the page can reach native code. The app
/// speaks to the page only through fixed code with the session id passed as
/// an argument.
@MainActor
final class WebPane: NSView, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  let port: Int
  let policy: LinkPolicy
  let webView: WKWebView
  let offline = OfflineView()

  /// Where links that leave the window go. A seam for the self-test.
  var opener: (URL) -> Void = { NSWorkspace.shared.open($0) }
  /// What the offline view should say when a load can't reach the server
  var offlineKind: () -> OfflineView.Kind = { .notAnswering }
  /// The offline view appeared or went (the poller polls faster meanwhile)
  var onOverlayChange: ((OfflineView.Kind?) -> Void)?
  /// The URL or title changed
  var onChange: (() -> Void)?
  /// "Turn AgentOS On" in the offline view
  var onTurnOn: (() -> Void)?

  /// The session the window was last asked to show, while it stays on /
  private(set) var showingSession: String?
  /// Loads finished, for the self-test
  private(set) var finishCount = 0
  private(set) var lastOpenerAt = Date.distantPast
  private var lastRequested: URL?
  private var terminations: [Date] = []
  private var downloads: [ObjectIdentifier: URL] = [:]
  private var observations: [NSKeyValueObservation] = []

  var overlay: OfflineView.Kind? { offline.isHidden ? nil : offline.kind }

  /// The fixed code that opens a session in place; `id` arrives as an argument.
  /// The page focuses the session's terminal a moment after it opens, so the
  /// blur repeats for 1.5 s, until the person clicks or types in the page.
  static let openScript = """
    window.dispatchEvent(new CustomEvent('agentos-native',{detail:{type:'open',sessionId:id}}));
    let touched = false;
    const mark = () => { touched = true; };
    window.addEventListener('pointerdown', mark, { capture: true, once: true });
    window.addEventListener('keydown', mark, { capture: true, once: true });
    const blur = () => {
      const a = document.activeElement;
      if (!touched && a && a.closest && a.closest('.xterm')) a.blur();
    };
    blur();
    for (let i = 0; i < 15 && !touched; i++) { await new Promise(r => setTimeout(r, 100)); blur(); }
    window.removeEventListener('pointerdown', mark, { capture: true });
    window.removeEventListener('keydown', mark, { capture: true });
    """

  init(port: Int, persistent: Bool, inspectable: Bool) {
    self.port = port
    policy = LinkPolicy(port: port)
    let config = WKWebViewConfiguration()
    config.websiteDataStore = persistent ? .default() : .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = true
    if #available(macOS 12.3, *) { config.preferences.isElementFullscreenEnabled = true }
    config.applicationNameForUserAgent = "AgentOSMac/\(AppInfo.short)"
    webView = WKWebView(frame: .zero, configuration: config)
    super.init(frame: .zero)
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = false
    if #available(macOS 13.3, *) { webView.isInspectable = inspectable }
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.translatesAutoresizingMaskIntoConstraints = false
    offline.translatesAutoresizingMaskIntoConstraints = false
    offline.isHidden = true
    addSubview(webView)
    addSubview(offline)
    for view in [webView, offline] as [NSView] {
      NSLayoutConstraint.activate([
        view.leadingAnchor.constraint(equalTo: leadingAnchor),
        view.trailingAnchor.constraint(equalTo: trailingAnchor),
        view.topAnchor.constraint(equalTo: topAnchor),
        view.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }
    offline.onButton = { [weak self] title in self?.offlineButton(title) }
    observations = [
      webView.observe(\.title, options: [.new]) { [weak self] _, _ in
        MainActor.assumeIsolated { self?.onChange?() }
      },
      webView.observe(\.url, options: [.new]) { [weak self] _, _ in
        MainActor.assumeIsolated { self?.urlChanged() }
      },
    ]
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  func isOurs(_ url: URL?) -> Bool { url.map(policy.isOurs) ?? false }

  /// The page's path and query, for WindowMemory
  var currentPath: String? {
    guard let url = webView.url, isOurs(url),
      let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return nil }
    let query = parts.percentEncodedQuery.map { "?" + $0 } ?? ""
    return (parts.percentEncodedPath.isEmpty ? "/" : parts.percentEncodedPath) + query
  }

  private func urlChanged() {
    if let url = webView.url, !(url.path.isEmpty || url.path == "/") { showingSession = nil }
    onChange?()
  }

  func forgetSession() { showingSession = nil }

  // MARK: Opening

  func load(path: String) {
    load(SessionLink.home(port: port, path: path))
  }

  func load(_ url: URL) {
    lastRequested = url
    webView.load(URLRequest(url: url))
  }

  func open(_ d: Destination) {
    switch d {
    case .home:
      if webView.url == nil { load(path: WindowMemory.restorePath() ?? "/") }
    case .session(let id):
      guard SessionLink.isValidId(id) else { return }
      showingSession = id
      if overlay == nil,
        SessionLink.canDispatchInPlace(currentURL: webView.url, port: port, isLoading: webView.isLoading)
      {
        webView.callAsyncJavaScript(
          Self.openScript, arguments: ["id": id], in: nil, in: .page, completionHandler: { _ in })
      } else {
        load(SessionLink.url(port: port, id: id))
      }
    }
  }

  func reload() {
    if let url = webView.url, isOurs(url) {
      webView.reload()
    } else {
      load(lastRequested.flatMap { isOurs($0) ? $0 : nil } ?? SessionLink.home(port: port))
    }
  }

  // MARK: Offline view

  func showOffline(_ kind: OfflineView.Kind) {
    let was = overlay
    offline.show(kind)
    if was != kind { onOverlayChange?(kind) }
  }

  func hideOffline() {
    guard overlay != nil else { return }
    offline.hide()
    onOverlayChange?(nil)
  }

  /// Each poll: when the server answers again the page comes back by itself
  func serverChanged(answering: Bool) {
    guard let kind = overlay, kind != .crashed, kind != .signIn else { return }
    if answering {
      hideOffline()
      reload()
    } else {
      let next = offlineKind()
      if next != kind { showOffline(next) }
    }
  }

  private func offlineButton(_ title: String) {
    switch title {
    case Strings.turnOnButton: onTurnOn?()
    case Strings.tryAgain, Strings.reload:
      hideOffline()
      terminations.removeAll()
      reload()
    case Strings.showLog: NSWorkspace.shared.activateFileViewerSelecting([Backend.machineLog])
    case Strings.openInBrowser: opener(SessionLink.home(port: port))
    default: break
    }
  }

  // MARK: Leaving the window

  private func openExternally(_ url: URL) {
    let now = Date()
    guard now.timeIntervalSince(lastOpenerAt) >= 1 else {
      NSLog("AgentOS: dropped an open of a \(url.scheme ?? "?") link (at most one a second)")
      return
    }
    lastOpenerAt = now
    opener(url)
  }

  /// WKNavigationAction.sourceFrame can be nil although Swift says it isn't
  private func sourceIsOurMainFrame(_ action: WKNavigationAction) -> Bool {
    guard let source = action.value(forKey: "sourceFrame") as? WKFrameInfo else { return false }
    return source.isMainFrame && isOurs(source.request.url)
  }

  private func isSignInPage(_ url: URL) -> Bool {
    guard url.scheme == "http", url.host == "127.0.0.1", (url.port ?? 80) == port else { return false }
    let path = LinkPolicy.normalisedPath(url)
    return path == "/auth/login" || path.hasPrefix("/auth/")
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    let mainFrame = action.targetFrame?.isMainFrame ?? false
    if mainFrame, isSignInPage(url) {
      decisionHandler(.cancel)
      showOffline(.signIn)
      return
    }
    let linkActivated = action.navigationType == .linkActivated
    let d = policy.decide(
      url, mainFrame: mainFrame, linkActivated: linkActivated, newWindow: false,
      sourceIsOurMainFrame: sourceIsOurMainFrame(action))
    if action.shouldPerformDownload, d == .load, mainFrame, isOurs(url), linkActivated {
      return decisionHandler(.download)
    }
    switch d {
    case .load:
      decisionHandler(.allow)
    case .openInBrowser, .openWithSystem:
      decisionHandler(.cancel)
      openExternally(url)
    case .cancel:
      decisionHandler(.cancel)
      NSLog("AgentOS: kept a \(url.scheme ?? "?") navigation out of the window")
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
  ) {
    let disposition =
      (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
    let wantsDownload = !response.canShowMIMEType || disposition.hasPrefix("attachment")
    guard wantsDownload else { return decisionHandler(.allow) }
    if response.isForMainFrame, isOurs(response.response.url) {
      decisionHandler(.download)
    } else {
      decisionHandler(.cancel)
    }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finishCount += 1
    if overlay == .starting || overlay == .notAnswering || overlay == .off || overlay == .updating {
      hideOffline()
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadFailed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadFailed(error)
  }

  private func loadFailed(_ error: Error) {
    let ns = error as NSError
    let unreachable = [
      NSURLErrorCannotConnectToHost, NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorCannotFindHost,
    ]
    guard ns.domain == NSURLErrorDomain, unreachable.contains(ns.code) else { return }
    showOffline(offlineKind())
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let now = Date()
    terminations = terminations.filter { now.timeIntervalSince($0) < 60 } + [now]
    if terminations.count >= 3 {
      showOffline(.crashed)
    } else {
      reload()
    }
  }

  // MARK: WKUIDelegate

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url {
      let d = policy.decide(
        url, mainFrame: true, linkActivated: true, newWindow: true, sourceIsOurMainFrame: sourceIsOurMainFrame(action))
      if d == .openInBrowser || d == .openWithSystem { openExternally(url) }
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
  ) {
    guard let window = self.window else { return completionHandler(nil) }
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.message = Strings.uploadMessage
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  /// Our own main frame may show a sheet; any other frame gets no panel
  private func panelAllowed(_ frame: WKFrameInfo) -> Bool {
    let origin = frame.securityOrigin
    let ours = origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == port
    guard frame.isMainFrame, ours, let window, window.isVisible, window.attachedSheet == nil else {
      NSLog("AgentOS: refused a page dialog from another frame")
      return false
    }
    return true
  }

  private func makeAlert(_ message: String, confirm: Bool) -> NSAlert {
    let alert = NSAlert()
    alert.messageText = message
    let word = Strings.alertDestructiveWords.first { message.hasPrefix($0) }
    let button = alert.addButton(withTitle: confirm ? (word ?? Strings.ok) : Strings.ok)
    if confirm, word != nil { button.hasDestructiveAction = true }
    if confirm { alert.addButton(withTitle: Strings.cancel) }
    return alert
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable () -> Void
  ) {
    guard panelAllowed(frame), let window else { return completionHandler() }
    makeAlert(message, confirm: false).beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable (Bool) -> Void
  ) {
    guard panelAllowed(frame), let window else { return completionHandler(false) }
    makeAlert(message, confirm: true).beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void
  ) {
    guard panelAllowed(frame), let window else { return completionHandler(nil) }
    let alert = makeAlert(prompt, confirm: true)
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
    }
  }

  /// No microphone or camera this round
  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }

  // MARK: WKDownloadDelegate

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping @MainActor @Sendable (URL?) -> Void
  ) {
    let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
    let name = LinkPolicy.uniqueName(LinkPolicy.cleanDownloadName(suggestedFilename)) {
      FileManager.default.fileExists(atPath: folder.appendingPathComponent($0).path)
    }
    let dest = folder.appendingPathComponent(name)
    downloads[ObjectIdentifier(download)] = dest
    completionHandler(dest)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let dest = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    let value = String(format: "0083;%08x;AgentOS;", Int(Date().timeIntervalSince1970))
    _ = value.withCString { setxattr(dest.path, "com.apple.quarantine", $0, strlen($0), 0, 0) }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let dest = downloads.removeValue(forKey: ObjectIdentifier(download))
    let alert = NSAlert()
    alert.messageText = Strings.downloadFailedTitle
    alert.informativeText = Strings.downloadFailedBody(
      dest?.lastPathComponent ?? "download", error.localizedDescription)
    alert.addButton(withTitle: Strings.ok)
    if let window, window.isVisible { alert.beginSheetModal(for: window) } else { alert.runModal() }
  }
}
