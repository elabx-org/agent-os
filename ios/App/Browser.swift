import Foundation
import Observation
import SafariServices
import UIKit

/// Pages opened from links, in Safari sheets that minimise instead of
/// closing: Done or a swipe down leaves the sheet in memory and the page
/// shows a pill for it; the pill brings back the same sheet (scroll and all)
/// and its ✕ lets it go. Addresses are kept, so the pills outlast a relaunch
/// (as fresh pages). Sign-ins live in the app's Safari data, not a sheet.
@Observable
@MainActor
final class Browser {
    struct Page {
        let id: String
        let url: URL
        /// Gone after a relaunch, or released under memory pressure
        var sheet: SFSafariViewController?
    }

    /// Newest first
    private(set) var pages: [Page] = []
    /// The page last closed, kept a while for Undo
    @ObservationIgnored private var closed: Page?
    @ObservationIgnored private var closedTimer: Timer?

    private static let maxPages = 3
    private static let storeKey = "browserPages"

    /// Tells the page, for Undo
    @ObservationIgnored var onChange: (@MainActor (_ closed: Page?) -> Void)?
    @ObservationIgnored var accent: @MainActor () -> UIColor? = { nil }

    init() {
        let saved = UserDefaults.standard.array(forKey: Self.storeKey) as? [[String: String]] ?? []
        pages = saved.compactMap { item in
            guard let id = item["id"], let url = item["url"].flatMap(URL.init(string:)) else { return nil }
            return Page(id: id, url: url)
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.releaseHidden() }
        }
    }

    /// A tapped link: the page already open for it, or a new one
    func open(_ url: URL) {
        if let page = pages.first(where: { $0.url == url }) {
            show(page.id)
            return
        }
        var page = Page(id: UUID().uuidString, url: url)
        page.sheet = makeSheet(url)
        pages.insert(page, at: 0)
        // A fourth page lets the oldest go
        if pages.count > Self.maxPages { pages.removeLast(pages.count - Self.maxPages) }
        changed()
        present(page.sheet!)
    }

    /// A pill tapped: the same sheet, or the address again if it was let go
    func show(_ id: String) {
        guard let index = pages.firstIndex(where: { $0.id == id }) else { return }
        if pages[index].sheet == nil { pages[index].sheet = makeSheet(pages[index].url) }
        let page = pages.remove(at: index)
        pages.insert(page, at: 0)
        changed()
        present(page.sheet!)
    }

    /// A pill's ✕; Undo can bring it back for a few seconds
    func close(_ id: String) {
        guard let index = pages.firstIndex(where: { $0.id == id }) else { return }
        closed = pages.remove(at: index)
        closedTimer?.invalidate()
        closedTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.closed = nil }
        }
        changed(closed: closed)
    }

    /// Close all: no Undo
    func closeAll() {
        pages.removeAll()
        changed()
    }

    func undo() {
        guard let page = closed else { return }
        closed = nil
        closedTimer?.invalidate()
        pages.insert(page, at: 0)
        if pages.count > Self.maxPages { pages.removeLast(pages.count - Self.maxPages) }
        changed()
    }

    /// For the page's Undo toast
    func json(_ page: Page) -> [String: String] {
        ["id": page.id, "url": page.url.absoluteString, "title": Self.title(page.url)]
    }

    /// What the menu calls a page: its site, and the kind of page when known
    static func title(_ url: URL) -> String {
        var host = url.host() ?? url.absoluteString
        if host.hasPrefix("www.") { host.removeFirst(4) }
        let parts = url.pathComponents.filter { $0 != "/" }
        if host == "claude.ai", parts.first == "artifact" { return "claude.ai · artifact" }
        if host == "github.com", parts.count >= 4 {
            return "\(parts[1]) · \(parts[2] == "pull" ? "PR" : parts[2]) \(parts[3])"
        }
        return host
    }

    private func changed(closed: Page? = nil) {
        UserDefaults.standard.set(
            pages.map { ["id": $0.id, "url": $0.url.absoluteString] }, forKey: Self.storeKey
        )
        onChange?(closed)
    }

    /// Done, Share and Open in Safari come with it. A page sheet: UIKit
    /// can't place a sheet on one page of the open iPhone Duo.
    private func makeSheet(_ url: URL) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.barCollapsingEnabled = true
        let sheet = SFSafariViewController(url: url, configuration: config)
        sheet.dismissButtonStyle = .done
        sheet.preferredControlTintColor = accent()
        sheet.modalPresentationStyle = .pageSheet
        return sheet
    }

    private func present(_ sheet: SFSafariViewController) {
        guard sheet.presentingViewController == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var top = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        while let next = top?.presentedViewController { top = next }
        top?.present(sheet, animated: true)
    }

    /// Hidden sheets are only a convenience: memory is worth more
    private func releaseHidden() {
        for index in pages.indices where pages[index].sheet?.presentingViewController == nil {
            pages[index].sheet = nil
        }
        closed?.sheet = nil
    }
}
