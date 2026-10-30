import SwiftUI
import WidgetKit

// The look of the widget mock: dark glass, the robot-head mark, a dot per
// state in the app's colours, system type.

enum Palette {
    static let ink = Color(red: 0.957, green: 0.961, blue: 0.969)
    static let muted = ink.opacity(0.62)
    static let faint = ink.opacity(0.16)
    static let needs = Color(red: 1.0, green: 0.702, blue: 0.251)
    static let work = Color(red: 0.298, green: 0.831, blue: 0.627)
    static let idle = Color(red: 0.541, green: 0.569, blue: 0.612)
    static let bad = Color(red: 1.0, green: 0.42, blue: 0.42)
    static let ground = LinearGradient(
        colors: [Color(red: 0.11, green: 0.115, blue: 0.13), Color(red: 0.06, green: 0.063, blue: 0.072)],
        startPoint: .top, endPoint: .bottom)

    static func dot(_ state: String) -> Color {
        switch state {
        case "needs": needs
        case "work", "queued": work
        case "error", "limited": bad
        default: idle
        }
    }
}

/// AgentOS's mark: lucide's "bot" on its 24pt grid
struct BotMark: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(12, 8)); path.addLine(to: p(12, 4)); path.addLine(to: p(8, 4))
        path.addRoundedRect(in: CGRect(origin: p(4, 8), size: CGSize(width: 16 * s, height: 12 * s)),
                            cornerSize: CGSize(width: 2 * s, height: 2 * s))
        path.move(to: p(2, 14)); path.addLine(to: p(4, 14))
        path.move(to: p(20, 14)); path.addLine(to: p(22, 14))
        path.move(to: p(15, 13)); path.addLine(to: p(15, 15))
        path.move(to: p(9, 13)); path.addLine(to: p(9, 15))
        return path
    }
}

struct Mark: View {
    var size: CGFloat = 14
    var body: some View {
        BotMark()
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

/// "now", "4m", "16h", "3d"
func shortAge(_ ms: Double, now: Date) -> String {
    let seconds = max(0, now.timeIntervalSince1970 - ms / 1000)
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h" }
    return "\(Int(seconds / 86400))d"
}

func summary(_ feed: WidgetFeed) -> String {
    var parts: [String] = []
    if feed.working > 0 { parts.append("\(feed.working) working") }
    if feed.needs > 0 { parts.append("\(feed.needs) need\(feed.needs == 1 ? "s" : "") you") }
    return parts.isEmpty ? "All quiet" : parts.joined(separator: " · ")
}

func sessionURL(_ id: String) -> URL? { URL(string: "agentos://session/\(id)") }

/// Why there's no live data, in a sentence and what to do
struct ProblemView: View {
    let problem: FeedProblem
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Mark()
                Text("AgentOS").font(.caption.weight(.semibold))
            }
            .foregroundStyle(Palette.muted)
            Spacer(minLength: 0)
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
            Text(hint).font(.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var title: String {
        switch problem {
        case .noLink: "Add your widget link"
        case .badLink: "That isn't a widget link"
        case .refused: "This link was replaced"
        case .offline: "Can't reach AgentOS"
        }
    }

    private var hint: String {
        switch problem {
        case .noLink, .badLink, .refused:
            "Copy it in AgentOS: Settings, Notifications. Then touch and hold here, Edit Widget."
        case .offline:
            "It tries again in a few minutes."
        }
    }
}

struct SessionRow: View {
    let session: WidgetFeed.Session
    let now: Date
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Palette.dot(session.state)).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(session.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.ink)
                Text(session.line)
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
            .lineLimit(1)
            Spacer(minLength: 4)
            Text(shortAge(session.since, now: now))
                .font(.caption.weight(.medium).monospacedDigit())
                .foregroundStyle(Palette.muted)
        }
    }
}

