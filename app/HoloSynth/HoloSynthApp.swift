import SwiftUI

@main
struct HoloSynthApp: App {
    @StateObject private var store = GameStore()
    @StateObject private var art = ArtSync.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if store.token == nil { AuthView() } else if !art.ready { ArtLoadingView() }
                else if let p = store.profile, p.email == nil { AddEmailView() }
                else if let p = store.profile, p.agreed == false { AgreeView() } else { HomeView() }
            }
            .task { await art.run() }
            .environmentObject(store)
            .preferredColorScheme(.dark)
            .tint(Theme.brass)
            .onChange(of: phase) { p in if p == .active && store.token != nil { Music.resume() } }
        }
    }
}

// Sign up (username, email, password twice) or log in (username or email, password). Rules are checked as you type,
// and the server checks them again.
struct AuthView: View {
    @EnvironmentObject var store: GameStore
    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var newAccount = true
    @State private var agreeTerms = false
    @State private var agreePrivacy = false
    @State private var busy = false
    @State private var forgotOpen = false
    @State private var forgotName = ""
    @State private var forgotReply: String?
    @FocusState private var focus: Field?
    enum Field { case user, email, pass, confirm }

    private let gold = Theme.brass

    // what still stops the form, shown under the fields (nil: ready)
    private var problem: String? {
        if newAccount {
            if !username.isEmpty && username.range(of: "^[A-Za-z0-9_]{3,16}$", options: .regularExpression) == nil { return "Username: 3–16 letters, numbers or _" }
            if !email.isEmpty && email.trimmingCharacters(in: .whitespaces).range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$", options: .regularExpression) == nil { return "Enter a valid email" }
            if !password.isEmpty && (password.count < 8 || password.rangeOfCharacter(from: .letters) == nil || password.rangeOfCharacter(from: .decimalDigits) == nil) {
                return "Password: 8+ characters with a letter and a number"
            }
            if !confirm.isEmpty && confirm != password { return "Passwords don't match" }
        }
        return nil
    }
    private var complete: Bool {
        newAccount ? !username.isEmpty && !email.isEmpty && !password.isEmpty && !confirm.isEmpty && problem == nil && agreeTerms && agreePrivacy
                   : !username.isEmpty && !password.isEmpty
    }

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
                    PackFan(height: newAccount ? 96 : 210).padding(.top, 16).padding(.bottom, 20)   // sized so the whole form fits without scrolling
                    VStack(spacing: 12) {
                        field(.user, icon: "person") {
                            TextField("", text: $username, prompt: Text(newAccount ? "Username" : "Username or email").foregroundColor(Theme.muted))
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .textContentType(.username).submitLabel(.next)
                                .onSubmit { focus = newAccount ? .email : .pass }
                        }
                        if newAccount {
                            field(.email, icon: "envelope") {
                                TextField("", text: $email, prompt: Text("Email").foregroundColor(Theme.muted))
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                                    .keyboardType(.emailAddress).textContentType(.emailAddress).submitLabel(.next)
                                    .onSubmit { focus = .pass }
                            }
                        }
                        field(.pass, icon: "lock") {
                            SecureField("", text: $password, prompt: Text("Password").foregroundColor(Theme.muted))
                                .textContentType(newAccount ? .newPassword : .password).submitLabel(newAccount ? .next : .go)
                                .onSubmit { if newAccount { focus = .confirm } else { submit() } }
                        }
                        if newAccount {
                            field(.confirm, icon: "lock.rotation") {
                                SecureField("", text: $confirm, prompt: Text("Confirm password").foregroundColor(Theme.muted))
                                    .textContentType(.newPassword).submitLabel(.go)
                                    .onSubmit(submit)
                            }
                        }
                        if let msg = store.error ?? problem {
                            Text(msg).font(.custom("Barlow-SemiBold", size: 14)).foregroundColor(Theme.pink)
                                .multilineTextAlignment(.center)
                        } else if newAccount && password.isEmpty {
                            Text("8+ characters, with a letter and a number").font(.custom("Barlow-Regular", size: 13)).foregroundColor(Theme.muted)
                        }
                        if newAccount {
                            VStack(alignment: .leading, spacing: 8) {
                                AgreeRow(on: $agreeTerms, name: "Terms and Conditions", path: "terms")
                                AgreeRow(on: $agreePrivacy, name: "Privacy Policy", path: "privacy")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
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
                        .disabled(busy || !complete)
                        .opacity(complete ? 1 : 0.6)
                        .padding(.top, 6)
                        if !newAccount {
                            Button("Forgot password?") { focus = nil; forgotName = username; forgotReply = nil; forgotOpen = true }
                                .font(.custom("Barlow-SemiBold", size: 15)).foregroundColor(gold).frame(minHeight: 36)
                        }
                    }
                    Button {
                        newAccount.toggle()
                        store.error = nil
                        confirm = ""
                    } label: {
                        (Text(newAccount ? "Already have an account? " : "New here? ").foregroundColor(Theme.muted)
                         + Text(newAccount ? "Log in" : "Create an account").foregroundColor(gold)
                            .font(.custom("Barlow-SemiBold", size: 15)))
                            .font(.custom("Barlow-Regular", size: 15))
                    }
                    .frame(minHeight: 44)
                    .padding(.top, 12)
                    Text("© 2026 Lucas Seeley. All rights reserved.").font(.custom("Barlow-Regular", size: 11)).foregroundColor(Theme.muted)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 24).padding(.top, newAccount ? 30 : 40).padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .staticWhenItFits()   // it only scrolls when the keyboard is up
        }
        // Forgot password: the server emails a link that opens the reset page on the web.
        .overlay { if forgotOpen { forgotPanel } }
    }

    private var forgotPanel: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
                .onTapGesture { if !busy { closeForgot() } }
            VStack(spacing: 14) {
                Text("Forgot password").font(.chakra(24)).foregroundColor(Theme.fg)
                if let reply = forgotReply {
                    Text(reply).font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    Button("Done", action: closeForgot).buttonStyle(GoldButton())
                } else {
                    Text("We'll email you a link to set a new password.")
                        .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    TextField("", text: $forgotName, prompt: Text("Username or email").foregroundColor(Theme.muted))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress)
                        .submitLabel(.send).onSubmit(sendForgotLink)
                        .font(.barlow(17)).foregroundColor(Theme.fg).tint(gold)
                        .padding(.horizontal, 16).frame(height: 54).goldPanel()
                    Button(busy ? "…" : "Send link", action: sendForgotLink).buttonStyle(GoldButton())
                        .disabled(busy || forgotName.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Cancel", action: closeForgot).buttonStyle(OutlineButton()).disabled(busy)
                }
            }
            .padding(22).frame(maxWidth: 380)
            .background(Color(hex: 0x0E0C18), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(gold.opacity(0.28), lineWidth: 1))
            .padding(24)
        }
    }

    private func sendForgotLink() {
        guard !busy, !forgotName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        Task { forgotReply = await sendForgot(forgotName); busy = false }
    }

    private func closeForgot() { forgotOpen = false; forgotReply = nil }

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

    private func sendForgot(_ name: String) async -> String {
        struct Reply: Decodable { let message: String }
        do { let r: Reply = try await API.call("password/forgot", token: nil, body: ["name": name.trimmingCharacters(in: .whitespaces)]); return r.message }
        catch { return error.localizedDescription }
    }

    private func submit() {
        guard !busy, complete else { return }
        focus = nil
        busy = true
        Task {
            await store.auth(username: username, email: newAccount ? email : nil, password: password, newAccount: newAccount)
            busy = false
        }
    }
}

