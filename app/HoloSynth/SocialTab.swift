import SwiftUI

// Friends: add someone by username, answer requests and challenges, and send a battle to anyone on the list.
struct SocialTab: View {
    @EnvironmentObject var store: GameStore
    @State private var name = ""
    @State private var note: String?          // the server's last reply to an action
    @State private var noteIsError = false
    @State private var busy = false
    @State private var battle = false
    @State private var viewing: Social.Person?    // a friend request opened as a profile sheet
    @State private var friendCard: Social.Person? // a friend's profile, just to look at

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Social").font(.chakra(28)).foregroundColor(Theme.fg)
                    addField
                    if let note {
                        Text(note).font(.barlow(14, semibold: true)).foregroundColor(noteIsError ? Theme.pink : Theme.brass)
                    }
                    if let s = store.social {
                        ForEach(s.challenges) { challengeCard($0) }
                        if !s.requests.isEmpty { requests(s.requests) }
                        if s.friends.isEmpty { empty } else { friends(s.friends) }
                    } else {
                        ProgressView().tint(Theme.brass).frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .disabled(busy)
        .onAppear { Task { await store.loadSocial() } }
        .sheet(item: $viewing) { p in
            PlayerSheet(name: p.name) { accept in
                viewing = nil
                act(accept ? "friends" : "friends/remove", ["name": p.name])
            }
        }
        .sheet(item: $friendCard) { p in PlayerSheet(name: p.name, onAnswer: nil) }
        .fullScreenCover(isPresented: $battle) {
            FriendBattleView { battle = false; Task { await store.loadSocial() } }
        }
    }

    // MARK: pieces