struct UsageBar: View {
    let label: String
    let window: WidgetFeed.Window
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(window.percent.map { "\(Int($0.rounded()))%" } ?? "–").monospacedDigit()
            }
            .font(.caption2.weight(.medium))
            .foregroundStyle(Palette.muted)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.faint)
                    Capsule().fill(Palette.ink)
                        .frame(width: geo.size.width * min(1, max(0.01, (window.percent ?? 0) / 100)))
                }
            }
            .frame(height: 6)
        }
    }
}

struct SessionsView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FeedEntry

    var body: some View {
        Group {
            if let feed = entry.feed {
                content(feed)
            } else {
                ProblemView(problem: entry.problem ?? .offline)
            }
        }
        .containerBackground(for: .widget) { Palette.ground }
    }

    private func content(_ feed: WidgetFeed) -> some View {
        let large = family == .systemLarge
        let rows = Array(feed.sessions.prefix(large ? 6 : 3))
        return VStack(alignment: .leading, spacing: large ? 10 : 8) {
            HStack(spacing: 6) {
                Mark()
                Text("AgentOS")
                Spacer()
                Text(entry.problem == nil ? summary(feed) : "Updated \(shortAge(feed.at, now: entry.date)) ago")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Palette.muted)
            .lineLimit(1)

            if rows.isEmpty {
                Spacer(minLength: 0)
                Text("No sessions running").font(.subheadline).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
            } else {
                ForEach(rows) { session in
                    if let url = sessionURL(session.id) {
                        Link(destination: url) { SessionRow(session: session, now: entry.date) }
                    } else {
                        SessionRow(session: session, now: entry.date)
                    }
                }
                Spacer(minLength: 0)
            }

            if large, let usage = feed.usage {
                HStack(spacing: 14) {
                    UsageBar(label: "5 hours", window: usage.fiveHour)
                    UsageBar(label: "This week", window: usage.week)
                }
            }
        }
    }
}

struct NeedsYouView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FeedEntry

    var body: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        default: small
        }
    }

    private var first: WidgetFeed.Session? {
        entry.feed?.sessions.first { $0.state == "needs" }
    }

    private var link: URL? {
        first.flatMap { sessionURL($0.id) } ?? URL(string: "agentos://inbox")
    }

    private var small: some View {
        Group {
            if let feed = entry.feed {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) {
                        Mark()
                        Text("Needs you")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.muted)
                    Spacer(minLength: 0)
                    Text("\(feed.needs)")
                        .font(.system(size: 54, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(feed.needs > 0 ? Palette.needs : Palette.ink)
                    Text(subtitle(feed))
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                ProblemView(problem: entry.problem ?? .offline)
            }
        }
        .containerBackground(for: .widget) { Palette.ground }
        .widgetURL(link)
    }

    private func subtitle(_ feed: WidgetFeed) -> String {
        if let first {
            return [first.title, first.project].compactMap { $0 }.joined(separator: " · ")
        }
        return feed.working > 0 ? "\(feed.working) working" : "Nothing waiting"
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: -2) {
                Text(entry.feed.map { "\($0.needs)" } ?? "–")
                    .font(.system(size: 22, weight: .bold, design: .rounded).monospacedDigit())
                Text("needs you").font(.system(size: 8, weight: .semibold))
            }
        }
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(link)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let feed = entry.feed {
                if let first {
                    Text([first.title, first.project].compactMap { $0 }.joined(separator: " · "))
                        .font(.headline)
                    Text(first.line).font(.caption)
                } else if let working = feed.sessions.first(where: { $0.state == "work" }) {
                    Text(working.title).font(.headline)
                    Text(summary(feed)).font(.caption)
                } else {
                    Text("AgentOS").font(.headline)
                    Text("Nothing waiting").font(.caption)
                }
            } else {
                Text("AgentOS").font(.headline)
                Text(entry.problem == .offline ? "Can't reach the server" : "Add the widget link").font(.caption)
            }
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(link)
    }
}
