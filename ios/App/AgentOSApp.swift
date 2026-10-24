import SwiftUI

@main
struct AgentOSApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        WindowGroup {
            RootView(model: delegate.model)
                .onOpenURL { delegate.model.handle(url: $0) }
        }
    }
}