private extension View {
    @ViewBuilder func staticWhenItFits() -> some View {
        if #available(iOS 16.4, *) { scrollBounceBehavior(.basedOnSize) } else { self }
    }
}

// The three packs fanned out: Cyber, Omni in front, Magic (login and loading screens).
struct PackFan: View {
    var height: CGFloat = 230
    var body: some View {
        ZStack {
            pack("cyber", angle: -13, x: -0.42)
            pack("magic", angle: 13, x: 0.42)
            pack("omni", angle: -3, x: 0).zIndex(1)
        }
        .frame(height: height)
        .shadow(color: Theme.backRed.opacity(0.8), radius: 30, y: 18)
    }
    @ViewBuilder private func pack(_ type: String, angle: Double, x: CGFloat) -> some View {
        if let img = Art.pack(type) {
            Image(uiImage: img).resizable().scaledToFit()
                .frame(height: type == "omni" ? height : height * 0.86)
                .rotationEffect(.degrees(angle), anchor: .bottom)
                .offset(x: x * height * 0.62)
                .brightness(type == "omni" ? 0 : -0.08)
        }
    }
}

// "I have read and agree to the <link>": the box toggles it, the linked name opens the page.
struct AgreeRow: View {
    @Binding var on: Bool
    let name: String
    let path: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button { on.toggle() } label: {
                Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 22)).foregroundColor(Theme.brass)
            }
            .accessibilityLabel("I have read and agree to the \(name)")
            .accessibilityValue(on ? "checked" : "not checked")
            (Text("I have read and agree to the ").foregroundColor(Color(hex: 0xA9A5C2))
             + Text(.init("[\(name)](\(API.base.appendingPathComponent(path).absoluteString))")).font(.custom("Barlow-SemiBold", size: 14)))
                .font(.custom("Barlow-Regular", size: 14)).tint(Theme.brass)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Accounts made before sign-up asked (or after either page changes) agree once before playing.
