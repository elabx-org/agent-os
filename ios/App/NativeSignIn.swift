import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Signs in to Agent-OS with the system's web authentication sheet. The sheet
/// shares Safari's sign-in with the identity provider (and its passkeys), so
/// usually there's nothing to type. Agent-OS hands back a one-time code that
/// only this app's verifier can trade for the session cookie.
@MainActor
final class NativeSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: LocalizedError {
        case cancelled
        case refused(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: "Sign-in was cancelled."
            case .refused(let reason): reason
            }
        }
    }

    private var session: ASWebAuthenticationSession?

    func signIn(server: URL) async throws -> HTTPCookie {
        let verifier = Self.randomString()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL

        var login = URLComponents(url: server.appending(path: "auth/login"), resolvingAgainstBaseURL: false)!
        login.queryItems = [URLQueryItem(name: "native_challenge", value: challenge)]

        let callback = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: login.url!,
                callback: .customScheme("agentos")
            ) { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: Failure.cancelled)
                } else {
                    continuation.resume(throwing: error ?? Failure.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
        session = nil

        guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value else {
            throw Failure.refused("Agent-OS didn't finish the sign-in.")
        }
        return try await exchange(server: server, code: code, verifier: verifier)
    }

    private func exchange(server: URL, code: String, verifier: String) async throws -> HTTPCookie {
        var request = URLRequest(url: server.appending(path: "auth/native/exchange"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "verifier": verifier])
        let (data, response) = try await URLSession.shared.data(for: request)

        struct Reply: Decodable {
            struct Cookie: Decodable { let name: String; let value: String; let maxAge: Double }
            let cookie: Cookie?
            let error: String?
        }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let cookie = reply?.cookie,
              let host = server.host() else {
            throw Failure.refused(reply?.error ?? "Agent-OS refused the sign-in.")
        }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: cookie.name,
            .value: cookie.value,
            .domain: host,
            .path: "/",
            .expires: Date(timeIntervalSinceNow: cookie.maxAge),
            .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
        ]
        if server.scheme == "https" { properties[.secure] = "TRUE" }
        guard let result = HTTPCookie(properties: properties) else {
            throw Failure.refused("Agent-OS sent an unreadable session.")
        }
        return result
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }

    private static func randomString() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URL
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
