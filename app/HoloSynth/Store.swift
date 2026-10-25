import Foundation
import SwiftUI

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

// Talks to the HoloSynth server. The address is baked in at build time (Info.plist "APIBase").
enum API {
    static let base: URL = {
        let s = Bundle.main.object(forInfoDictionaryKey: "APIBase") as? String ?? ""
        return URL(string: s) ?? URL(string: "https://localhost")!
    }()

    static func call<T: Decodable>(_ path: String, token: String?, body: [String: Any]? = nil) async throws -> T {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.timeoutInterval = 15
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) }
        catch { throw APIError(message: "Can't reach the server. Check your connection.") }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(message: msg ?? "Something went wrong (\(status)).")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError(message: "Unexpected reply from the server.") }
    }
}

@MainActor
final class GameStore: ObservableObject {
    // shortcut: session token kept in UserDefaults, not the Keychain; move it if accounts ever hold anything valuable.
    @Published var token: String? = UserDefaults.standard.string(forKey: "token") {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }
    @Published var profile: Profile?
    @Published var error: String?
    @Published var starterPack: [String]?   // set on sign-up so the first screen is opening your starter cards

    func auth(username: String, password: String, newAccount: Bool) async {
        do {
            let reply: AuthReply = try await API.call(newAccount ? "signup" : "login", token: nil,
                                                      body: ["username": username, "password": password])
            token = reply.token
            profile = reply.profile
            if newAccount { starterPack = reply.profile.team }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func refresh() async {
        guard let token else { return }
        do { profile = try await API.call("me", token: token) }
        catch let e as APIError where e.message.contains("log in") { logout() }
        catch { self.error = error.localizedDescription }
    }

    func logout() {
        token = nil
        profile = nil
    }

    func buyPack() async -> [String]? {
        do {
            let reply: PackReply = try await API.call("packs", token: token, body: [:])
            profile = reply.profile
            return reply.cards
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func setTeam(_ ids: [String]) async {
        do { profile = try await API.call("team", token: token, body: ["team": ids]) }
        catch { self.error = error.localizedDescription }
    }
}
