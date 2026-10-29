import SwiftUI

/// Where AgentOS runs. Sign-in happens in the page itself.
struct ServerSheet: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""

    private var url: URL? {
        let trimmed = address.trimmingCharacters(in: .whitespaces)
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme), url.host() != nil else { return nil }
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("agent.example.com", text: $address)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server address")
                } footer: {
                    Text("The address you open AgentOS at in Safari.")
                }
                Section {
                    Button("Use \(AppModel.defaultServer.host() ?? "")") {
                        address = AppModel.defaultServer.absoluteString
                    }
                }
                if model.lock.available {
                    Section {
                        Toggle("Require \(model.lock.method)", isOn: Binding(
                            get: { model.lock.enabled },
                            set: { on in Task { await model.lock.setEnabled(on) } }
                        ))
                    } footer: {
                        Text("Asked when AgentOS opens and after a minute away. The app switcher shows a blank page.")
                    }
                }
            }
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() } label: { Label("Cancel", systemImage: "xmark") }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        if let url { model.load(url) }
                        dismiss()
                    } label: { Label("Open", systemImage: "checkmark") }
                    .disabled(url == nil)
                    .tint(model.accentColor)
                }
            }
        }
        .onAppear { address = model.server.absoluteString }
    }
}
