import SwiftUI

@main
struct HoloSynthApp: App {
    @StateObject private var store = GameStore()

    var body: some Scene {
        WindowGroup {
            Group {
                if store.token == nil { AuthView() } else { HomeView() }
            }
            .environmentObject(store)
            .preferredColorScheme(.dark)
            .tint(Theme.cyan)
        }
    }
}

struct AuthView: View {
    @EnvironmentObject var store: GameStore
    @State private var username = ""
    @State private var password = ""
    @State private var newAccount = true
    @State private var busy = false

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                if let pack = Art.image("pack") {
                    Image(uiImage: pack).resizable().scaledToFit().frame(maxHeight: 260)
                        .shadow(color: Theme.backRed.opacity(0.7), radius: 24)
                }
                Text(newAccount ? "Create your account" : "Welcome back")
                    .font(.title2.bold()).foregroundColor(Theme.fg)
                VStack(spacing: 10) {
                    TextField("Username", text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                }
                .textFieldStyle(.plain)
                .padding(12)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 10))
                .foregroundColor(Theme.fg)

                if let error = store.error {
                    Text(error).font(.footnote).foregroundColor(Theme.pink).multilineTextAlignment(.center)
                }

                Button {
                    busy = true
                    Task {
                        await store.auth(username: username, password: password, newAccount: newAccount)
                        busy = false
                    }
                } label: {
                    Text(busy ? "…" : (newAccount ? "Sign up" : "Log in"))
                        .font(.headline).frame(maxWidth: .infinity).padding(14)
                        .background(Theme.cyan, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundColor(.black)
                }
                .disabled(busy || username.isEmpty || password.isEmpty)

                Button(newAccount ? "I already have an account" : "New here? Create an account") {
                    newAccount.toggle()
                    store.error = nil
                }
                .font(.footnote)
                Spacer()
            }
            .padding(24)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var store: GameStore

    var body: some View {
        TabView {
            BattleTab().tabItem { Label("Battle", systemImage: "bolt.fill") }
            PackTab().tabItem { Label("Packs", systemImage: "gift.fill") }
            CollectionTab().tabItem { Label("Cards", systemImage: "square.grid.3x3.fill") }
        }
        .task { await store.refresh() }
    }
}

// Gold, level and name, shown at the top of every tab.
struct PlayerBar: View {
    @EnvironmentObject var store: GameStore

    var body: some View {
        HStack {
            if let p = store.profile {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.username).font(.headline)
                    Text("Level \(p.level) · \(p.xp % 100)/100 XP").font(.caption).foregroundColor(Theme.muted)
                }
                Spacer()
                Label("\(p.gold)", systemImage: "circle.hexagongrid.fill")
                    .font(.headline.monospacedDigit()).foregroundColor(Theme.gold)
            } else {
                Spacer()
            }
        }
        .foregroundColor(Theme.fg)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Theme.panel)
    }
}
