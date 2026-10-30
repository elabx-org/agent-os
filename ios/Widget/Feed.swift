import Foundation

/// What GET /api/widget answers (app/api/widget/route.ts WidgetFeed)
struct WidgetFeed: Codable {
    struct Session: Codable, Identifiable {
        let id: String
        let title: String
        let project: String?
        /// AgentState: needs, work, idle, limited, error…
        let state: String
        /// "Needs you · npm run build", "Working", "Idle"
        let line: String
        /// When it entered this state, ms since 1970
        let since: Double
    }

    struct Window: Codable {
        let percent: Double?
        let resetsAt: String?
    }

    struct Usage: Codable {
        let fiveHour: Window
        let week: Window
    }

    let at: Double
    let needs: Int
    let working: Int
    let sessions: [Session]
    let usage: Usage?
}

enum FeedProblem {
    /// No link pasted yet
    case noLink
    /// Not a widget link
    case badLink
    /// The key was replaced (New link in Settings)
    case refused
    /// The server couldn't be reached
    case offline
}

enum FeedClient {
    private static let cacheKey = "feed"

    /// The feed for this link, or the last one this widget saw with why it's old
    static func load(link: String?) async -> (WidgetFeed?, FeedProblem?) {
        guard let link = link?.trimmingCharacters(in: .whitespacesAndNewlines),
              !link.isEmpty else { return (nil, .noLink) }
        guard var parts = URLComponents(string: link),
              parts.scheme == "https" || parts.scheme == "http",
              parts.path.hasSuffix("/api/widget"),
              let key = parts.queryItems?.first(where: { $0.name == "key" })?.value,
              !key.isEmpty else { return (nil, .badLink) }
        // The key goes in a header, not the URL the proxy logs
        parts.queryItems = nil
        guard let url = parts.url else { return (nil, .badLink) }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 { return (cached(), .refused) }
            guard status == 200 else { return (cached(), .offline) }
            let feed = try JSONDecoder().decode(WidgetFeed.self, from: data)
            UserDefaults.standard.set(data, forKey: cacheKey)
            return (feed, nil)
        } catch {
            return (cached(), .offline)
        }
    }

    private static func cached() -> WidgetFeed? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(WidgetFeed.self, from: data)
    }
}

extension WidgetFeed {
    /// For the gallery and placeholders: the shape of a real afternoon
    static let sample: WidgetFeed = {
        let now = Date().timeIntervalSince1970 * 1000
        return WidgetFeed(
            at: now,
            needs: 1,
            working: 1,
            sessions: [
                Session(id: "a", title: "Session 23", project: "fusionha-ios", state: "needs",
                        line: "Needs you · xcodebuild -scheme FusionHA", since: now - 4 * 60_000),
                Session(id: "b", title: "Widgets for the iOS app", project: "agent-os", state: "work",
                        line: "Working", since: now - 30_000),
                Session(id: "c", title: "Session 22", project: "feather-builder", state: "idle",
                        line: "Idle", since: now - 16 * 3_600_000),
                Session(id: "d", title: "Session 21", project: "ios-cert-forge", state: "idle",
                        line: "Idle", since: now - 17 * 3_600_000),
            ],
            usage: Usage(fiveHour: Window(percent: 12, resetsAt: nil),
                         week: Window(percent: 66, resetsAt: nil))
        )
    }()
}
