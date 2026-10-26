import SwiftUI

@main
struct HoloSynthApp: App {
    @StateObject private var store = GameStore()
    @StateObject private var art = ArtSync.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if store.token == nil { AuthView() } else if !art.ready { ArtLoadingView() } else { HomeView() }
            }
            .task { await art.run() }
            .environmentObject(store)
            .preferredColorScheme(.dark)
            .tint(Theme.brass)
            .onChange(of: phase) { p in if p == .active && store.token != nil { Music.resume() } }
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

    private let gold = Theme.brass

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView(showsIndicators: false) {
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
    @State private var spinClosed = false   // closed the daily spin this session: it comes back next launch

    var body: some View {
        TabView(selection: $tab) {
            PlayTab(tab: $tab).tabItem { Label("Play", systemImage: "bolt.fill") }.tag(0)
            PackTab().tabItem { Label("Packs", systemImage: "gift.fill") }.tag(1)
            CollectionTab().tabItem { Label("Cards", systemImage: "square.grid.3x3.fill") }.tag(2)
            SocialTab().tabItem { Label("Social", systemImage: "person.2.fill") }.tag(3)
                .badge((store.social?.requests.count ?? 0) + (store.social?.challenges.count ?? 0) + (store.social?.trades?.filter { !$0.mine || $0.status == "accepted" }.count ?? 0))
            ProfileTab().tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }.tag(4)
        }
        .toolbarBackground(Theme.ink, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .task {
            await store.refresh()
            // keeps friend requests, challenges and who's online fresh (and marks you online to friends)
            while !Task.isCancelled {
                await store.loadSocial()
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
        .onAppear { Music.play(.menu) }
        .fullScreenCover(isPresented: Binding(get: {
            !spinClosed && store.profile.map { !$0.needsStarter && $0.nextSpin == 0 } == true
        }, set: { if !$0 { spinClosed = true } })) {
            DailySpinView { pack in
                spinClosed = true
                if let pack { store.pendingPack = pack; tab = 1 }
            }
        }
        // New accounts pick their first card before anything else.
        .fullScreenCover(isPresented: Binding(get: { store.profile?.needsStarter == true }, set: { _ in })) {
            CardPicker(eyebrow: "Welcome to HoloSynth", title: "Choose your first card",
                       subtitle: "The other two join you as you clear the campaign.",
                       ids: ["volt", "fang", "goliath"], cta: "Choose", showAdvantage: true) { id in
                await store.pickStarter(id)
            }
        }
    }
}

// Gold, level and name, shown at the top of every tab.
struct PlayerBar: View {
    @EnvironmentObject var store: GameStore

    var body: some View {
        HStack(spacing: 12) {
            if let p = store.profile {
                VStack(alignment: .leading, spacing: 5) {
                    Text(p.username).font(.chakra(17)).foregroundColor(Theme.fg)
                    HStack(spacing: 8) {
                        Text("LV \(p.level)").font(.chakra(12, semibold: true)).tracking(1.5).foregroundColor(Theme.brass)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.brass.opacity(0.15))
                                Capsule().fill(Theme.brass).frame(width: geo.size.width * CGFloat(p.xpInto) / CGFloat(p.xpNeed))
                            }
                        }
                        .frame(width: 90, height: 5)
                    }
                }
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "circle.hexagongrid.fill").foregroundColor(Theme.brass)
                    Text("\(p.gold)").font(.chakra(17)).monospacedDigit().foregroundColor(Theme.fg)
                }
                .padding(.horizontal, 12).frame(height: 36)
                .goldPanel(18)
            } else {
                Spacer()
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Theme.ink.opacity(0.85))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.brass.opacity(0.25)).frame(height: 1) }
    }
}