    private var addField: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundColor(Theme.muted)
                TextField("", text: $name, prompt: Text("Add a friend by username").foregroundColor(Theme.muted))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.barlow(16)).foregroundColor(Theme.fg).tint(Theme.brass)
                    .submitLabel(.send).onSubmit(add)
            }
            .padding(.horizontal, 14).frame(height: 46)
            .goldPanel(12)
            Button("Add", action: add).buttonStyle(GoldButton(height: 46)).frame(width: 84)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func challengeCard(_ c: Social.Challenge) -> some View {
        HStack(spacing: 12) {
            Avatar(id: c.avatar, size: 50)
            VStack(alignment: .leading, spacing: 2) {
                Text("Challenge").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                Text("\(c.name) challenged you").font(.chakra(15)).foregroundColor(Theme.fg).lineLimit(2)
            }
            Spacer(minLength: 4)
            Button { act("challenges/decline", ["id": c.id]) } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass)
                    .frame(width: 40, height: 40).goldPanel(12)
            }
            .accessibilityLabel("Decline")
            Button { fight(c) } label: { SwordsButton(gold: true) }.accessibilityLabel("Fight")
        }
        .padding(14)
        .background(LinearGradient(colors: [Theme.brass.opacity(0.16), Theme.field], startPoint: .leading, endPoint: .trailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.55), lineWidth: 1))
        .shadow(color: Theme.brass.opacity(0.15), radius: 12)
    }

    private func requests(_ list: [Social.Person]) -> some View {
        panel("Friend requests", count: list.count) {
            ForEach(list) { p in
                Button { viewing = p } label: {
                    HStack(spacing: 12) {
                        Avatar(id: p.avatar, size: 40)
                        (Text(p.name).font(.chakra(15)).foregroundColor(Theme.fg) + Text(" sent you a friend request"))
                            .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass)
                    }
                    .padding(.vertical, 8).contentShape(Rectangle())
                    .overlay(alignment: .bottom) { if p != list.last { Rectangle().fill(Theme.brass.opacity(0.1)).frame(height: 1) } }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func friends(_ list: [Social.Person]) -> some View {
        panel("Friends", count: list.count) {
            ForEach(list) { p in
                row(p, subtitle: Text("Level \(p.level) · ") + seen(p), last: p == list.last) {
                    Button { challenge(p) } label: { SwordsButton(gold: false) }
                        .accessibilityLabel("Battle \(p.name)")
                }
                .contentShape(Rectangle())
                .onTapGesture { friendCard = p }
                .contextMenu {
                    Button(role: .destructive) { act("friends/remove", ["name": p.name]) } label: {
                        Label("Remove friend", systemImage: "person.badge.minus")
                    }
                }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            HStack(spacing: -14) {
                ForEach(["volt", "fang", "goliath"], id: \.self) { Avatar(id: $0, size: 64) }
            }
            Text("No friends yet").font(.chakra(22)).foregroundColor(Theme.fg).padding(.top, 8)
            Text("Add someone by their username, then challenge them straight from here.")
                .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center).frame(maxWidth: 270)
            if let me = store.profile?.username {
                (Text("Your username is ").foregroundColor(Theme.muted) + Text(me).font(.chakra(13)).foregroundColor(Theme.brass))
                    .font(.barlow(13)).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 70)
    }

    private func panel<Content: View>(_ title: String, count: Int, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                Spacer()
                Text("\(count)").font(.barlow(12)).foregroundColor(Theme.muted)
            }
            .padding(.bottom, 4)
            content()
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 2)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    private func row<Buttons: View>(_ p: Social.Person, subtitle: Text, last: Bool, @ViewBuilder buttons: () -> Buttons) -> some View {
        HStack(spacing: 12) {
            Avatar(id: p.avatar, size: 44, online: p.online)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(.chakra(16)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                subtitle.font(.barlow(13)).foregroundColor(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            buttons()
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Theme.brass.opacity(0.1)).frame(height: 1) } }
    }

    private func seen(_ p: Social.Person) -> Text {
        if p.online { return Text("Online").foregroundColor(Theme.online) }
        guard let ms = p.seen else { return Text("Offline") }
        let mins = Int(Date().timeIntervalSince1970 - ms / 1000) / 60
        switch mins {
        case ..<60: return Text("\(max(mins, 1))m ago")
        case ..<1440: return Text("\(mins / 60)h ago")
        case ..<2880: return Text("Yesterday")
        default: return Text("\(mins / 1440)d ago")
        }
    }

    // MARK: actions

    private func add() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        act("friends", ["name": n]) { name = "" }
    }

    private func act(_ path: String, _ body: [String: Any], then done: @escaping () -> Void = {}) {
        run {
            let msg = try await store.socialAction(path, body)
            note = msg; noteIsError = false
            done()
        }
    }

    private func challenge(_ p: Social.Person) {
        run {
            let _: MatchView = try await API.call("friends/challenge", token: store.token, body: ["name": p.name])
            note = nil
            battle = true
        }
    }

    private func fight(_ c: Social.Challenge) {
        run {
            let _: MatchView = try await API.call("matches/join", token: store.token, body: ["code": c.code])
            note = nil
            battle = true
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        Task { @MainActor in
            do { try await work() }
            catch { note = error.localizedDescription; noteIsError = true; await store.loadSocial() }
            busy = false
        }
    }
}

// The 40-point square battle button: crossed swords, solid gold (answer a challenge) or gold outline (send one).
struct SwordsButton: View {
    let gold: Bool
    var body: some View {
        Swords().fill(gold ? Color(hex: 0x1A0D05) : Theme.brass).frame(width: 20, height: 20)
            .frame(width: 40, height: 40)
            .background {
                if gold {
                    RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)],
                                                                            startPoint: .top, endPoint: .bottom))
                        .shadow(color: Color(hex: 0xE0A12A).opacity(0.35), radius: 8, y: 5)
                } else {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.ink.opacity(0.6))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
                }
            }
    }
}

// Two crossed swords, drawn on a 24×24 grid: blade, cross guard, grip and pommel, then mirrored.
struct Swords: Shape {
    func path(in rect: CGRect) -> Path {
        var one = Path()
        one.addLines([CGPoint(x: 7.45, y: 14.85), CGPoint(x: 18.15, y: 4.15), CGPoint(x: 21, y: 3),
                      CGPoint(x: 19.85, y: 5.85), CGPoint(x: 9.15, y: 16.55)])
        one.closeSubpath()
        var bars = Path()
        bars.move(to: CGPoint(x: 5.4, y: 14.4)); bars.addLine(to: CGPoint(x: 9.6, y: 18.6))
        bars.move(to: CGPoint(x: 4.6, y: 19.4)); bars.addLine(to: CGPoint(x: 7.3, y: 16.7))
        one.addPath(bars.strokedPath(StrokeStyle(lineWidth: 2.2, lineCap: .round)))
        one.addEllipse(in: CGRect(x: 2.2, y: 18.8, width: 3, height: 3))
        var both = one
        both.addPath(one.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 24, ty: 0)))
        return both.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24)
            .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}

