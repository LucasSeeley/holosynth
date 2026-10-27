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
    @Published var profile: Profile? { didSet { trackNew() } }
    @Published var newCards: Set<String> = []   // cards you got since you last looked at the Cards tab ("NEW" tag)

    // Any card id that shows up in the collection for the first time gets a NEW tag. Kept per account across launches.
    private func trackNew() {
        guard let p = profile, !p.needsStarter else { return }
        let d = UserDefaults.standard, seenKey = "seen.\(p.username)", newKey = "new.\(p.username)"
        let owned = Set(p.collection.keys)
        var fresh = Set(d.stringArray(forKey: newKey) ?? [])
        if let seen = d.stringArray(forKey: seenKey) { fresh.formUnion(owned.subtracting(seen)) }   // first launch: nothing is new
        d.set(Array(owned), forKey: seenKey)
        d.set(Array(fresh), forKey: newKey)
        if fresh != newCards { newCards = fresh }
    }

    func clearNew() {
        guard let p = profile, !newCards.isEmpty else { return }
        newCards = []
        UserDefaults.standard.removeObject(forKey: "new.\(p.username)")
    }
    @Published var error: String?
    @Published var social: Social?

    func auth(username: String, password: String, newAccount: Bool) async {
        do {
            let reply: AuthReply = try await API.call(newAccount ? "signup" : "login", token: nil,
                                                      body: ["username": username, "password": password])
            token = reply.token
            profile = reply.profile
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
        social = nil
    }

    func loadSocial() async {
        guard let token else { return }
        if let s: Social = try? await API.call("social", token: token) { social = s }
    }

    // Friend actions (add / remove / decline): returns the server's message, or throws its error.
    @discardableResult
    func socialAction(_ path: String, _ body: [String: Any]) async throws -> String? {
        let reply: SocialReply = try await API.call(path, token: token, body: body)
        social = reply.social
        if path.hasPrefix("trades") { await refresh() }   // offered cards and gold are held, so the collection changed
        return reply.message
    }

    func setAvatar(_ id: String) async {
        do { profile = try await API.call("avatar", token: token, body: ["card": id]) }
        catch { self.error = error.localizedDescription }
    }

    func buyPack(_ type: String) async -> PackReply? {
        do {
            let reply: PackReply = try await API.call("packs", token: token, body: ["type": type])
            profile = reply.profile
            return reply
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    // Opens your oldest unopened pack of `type`.
    func openPack(_ type: String) async -> PackReply? {
        do {
            let reply: PackReply = try await API.call("packs/open", token: token, body: ["type": type])
            profile = reply.profile
            error = nil
            return reply
        } catch {
            self.error = error.localizedDescription
            await refresh()
            return nil
        }
    }

    func buyShopCard(_ slot: Int, _ id: String) async -> Bool {
        do {
            let reply: ShopReply = try await API.call("shop", token: token, body: ["slot": slot, "card": id])
            profile = reply.profile
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            await refresh()   // e.g. the shop changed at midnight
            return false
        }
    }

    // First card on sign-up, and the card you pick after campaign level 3.
    func pickStarter(_ id: String) async {
        do { profile = try await API.call("starter", token: token, body: ["card": id]) }
        catch { self.error = error.localizedDescription }
    }

    func pickReward(_ id: String) async {
        do { profile = try await API.call("campaign/reward", token: token, body: ["card": id]) }
        catch { self.error = error.localizedDescription }
    }

    func setTeam(_ ids: [String]) async {
        do { profile = try await API.call("team", token: token, body: ["team": ids]) }
        catch { self.error = error.localizedDescription }
    }
}
