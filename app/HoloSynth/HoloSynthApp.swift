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
    @FocusState private var focus: Field?
    enum Field { case user, pass }

    private let gold = Color(hex: 0xE8B85A)

    var body: some View {
        ZStack {
            background
            ScrollView {
                VStack(spacing: 0) {
                    if let logo = Art.image("logo") {
                        Image(uiImage: logo).resizable().scaledToFit().frame(maxWidth: 330)
                            .shadow(color: Color(hex: 0xFFAA28).opacity(0.35), radius: 18)
                    }
                    Text("RIP · BUILD · BATTLE")
                        .font(.custom("ChakraPetch-SemiBold", size: 12)).tracking(3.8)
                        .foregroundColor(gold).padding(.top, 6)
                    if let pack = Art.image("pack") {
                        Image(uiImage: pack).resizable().scaledToFit().frame(height: 250)
                            .rotationEffect(.degrees(-4))
                            .shadow(color: Theme.backRed.opacity(0.8), radius: 30, y: 18)
                            .padding(.top, 26).padding(.bottom, 30)
                    }
                    VStack(spacing: 12) {
                        field(.user, icon: "person") {
                            TextField("", text: $username, prompt: Text("Username").foregroundColor(Theme.muted))
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .textContentType(.username).submitLabel(.next)
                                .onSubmit { focus = .pass }
                        }
                        field(.pass, icon: "lock") {
                            SecureField("", text: $password, prompt: Text("Password").foregroundColor(Theme.muted))
                                .textContentType(newAccount ? .newPassword : .password).submitLabel(.go)
                                .onSubmit(submit)
                        }
                        if let error = store.error {
                            Text(error).font(.custom("Barlow-SemiBold", size: 14)).foregroundColor(Theme.pink)
                                .multilineTextAlignment(.center)
                        }
                        Button(action: submit) {
                            Text(busy ? "…" : (newAccount ? "CREATE ACCOUNT" : "LOG IN"))
                                .font(.custom("ChakraPetch-Bold", size: 18)).tracking(2.5)
                                .foregroundColor(Color(hex: 0x1A0D05))
                                .frame(maxWidth: .infinity).frame(height: 56)
                                .background(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)],
                                                           startPoint: .top, endPoint: .bottom),
                                            in: RoundedRectangle(cornerRadius: 14))
                                .shadow(color: Color(hex: 0xE0A12A).opacity(0.35), radius: 12, y: 8)
                        }
                        .disabled(busy || username.isEmpty || password.isEmpty)
                        .opacity(username.isEmpty || password.isEmpty ? 0.6 : 1)
                        .padding(.top, 6)
                    }
                    Button {
                        newAccount.toggle()
                        store.error = nil
                    } label: {
                        (Text(newAccount ? "Already have an account? " : "New here? ").foregroundColor(Theme.muted)
                         + Text(newAccount ? "Log in" : "Create an account").foregroundColor(gold)
                            .font(.custom("Barlow-SemiBold", size: 15)))
                            .font(.custom("Barlow-Regular", size: 15))
                    }
                    .padding(.top, 18)
                }
                .padding(.horizontal, 24).padding(.top, 40).padding(.bottom, 30)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var background: some View {
        ZStack {
            Color(hex: 0x07060C)
            if let bg = Art.image("login_bg") {
                GeometryReader { geo in
                    Image(uiImage: bg).resizable().scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height).clipped()
                }
            }
            LinearGradient(stops: [
                .init(color: Color(hex: 0x07060C).opacity(0.55), location: 0),
                .init(color: Color(hex: 0x07060C).opacity(0.35), location: 0.3),
                .init(color: Color(hex: 0x07060C).opacity(0.85), location: 0.58),
                .init(color: Color(hex: 0x07060C), location: 0.75),
            ], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Theme.backRed.opacity(0.45), .clear], center: UnitPoint(x: 0.5, y: 0.38),
                           startRadius: 0, endRadius: 260)
        }
        .ignoresSafeArea()
    }

    private func field<Content: View>(_ which: Field, icon: String, @ViewBuilder _ content: () -> Content) -> some View {
        let on = focus == which
        return HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundColor(gold).frame(width: 20)
            content().focused($focus, equals: which)
                .font(.custom("Barlow-Regular", size: 17)).foregroundColor(Theme.fg).tint(gold)
        }
        .padding(.horizontal, 16).frame(height: 54)
        .background(Color(red: 18/255, green: 16/255, blue: 30/255).opacity(0.82), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(gold.opacity(on ? 1 : 0.28), lineWidth: 1))
        .shadow(color: on ? gold.opacity(0.18) : .clear, radius: 6)
        .contentShape(Rectangle())
        .onTapGesture { focus = which }
    }

    private func submit() {
        guard !busy, !username.isEmpty, !password.isEmpty else { return }
        focus = nil
        busy = true
        Task {
            await store.auth(username: username, password: password, newAccount: newAccount)
            busy = false
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var store: GameStore
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            BattleTab().tabItem { Label("Battle", systemImage: "bolt.fill") }.tag(0)
            PackTab().tabItem { Label("Packs", systemImage: "gift.fill") }.tag(1)
            CollectionTab().tabItem { Label("Cards", systemImage: "square.grid.3x3.fill") }.tag(2)
        }
        .task { await store.refresh() }
        .onAppear { if store.starterPack != nil { tab = 1 } }
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