// A card's art in a circle, ringed in the character's colour; the green dot means online.
struct Avatar: View {
    let id: String
    var size: CGFloat = 44
    var online = false

    var body: some View {
        let ring = CardBook.card(id).flatMap { UInt32($0.color.dropFirst(), radix: 16) }.map { Color(hex: $0) } ?? Theme.brass
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let img = Art.image(id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel }
            }
            .frame(width: size, height: size)
            .background(Color(hex: 0x02060F))
            .clipShape(Circle())
            .overlay(Circle().stroke(ring, lineWidth: max(1.5, size / 30)))
            if online {
                Circle().fill(Theme.online).frame(width: 12, height: 12)
                    .overlay(Circle().stroke(Theme.ink, lineWidth: 2))
                    .accessibilityLabel("Online")
            }
        }
        .frame(width: size, height: size)
    }
}

extension Theme {
    static let online = Color(hex: 0x3FF0A0)
}

// Someone who sent you a friend request: their picture, stats and team, with Ignore / Accept.
struct PlayerSheet: View {
    struct Player: Decodable {
        let name: String
        let level: Int
        let avatar: String
        let since: Double
        let wins: Int
        let team: [String]
        let cards: Int
        let campaign: String
    }
    @EnvironmentObject var store: GameStore
    let name: String
    let onAnswer: ((_ accept: Bool) -> Void)?   // nil: a friend's profile, nothing to answer
    @State private var player: Player?
    @State private var error: String?

    var body: some View {
        ZStack {
            Color(hex: 0x0E0C18).ignoresSafeArea()
            if let p = player {
                VStack(spacing: 12) {
                    ZStack(alignment: .bottom) {
                        Avatar(id: p.avatar, size: 100)
                        Text("LV \(p.level)").font(.chakra(13)).foregroundColor(Theme.brass)
                            .padding(.horizontal, 10).padding(.vertical, 2)
                            .background(Theme.ink, in: Capsule()).overlay(Capsule().stroke(Theme.brass, lineWidth: 1))
                            .offset(y: 8)
                    }
                    VStack(spacing: 3) {
                        Text(p.name).font(.chakra(26)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
                        Text("\(onAnswer == nil ? "" : "wants to be friends · ")Playing since \(Date(timeIntervalSince1970: p.since / 1000).formatted(.dateTime.month(.abbreviated).year()))")
                            .font(.barlow(14)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    }
                    .padding(.top, 8)
                    HStack(spacing: 8) {
                        stat("\(p.wins)", "Wins"); stat(p.campaign, "Campaign"); stat("\(p.cards)/\(CardBook.all.count)", "Cards")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Their team").font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                        HStack(spacing: 8) {
                            ForEach(p.team, id: \.self) { id in
                                if let card = CardBook.card(id) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Group { if let img = Art.image(id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel } }
                                            .frame(maxWidth: .infinity).aspectRatio(1.3, contentMode: .fit)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                        Text(card.name).font(.chakra(13)).foregroundColor(Theme.fg).lineLimit(1)
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }
                    .padding(14)
                    .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
                    if let onAnswer { HStack(spacing: 10) {
                        Button { onAnswer(false) } label: {
                            Text("Ignore").font(.chakra(14)).tracking(1.6).textCase(.uppercase).foregroundColor(Theme.muted)
                                .frame(maxWidth: .infinity).frame(height: 44)
                                .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.muted.opacity(0.5), lineWidth: 1))
                        }
                        Button("Accept") { onAnswer(true) }.buttonStyle(GoldButton(height: 44))
                    }
                    .padding(.top, 4) }
                }
                .padding(.horizontal, 20).padding(.top, 24)
            } else if let error {
                Text(error).font(.barlow(15, semibold: true)).foregroundColor(Theme.pink).padding(24)
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .presentationDetents([.fraction(0.78), .large])
        .presentationDragIndicator(.visible)
        .task {
            do { player = try await API.call("players/\(name)", token: store.token) }
            catch { self.error = error.localizedDescription }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.chakra(20)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.barlow(12)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12).padding(.horizontal, 6)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }
}