struct AgreeView: View {
    @EnvironmentObject var store: GameStore
    @State private var terms = false
    @State private var privacy = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 14) {
                Image(systemName: "checkmark.shield").font(.system(size: 40, weight: .semibold)).foregroundColor(Theme.brass)
                Text("Before you play").font(.chakra(26)).foregroundColor(Theme.fg)
                Text("Please read and agree to our Terms and Conditions and Privacy Policy.")
                    .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 10) {
                    AgreeRow(on: $terms, name: "Terms and Conditions", path: "terms")
                    AgreeRow(on: $privacy, name: "Privacy Policy", path: "privacy")
                }
                .padding(.vertical, 6)
                if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center) }
                Button(busy ? "…" : "Continue") {
                    busy = true
                    Task { error = await store.agree(); busy = false }
                }
                .buttonStyle(GoldButton())
                .disabled(busy || !terms || !privacy)
                Button("Log out") { store.logout() }.buttonStyle(OutlineButton())
            }
            .padding(24)
        }
    }
}

// Accounts made before sign-up asked for an email add one once, before playing.
struct AddEmailView: View {
    @EnvironmentObject var store: GameStore
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 14) {
                Image(systemName: "envelope.badge").font(.system(size: 40, weight: .semibold)).foregroundColor(Theme.brass)
                Text("Add your email").font(.chakra(26)).foregroundColor(Theme.fg)
                Text("Every account needs one now. It'll let you reset your password later.")
                    .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                TextField("", text: $email, prompt: Text("Email").foregroundColor(Theme.muted))
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).textContentType(.emailAddress)
                    .font(.barlow(17)).foregroundColor(Theme.fg).padding(.horizontal, 16).frame(height: 54).goldPanel()
                SecureField("", text: $password, prompt: Text("Your password").foregroundColor(Theme.muted))
                    .textContentType(.password).font(.barlow(17)).foregroundColor(Theme.fg).padding(.horizontal, 16).frame(height: 54).goldPanel()
                if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center) }
                Button(busy ? "…" : "Save") {
                    busy = true
                    Task { error = await store.setEmail(email, password: password); busy = false }
                }
                .buttonStyle(GoldButton())
                .disabled(busy || email.isEmpty || password.isEmpty)
                Button("Log out") { store.logout() }.buttonStyle(OutlineButton())
            }
            .padding(24)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var store: GameStore
    @State private var tab = 0
    @State private var spinClosed = false   // closed the daily spin this session: it comes back next launch
    @State private var welcome = false   // the first Recruit Pack, kept up until its card has been shown

    // Social tab badge: friend requests, challenges, offers to answer, and accepted offers to claim.
    private var socialBadge: Int {
        guard let s = store.social else { return 0 }
        let trades = (s.trades ?? []).filter { t in !t.mine || t.status == "accepted" }.count
        return s.requests.count + s.challenges.count + trades
    }

    var body: some View {
        TabView(selection: $tab) {
            PlayTab(tab: $tab).tabItem { Label("Play", systemImage: "bolt.fill") }.tag(0)
                .badge(store.profile?.quests?.claimable ?? 0)   // quest rewards waiting
            ShopGate().tabItem { Label("Shop", systemImage: "bag.fill") }.tag(1)
            CollectionTab().tabItem { Label("Cards", systemImage: "square.grid.3x3.fill") }.tag(2)
            SocialTab().tabItem { Label("Social", systemImage: "person.2.fill") }.tag(3)
                .badge(socialBadge)
            ProfileTab().tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }.tag(4)
        }
        .toolbarBackground(Theme.ink, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        // New cards to look at: a pink dot on the Cards icon's top corner (the system badge can't be a dot or be moved).
        // shortcut: assumes the standard 49pt iPhone tab bar with 5 tabs, Cards in the middle; recheck if tabs change.
        .overlay(alignment: .bottom) {
            if !store.newCards.isEmpty {
                GeometryReader { g in
                    Circle().fill(Theme.pink).frame(width: 9, height: 9)
                        .shadow(color: Theme.pink.opacity(0.7), radius: 4)
                        .position(x: g.size.width / 2 + 14, y: g.size.height - 49 + 7)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
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
            !spinClosed && !store.screenOpen && store.profile.map { !$0.team.isEmpty && $0.locked?["spin"] == nil && $0.nextSpin == 0 } == true
        }, set: { if !$0 { spinClosed = true } })) {
            DailySpinView { pack in
                spinClosed = true   // a won pack waits on the Play tab
            }
        }
        // New accounts open their first Recruit Pack before anything else.
        .onReceive(store.$profile) { p in if let p, p.team.isEmpty, (p.recruit ?? 0) > 0 { welcome = true } }
        .fullScreenCover(isPresented: $welcome) {
            RecruitView(eyebrow: "Welcome to HoloSynth", title: "Open your Recruit Pack",
                        subtitle: "It holds one of three starters. The other two come in Recruit Packs at campaign levels 3 and 6.") { welcome = false }
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
