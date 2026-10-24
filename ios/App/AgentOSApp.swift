import SwiftUI

@main
struct AgentOSApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
        }
    }
}
