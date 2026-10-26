import SwiftUI

// Friends: add someone by username, answer requests and challenges, and send a battle to anyone on the list.
struct SocialTab: View {
    @EnvironmentObject var store: GameStore
    @State private var name = ""
    @State private var note: String?          // the server's last reply to an action
    @State private var noteIsError = false
    @State private var busy = false
    @State private var battle = false

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
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
                Text("\(c.name) challenged you").font(.chakra(17)).foregroundColor(Theme.fg).lineLimit(2)
            }
            Spacer(minLength: 4)
            Button { act("challenges/decline", ["id": c.id]) } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass)
                    .frame(width: 40, height: 40).goldPanel(12)
            }
            .accessibilityLabel("Decline")
            Button("Fight") { fight(c) }.buttonStyle(GoldButton(height: 40)).frame(width: 90)
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
                row(p, subtitle: Text("Level \(p.level)"), last: p == list.last) {
                    Button("Ignore") { act("friends/remove", ["name": p.name]) }.buttonStyle(OutlineButton(color: Theme.muted))
                    Button("Accept") { act("friends", ["name": p.name]) }.buttonStyle(GoldButton(height: 40)).frame(width: 96)
                }
            }
        }
    }

    private func friends(_ list: [Social.Person]) -> some View {
        panel("Friends", count: list.count) {
            ForEach(list) { p in
                row(p, subtitle: Text("Level \(p.level) · ") + seen(p), last: p == list.last) {
                    Button { challenge(p) } label: { Label("Battle", systemImage: "bolt.fill") }
                        .buttonStyle(OutlineButton())
                }
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
