import AppIntents
import SwiftUI
import WidgetKit

// The Home and Lock Screen widgets. They read GET /api/widget with the link
// from AgentOS Settings → Notifications → Widget link, pasted into Edit
// Widget: a widget can't use the app's sign-in, and Feather builds have no
// App Group to hand it over.

struct LinkIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "AgentOS"
    static var description = IntentDescription(
        "Paste the widget link from AgentOS: Settings, Notifications, Widget link.")

    @Parameter(title: "Widget link")
    var link: String?
}

struct FeedEntry: TimelineEntry {
    let date: Date
    let feed: WidgetFeed?
    let problem: FeedProblem?

    static let sample = FeedEntry(date: .now, feed: .sample, problem: nil)
}

struct FeedProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FeedEntry { .sample }

    func snapshot(for configuration: LinkIntent, in context: Context) async -> FeedEntry {
        if context.isPreview { return .sample }
        return await entry(configuration)
    }

    func timeline(for configuration: LinkIntent, in context: Context) async -> Timeline<FeedEntry> {
        let entry = await entry(configuration)
        // Something working or waiting changes soon; WidgetKit still paces it
        let busy = (entry.feed?.working ?? 0) + (entry.feed?.needs ?? 0) > 0
        let next = Date().addingTimeInterval(busy ? 5 * 60 : 15 * 60)
        return Timeline(entries: [entry], policy: .after(next))
    }

    private func entry(_ configuration: LinkIntent) async -> FeedEntry {
        let (feed, problem) = await FeedClient.load(link: configuration.link)
        return FeedEntry(date: .now, feed: feed, problem: problem)
    }
}

/// Your latest sessions with their state; large adds Claude's usage
struct SessionsWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "AgentOSSessions", intent: LinkIntent.self, provider: FeedProvider()) { entry in
            SessionsView(entry: entry)
        }
        .configurationDisplayName("Sessions")
        .description("Your sessions and what each is doing. Tap one to open it.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

/// How many sessions wait on you, on the Home and Lock Screens
struct NeedsYouWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "AgentOSNeedsYou", intent: LinkIntent.self, provider: FeedProvider()) { entry in
            NeedsYouView(entry: entry)
        }
        .configurationDisplayName("Needs you")
        .description("How many sessions are waiting on you.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct AgentOSWidgets: WidgetBundle {
    var body: some Widget {
        SessionsWidget()
        NeedsYouWidget()
    }
}
