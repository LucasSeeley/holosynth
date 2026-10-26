import SwiftUI
import UIKit

// Gauntlet, full screen: lobby → fight → between fights → … → run over. Endless; one loss ends the run.
struct GauntletView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ packs: [String]?) -> Void    // cards from packs won this visit, to open on the Packs tab

    enum Phase: Equatable { case loading, lobby, fight, between, over(GauntletResult) }
    @State private var phase = Phase.loading
    @State private var home: GauntletHome?
    @State private var run: GauntletRun?
    @State private var won: GauntletResult?         // the fight just won (gold, maybe a pack)
    @State private var pending: GauntletResult?     // result waiting for the last hits to play out
    @State private var before: [Int] = []           // HP at the end of the last fight, before the heal
    @State private var packCards: [String] = []
    @State private var packType = "cyber"   // shortcut: several packs in one visit all open in the last one's wrapper
    @State private var settled = true
    @State private var error: String?
    @State private var busy = false
    @State private var board = false
    @State private var confirmEnd = false

    var body: some View {
        ZStack {
            ScreenBackground()
            switch phase {
            case .loading: ProgressView().tint(Theme.brass)
            case .lobby: lobby
            case .fight: fight
            case .between: between
            case .over(let r): over(r)
            }
        }
        .disabled(busy)
        .task { await load() }
        .fullScreenCover(isPresented: $board) { LeaderboardView { board = false } }
    }

    // MARK: lobby

    private var lobby: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                backButton { close() }
                Text("Gauntlet").font(.chakra(24)).foregroundColor(Theme.fg)
            }
            VStack(spacing: 4) {
                Swords().fill(Theme.brass).frame(width: 42, height: 42)
                Text("Your best streak").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
                    .padding(.top, 8)
                Text("\(home?.best ?? 0)").font(.chakra(64)).foregroundColor(Theme.fg).shadow(color: Theme.brass.opacity(0.45), radius: 14)
                Text("Fight until you fall. Damage carries over;\neach win heals your team 20%.")
                    .font(.barlow(14)).foregroundColor(Color(hex: 0xA9A5C2)).multilineTextAlignment(.center).padding(.top, 6)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 20).padding(.horizontal, 14)
            .background(RadialGradient(colors: [Theme.backRed.opacity(0.45), .clear], center: .top, startRadius: 0, endRadius: 220),
                        in: RoundedRectangle(cornerRadius: 20))
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.brass.opacity(0.45), lineWidth: 1))

            panel("Rewards per win", trailing: "gold · pack every 10") { ladder }
            panel("Friends", trailing: nil) {
                VStack(spacing: 0) {
                    ForEach(home?.top ?? []) { leaderRow($0, compact: true, last: $0 == home?.top.last) }
                    Button("See leaderboard ›") { board = true }
                        .font(.barlow(13, semibold: true)).foregroundColor(Theme.brass)
                        .frame(maxWidth: .infinity, minHeight: 36, alignment: .trailing)
                }
            }
            Spacer(minLength: 0)
            errorText
            Button("Start run") { act { try await start() } }.buttonStyle(GoldButton())
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
    }

    private var ladder: some View {
        HStack {
            ForEach(1...10, id: \.self) { n in
                VStack(spacing: 4) {
                    ZStack {
                        if n == 10 {
                            RoundedRectangle(cornerRadius: 8).fill(Theme.backRed.opacity(0.35))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xFF4D5E), lineWidth: 1))
                            if let img = Art.image("pack") { Image(uiImage: img).resizable().scaledToFit().frame(height: 30) }
                        } else {
                            RoundedRectangle(cornerRadius: 8).fill(n == 1 ? Theme.brass.opacity(0.14) : Color.white.opacity(0.04))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.brass.opacity(n == 1 ? 1 : 0.18), lineWidth: 1))
                            Text("\(5 + 5 * n)").font(.chakra(13)).foregroundColor(n == 1 ? Theme.fg : Theme.muted)
                        }
                    }
                    .frame(width: 30, height: 38)
                    Text("\(n)").font(.barlow(10)).foregroundColor(Theme.muted)
                }
                if n < 10 { Spacer(minLength: 0) }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Fight 1 pays 10 gold, each win 5 more; a free pack every 10 wins")
    }

    // MARK: fight

    @ViewBuilder private var fight: some View {
        if let run, let state = run.state {
            ZStack {
                BattleBoard(state: state, you: 0, eyebrow: "Gauntlet · Fight \(run.fight)", title: "Streak \(run.wins)",
                            foeName: "The enemy", leaveLabel: "Quit",
                            leaveQuestion: "Quit this run? Your streak of \(run.wins) still counts.",
                            onMove: { from, mv, to in
                                settled = false
                                do {
                                    let r: GauntletReply = try await API.call("gauntlet/move", token: store.token,
                                                                              body: ["from": from, "move": mv, "to": to])
                                    if let p = r.profile { store.profile = p }
                                    pending = r.result
                                    self.run = r.run
                                } catch {
                                    if let h: GauntletHome = try? await API.call("gauntlet", token: store.token), let fresh = h.run { self.run = fresh }
                                    settled = true; throw error
                                }
                            },
                            onLeave: { await end() },
                            onSettled: { settled = true; finishFight() })
            }
        }
    }

    // The last hits have played out: go to the between-fights screen or the run-over screen.
    private func finishFight() {
        guard let r = pending else { return }
        pending = nil
        if r.won {
            if let run, let last = run.state { before = last.teams[0].map(\.hp) }
            if let p = r.pack { packCards += p; packType = r.packType ?? "cyber" }
            won = r
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Sound.victory.play()
            withAnimation { phase = .between }
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            Sound.defeat.play()
            withAnimation { phase = .over(r) }
        }
    }

    // MARK: between fights

    @ViewBuilder private var between: some View {
        if let run {
            VStack(spacing: 12) {
                HStack {
                    Button { confirmEnd = true } label: {
                        Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.muted)
                            .frame(width: 44, height: 44).goldPanel(12)
                    }
                    .accessibilityLabel("End run")
                    .confirmationDialog("End this run? Your streak of \(run.wins) still counts.", isPresented: $confirmEnd, titleVisibility: .visible) {
                        Button("End run", role: .destructive) { act { await end() } }
                    }
                    Spacer()
                }
                VStack(spacing: 6) {
                    Text("Gauntlet · Streak \(run.wins)").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
                    Text(run.wins > 0 ? "Fight \(run.wins) cleared!" : "Ready").font(.chakra(34)).foregroundColor(Theme.fg)
                        .shadow(color: Theme.brass.opacity(0.45), radius: 12)
                    if let g = won?.gold {
                        Label("+\(g) gold", systemImage: "circle.hexagongrid.fill").font(.chakra(20)).foregroundColor(Color(hex: 0xFFD77A))
                            .padding(.horizontal, 14).frame(height: 38)
                            .background(Theme.brass.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
                            .padding(.top, 4)
                    }
                    if won?.pack != nil {
                        Text("Free pack! It opens when you finish.").font(.barlow(14, semibold: true)).foregroundColor(Color(hex: 0xFF7884))
                    }
                    Text("This run: \(run.gold) gold").font(.barlow(13)).foregroundColor(Theme.muted)
                }
                panel("Your team", trailing: before.isEmpty ? nil : "Healed 20%", trailingColor: Color(hex: 0x3DFF8A)) {
                    HStack(spacing: 8) {
                        ForEach(Array(run.team.enumerated()), id: \.offset) { i, id in
                            hpCard(id, hp: run.hp[i], healed: before.indices.contains(i) ? run.hp[i] - before[i] : 0)
                        }
                    }
                }
                panel("Next · Fight \(run.fight)", trailing: "win for \(run.nextGold) gold") {
                    HStack(spacing: 8) {
                        ForEach(Array(run.enemies.enumerated()), id: \.offset) { _, id in
                            if let card = CardBook.card(id) {
                                VStack(alignment: .leading, spacing: 5) {
                                    art(id).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0xFF4D5E).opacity(0.5), lineWidth: 1))
                                    Text(card.name).font(.chakra(13)).foregroundColor(Theme.fg).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        ForEach(run.enemies.count..<3, id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                    }
                }
                Spacer(minLength: 0)
                errorText
                Button("Next fight") { act { try await next() } }.buttonStyle(GoldButton())
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
        }
    }

    private func hpCard(_ id: String, hp: Int, healed: Int) -> some View {
        let max = CardBook.card(id)?.hp ?? 1
        let ko = hp == 0
        let pct = CGFloat(hp - healed) / CGFloat(max), heal = CGFloat(healed) / CGFloat(max)
        return VStack(alignment: .leading, spacing: 6) {
            art(id).saturation(ko ? 0 : 1)
                .overlay { if ko { Text("KO").font(.chakra(26)).foregroundColor(Theme.pink).shadow(color: .black, radius: 1, y: 2) } }
                .overlay(alignment: .topTrailing) {
                    if healed > 0 {
                        Text("+\(healed)").font(.chakra(12)).foregroundColor(Color(hex: 0x3DFF8A))
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Theme.ink.opacity(0.85), in: RoundedRectangle(cornerRadius: 6)).padding(5)
                    }
                }
            HStack {
                Text(CardBook.card(id)?.name ?? id).font(.chakra(13)).foregroundColor(Theme.fg).lineLimit(1)
                Spacer(minLength: 2)
                Text("\(hp)").font(.chakra(13)).foregroundColor(Color(hex: 0xA9A5C2)).monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1))
                    Capsule().fill(Color(hex: 0x3DFF8A).opacity(0.45)).frame(width: g.size.width * (pct + heal))
                    Capsule().fill(pct > 0.5 ? Color(hex: 0x3DFF8A) : pct > 0.25 ? Color(hex: 0xFFB03D) : Color(hex: 0xFF4D5E))
                        .frame(width: g.size.width * pct)
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity)
        .opacity(ko ? 0.4 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ko ? "\(CardBook.card(id)?.name ?? id): knocked out" : "\(CardBook.card(id)?.name ?? id): \(hp) of \(max) HP")
    }

    // MARK: run over

    private func over(_ r: GauntletResult) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Text("Run over").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Color(hex: 0xFF7884))
            Text("\(r.streak ?? 0)").font(.chakra(96)).foregroundColor(Theme.fg).shadow(color: Theme.brass.opacity(0.5), radius: 18)
            Text("fights won").font(.barlow(16)).foregroundColor(Color(hex: 0xA9A5C2)).padding(.top, -6)
            if r.newBest == true {
                Text("New best!").font(.chakra(14)).tracking(2).textCase(.uppercase).foregroundColor(Color(hex: 0x1A0D05))
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    .background(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom),
                                in: RoundedRectangle(cornerRadius: 10))
                    .shadow(color: Theme.brass.opacity(0.4), radius: 10)
            }
            HStack(spacing: 8) {
                stat("\(r.gold ?? 0)", "Gold earned")
                stat("\(r.packs ?? 0)", (r.packs ?? 0) == 1 ? "Pack" : "Packs")
                stat("#\(r.rank ?? 1)", "Among friends")
            }
            .padding(.top, 14)
            Spacer()
            errorText
            Button("Run it back") { act { try await start() } }.buttonStyle(GoldButton())
            Button { close() } label: {
                Text("Done").frame(maxWidth: .infinity)
            }
            .buttonStyle(OutlineButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }

    // MARK: pieces

    private func backButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                .frame(width: 44, height: 44).goldPanel(12)
        }
        .accessibilityLabel("Back")
    }

    private func panel<Content: View>(_ title: String, trailing: String?, trailingColor: Color = Color(hex: 0xA9A5C2),
                                      @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                Spacer()
                if let trailing { Text(trailing).font(.barlow(12)).foregroundColor(trailingColor) }
            }
            content()
        }
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    private func art(_ id: String) -> some View {
        Group { if let img = Art.image(id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel } }
            .frame(maxWidth: .infinity).aspectRatio(1.3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10))
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

    @ViewBuilder private var errorText: some View {
        if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center).frame(maxWidth: .infinity) }
    }

    // MARK: actions

    private func act(_ work: @escaping () async throws -> Void) {
        busy = true
        Task { @MainActor in
            do { try await work(); error = nil } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    // A run left open (app closed) picks up where it was; otherwise the lobby.
    private func load() async {
        do {
            let h: GauntletHome = try await API.call("gauntlet", token: store.token)
            home = h
            if let r = h.run { run = r; phase = r.state == nil ? .between : .fight } else { phase = .lobby }
        } catch { self.error = error.localizedDescription; phase = .lobby }
    }

    private func start() async throws {
        let r: GauntletRun = try await API.call("gauntlet/start", token: store.token, body: [:])
        run = r; won = nil; before = []
        phase = r.state == nil ? .between : .fight
    }

    private func next() async throws {
        let r: GauntletRun = try await API.call("gauntlet/next", token: store.token, body: [:])
        run = r; won = nil
        phase = .fight
    }

    private func end() async {
        if let r: GauntletReply = try? await API.call("gauntlet/leave", token: store.token, body: [:]) {
            if let p = r.profile { store.profile = p }
            if let result = r.result { withAnimation { phase = .over(result) }; return }
        }
        close()
    }

    private func close() { store.pendingPackType = packType; onClose(packCards.isEmpty ? nil : packCards) }
}

// Best Gauntlet streaks, friends or everyone.
struct LeaderboardView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void
    @State private var everyone = false
    @State private var rows: [LeaderRow] = []
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                            .frame(width: 44, height: 44).goldPanel(12)
                    }
                    .accessibilityLabel("Back")
                    Text("Leaderboard").font(.chakra(24)).foregroundColor(Theme.fg)
                }
                HStack(spacing: 0) {
                    scopeButton("Friends", on: !everyone) { everyone = false }
                    scopeButton("Everyone", on: everyone) { everyone = true }
                }
                .padding(4).goldPanel(14)
                Text("Best Gauntlet streak").font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 2) { ForEach(rows) { leaderRow($0, compact: false, last: true) } }
                        .padding(6)
                        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
                        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
                }
            }
            .padding(.horizontal, 16).padding(.top, 8)
        }
        .task(id: everyone) {
            do { rows = try await API.call("leaderboard/\(everyone ? "everyone" : "friends")", token: store.token); error = nil }
            catch { self.error = error.localizedDescription }
        }
    }

    private func scopeButton(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.chakra(14)).tracking(1.6).textCase(.uppercase)
                .foregroundColor(on ? Color(hex: 0x1A0D05) : Color(hex: 0xA9A5C2))
                .frame(maxWidth: .infinity).frame(height: 40)
                .background {
                    if on {
                        RoundedRectangle(cornerRadius: 10).fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)],
                                                                                startPoint: .top, endPoint: .bottom))
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// One leaderboard line: rank (gold / silver / bronze for the top 3), picture, name, best streak.
@ViewBuilder func leaderRow(_ r: LeaderRow, compact: Bool, last: Bool) -> some View {
    let medal: UInt32 = r.rank == 1 ? 0xFFD77A : r.rank == 2 ? 0xC9C6DA : r.rank == 3 ? 0xD9895A : 0x8E8AA8
    HStack(spacing: compact ? 10 : 12) {
        Text("\(r.rank)").font(.chakra(compact ? 15 : 17)).foregroundColor(Color(hex: medal)).frame(width: compact ? 18 : 26)
        Avatar(id: r.avatar, size: compact ? 34 : 40)
        (Text(r.name) + Text(r.me && !compact ? "  (you)" : "").font(.chakra(12)).foregroundColor(Theme.brass))
            .font(.chakra(compact ? 15 : 16)).foregroundColor(r.me && compact ? Theme.brass : Theme.fg).lineLimit(1)
        Spacer(minLength: 4)
        HStack(spacing: 6) {
            Text("\(r.best)").font(.chakra(compact ? 15 : 18)).foregroundColor(Theme.fg)
            Swords().fill(Theme.muted).frame(width: compact ? 14 : 16, height: compact ? 14 : 16)
        }
    }
    .padding(.vertical, compact ? 6 : 10).padding(.horizontal, compact ? 0 : 12)
    .background {
        if r.me && !compact {
            RoundedRectangle(cornerRadius: 14).fill(Theme.brass.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
        }
    }
    .overlay(alignment: .bottom) { if compact && !last { Rectangle().fill(Theme.brass.opacity(0.1)).frame(height: 1) } }
    .accessibilityElement(children: .combine)
}

// The Play tab's Gauntlet row.
struct GauntletTile: View {
    let stats: GauntletStats
    let unlocked: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Swords().fill(unlocked ? Theme.brass : Theme.muted).frame(width: 28, height: 28)
                    .frame(width: 48, height: 48)
                    .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.brass.opacity(0.4), lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Gauntlet").font(.chakra(18)).foregroundColor(Theme.fg)
                    if unlocked {
                        (Text("Best streak ") + Text("\(stats.best)").font(.chakra(13)).foregroundColor(Theme.fg) + Text(" · #\(stats.rank) in friends"))
                            .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                    } else {
                        Label("Unlocks at level 6", systemImage: "lock.fill").font(.barlow(13)).foregroundColor(Theme.muted)
                    }
                }
                Spacer(minLength: 4)
                if unlocked {
                    Text("Play").font(.chakra(15)).tracking(2.2).textCase(.uppercase).foregroundColor(Color(hex: 0x1A0D05))
                        .frame(width: 90, height: 40)
                        .background(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom),
                                    in: RoundedRectangle(cornerRadius: 14))
                        .shadow(color: Color(hex: 0xE0A12A).opacity(0.35), radius: 8, y: 5)
                }
            }
            .padding(.leading, 14).padding(.trailing, 12).frame(height: 84)
            .background(RadialGradient(colors: [Theme.backRed.opacity(0.5), .clear], center: .leading, startRadius: 0, endRadius: 220),
                        in: RoundedRectangle(cornerRadius: 18))
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(unlocked ? 0.45 : 0.2), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!unlocked)
    }
}
