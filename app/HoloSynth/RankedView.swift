import SwiftUI
import UIKit

// Ranked, full screen: this week's standings → find a match (live, or another player's team played by the computer)
// → fight → points. Also the week's result when a week ends, and last season's reward.
struct RankedView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ pack: [String]?) -> Void

    enum Phase: Equatable { case loading, lobby, rewards, searching, found, fight, result(RankedResult), week(Ranked.Moved), season(Ranked.SeasonReward) }
    @State private var phase = Phase.loading
    @State private var view: Ranked?
    @State private var match: MatchView?          // live match
    @State private var state: BattleState?        // the fight on the board
    @State private var opp: Ranked.Opp?           // who the computer is playing as (kept until the result shows)
    @State private var pending: RankedResult?     // result waiting for the last hits to play out
    @State private var searchStart = Date()
    @State private var error: String?
    @State private var busy = false

    static let colors: [UInt32] = [0xC8834E, 0xC9D1DC, 0xFFD23D, 0x3DFFD6, 0x3D9BFF, 0xFF3D5E, 0x8CC8FF, 0xFFF3C4]
    static func color(_ rank: Int) -> Color { Color(hex: colors[max(0, min(colors.count - 1, rank))]) }

    var body: some View {
        ZStack {
            ScreenBackground()
            switch phase {
            case .loading: ProgressView().tint(Theme.brass)
            case .lobby: lobby
            case .rewards: rewards
            case .searching: searching
            case .found: found
            case .fight: fight
            case .result(let r): result(r)
            case .week(let m): week(m)
            case .season(let r): season(r)
            }
        }
        .disabled(busy)
        .task { await load() }
    }

    private func name(_ rank: Int) -> String { view?.ranks[safe: rank] ?? "Rookie" }

    // MARK: lobby

    @ViewBuilder private var lobby: some View {
        if let v = view {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    backButton { onClose(nil) }
                    Text("Ranked").font(.chakra(24)).foregroundColor(Theme.fg)
                    Spacer()
                    Button("Rewards") { phase = .rewards }.buttonStyle(OutlineButton())
                }
                HStack(spacing: 12) {
                    RankEmblem(rank: v.rank, size: 64)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(name(v.rank)).font(.chakra(22)).foregroundColor(Self.color(v.rank))
                        (Text("You're ") + Text("#\(v.place)").font(.chakra(13)).foregroundColor(placeColor(v.place))
                         + Text(" this week · ") + Text("\(v.points)").font(.chakra(13)).foregroundColor(Theme.fg) + Text(" pts"))
                            .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Week ends in").font(.barlow(11)).foregroundColor(Theme.muted)
                        TimelineView(.periodic(from: .now, by: 60)) { _ in Text(Self.left(v.weekEnds)).font(.chakra(15)).foregroundColor(Theme.fg) }
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RadialGradient(colors: [Self.color(v.rank).opacity(0.25), .clear], center: .leading, startRadius: 0, endRadius: 220),
                            in: RoundedRectangle(cornerRadius: 18))
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Self.color(v.rank).opacity(0.5), lineWidth: 1))
                HStack {
                    Text("Top 10 rank up").foregroundColor(QuestsView.green)
                    Spacer()
                    Text("11–20 stay")
                    Spacer()
                    Text(v.rank == 0 ? "Rookies can't drop" : "Bottom 10 rank down").foregroundColor(Color(hex: 0xFF7884))
                }
                .font(.barlow(11)).foregroundColor(Theme.muted).padding(.horizontal, 4)
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 1) { ForEach(v.table, id: \.place) { row($0) } }.padding(6)
                    }
                    .goldPanel(18)
                    .onAppear { proxy.scrollTo(v.place, anchor: .center) }
                }
                if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                Button("Find a match") { startSearch() }.buttonStyle(GoldButton())
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
        }
    }

    private func row(_ r: Ranked.Row) -> some View {
        HStack(spacing: 10) {
            Text("\(r.place)").font(.chakra(13)).foregroundColor(Color(hex: 0xA9A5C2)).frame(width: 24, alignment: .trailing)
            (Text(r.name).font(.chakra(14)).foregroundColor(r.me ? Color(hex: 0xFFD23D) : Theme.fg)
             + Text(r.me ? "  (you)" : "").font(.barlow(11)).foregroundColor(Color(hex: 0xA9A5C2)))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text("\(r.points)").font(.chakra(13)).foregroundColor(Theme.fg).monospacedDigit()
            Text(arrows(r.place)).font(.system(size: 10)).foregroundColor(placeColor(r.place)).frame(width: 32, alignment: .trailing)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(r.me ? Color(hex: 0xFFD23D).opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(r.me ? Color(hex: 0xFFD23D).opacity(0.5) : .clear, lineWidth: 1))
        .overlay(alignment: .top) {
            if r.place == 11 || r.place == 21 {
                Rectangle().fill((r.place == 11 ? QuestsView.green : Color(hex: 0xFF7884)).opacity(0.5)).frame(height: 1).offset(y: -1)
            }
        }
        .id(r.place)
        .accessibilityElement(children: .combine)
    }

    private func arrows(_ place: Int) -> String {
        place == 1 ? "▲▲▲" : place <= 3 ? "▲▲" : place <= 10 ? "▲" : place <= 20 ? "–" : (view?.rank == 0 ? "–" : "▼")
    }

    private func placeColor(_ place: Int) -> Color {
        place <= 10 ? QuestsView.green : place <= 20 || view?.rank == 0 ? Theme.muted : Color(hex: 0xFF7884)
    }

    // MARK: rewards

    @ViewBuilder private var rewards: some View {
        if let v = view {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    backButton { phase = .lobby }
                    Text("Season rewards").font(.chakra(24)).foregroundColor(Theme.fg)
                }
                TimelineView(.periodic(from: .now, by: 60)) { _ in
                    (Text("Season \(v.season) ends in ") + Text(Self.left(v.seasonEnds)).font(.chakra(13)).foregroundColor(Theme.fg)
                     + Text(". You get the reward for the highest rank you reach this season."))
                        .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                }
                VStack(spacing: 0) {
                    ForEach(v.rewards.indices, id: \.self) { i in
                        HStack(spacing: 10) {
                            RankEmblem(rank: i, size: 34)
                            Text(name(i)).font(.chakra(15)).foregroundColor(Self.color(i))
                            if i == v.best { Text("best").font(.barlow(11)).foregroundColor(QuestsView.green) }
                            Spacer()
                            if let pack = v.rewards[i].pack, let img = Art.pack(pack) { Image(uiImage: img).resizable().scaledToFit().frame(height: 34) }
                            Label(v.rewards[i].gold.formatted(), systemImage: "circle.hexagongrid.fill").font(.chakra(14)).foregroundColor(HuntView.gold)
                        }
                        .padding(.vertical, 7)
                        .overlay(alignment: .bottom) { if i < v.rewards.count - 1 { Rectangle().fill(Theme.brass.opacity(0.08)).frame(height: 1) } }
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 4).goldPanel(18)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Every week").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                    Text("#1 ranks up 3 · #2–3 up 2 · #4–10 up 1 · #11–20 stay · #21–30 rank down 1").font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                    Text("Win +25 · Lose −20 that week. Everyone's in the standings, so skipping a week can drop you. A new season drops everyone 2 ranks.")
                        .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).goldPanel(18)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.top, 8)
        }
    }

    // MARK: searching / found

    private var searching: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                Circle().stroke(Self.color(view?.rank ?? 0).opacity(0.5), lineWidth: 2).frame(width: 200, height: 200)
                Circle().stroke(Self.color(view?.rank ?? 0).opacity(0.25), lineWidth: 2).frame(width: 148, height: 148)
                TimelineView(.animation) { t in
                    Circle().trim(from: 0, to: 0.18).stroke(Self.color(view?.rank ?? 0), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .frame(width: 208, height: 208)
                        .rotationEffect(.degrees(t.date.timeIntervalSinceReferenceDate * 240))
                }
                RankEmblem(rank: view?.rank ?? 0, size: 100)
            }
            Text("Finding a match…").font(.chakra(24)).foregroundColor(Theme.fg)
            TimelineView(.periodic(from: .now, by: 1)) { t in
                let s = Int(t.date.timeIntervalSince(searchStart))
                Text(String(format: "%d:%02d", s / 60, s % 60)).font(.chakra(18)).foregroundColor(Color(hex: 0xA9A5C2))
            }
            Text("Looking for a player to battle live. If nobody's on,\nyou'll face a computer player or another player's team.")
                .font(.barlow(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            Button { cancelSearch() } label: { Text("Cancel").frame(width: 160) }.buttonStyle(OutlineButton())
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder private var found: some View {
        let myTeam = store.profile?.team ?? []
        let foeName = match.map { $0.players[1 - $0.you] ?? "Opponent" } ?? view?.run?.opp.name ?? "Opponent"
        let foeTeam = match.flatMap { m in m.state?.teams[1 - m.you].map(\.id) } ?? view?.run?.opp.team ?? []
        VStack(spacing: 16) {
            Spacer()
            Text("Match found").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
            HStack(spacing: 10) {
                side(store.profile?.username ?? "You", rank: view?.rank, team: myTeam, me: true)
                Text("VS").font(.chakra(22)).foregroundColor(Theme.pink)
                side(foeName, rank: match == nil ? view?.run?.opp.rank : nil, team: foeTeam, me: false)
            }
            Text(match != nil ? "Live match: you're both playing now."
                 : opp?.bot == true ? "\(foeName) is a computer player."
                 : "\(foeName) isn't online: you're facing their team, played by the computer.")
                .font(.barlow(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            (Text("Win ") + Text("+25").font(.chakra(14)).foregroundColor(QuestsView.green)
             + Text(" · Lose ") + Text("−20").font(.chakra(14)).foregroundColor(Color(hex: 0xFF7884)))
                .font(.barlow(14)).foregroundColor(Color(hex: 0xA9A5C2))
            Button("Battle") { phase = .fight }.buttonStyle(GoldButton())
            Spacer()
        }
        .padding(16)
    }

    private func side(_ name: String, rank: Int?, team: [String], me: Bool) -> some View {
        VStack(spacing: 8) {
            Avatar(id: team.first ?? "volt", size: 56)
            Text(name).font(.chakra(17)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
            if let rank {
                HStack(spacing: 4) { RankEmblem(rank: rank, size: 26); Text(self.name(rank)).font(.chakra(12)).foregroundColor(Self.color(rank)) }
            }
            HStack(spacing: 4) {
                ForEach(team, id: \.self) { id in
                    Group { if let img = Art.image(id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel } }
                        .frame(width: 40, height: 32).clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14).padding(.horizontal, 8)
        .goldPanel(18, lit: me)
    }

    // MARK: fight

    @ViewBuilder private var fight: some View {
        if let m = match, let s = m.state {
            BattleBoard(state: s, you: m.you, eyebrow: "Ranked", title: "vs \(m.players[1 - m.you] ?? "Opponent")",
                        foeName: m.players[1 - m.you] ?? "Opponent", leaveLabel: "Give up", leaveQuestion: "Give up? It counts as a loss.",
                        onMove: { from, mv, to in
                            do {
                                let next: MatchView = try await API.call("matches/\(m.id)/move", token: store.token, body: ["from": from, "move": mv, "to": to])
                                match = next
                            } catch {
                                if let fresh: MatchView = try? await API.call("matches/\(m.id)", token: store.token) { match = fresh }
                                throw error
                            }
                        },
                        onLeave: {
                            let _: [String: Bool]? = try? await API.call("matches/\(m.id)/leave", token: store.token, body: [:])
                            await liveOver(won: false)
                        },
                        onSettled: { if let w = match?.state?.winner { Task { await liveOver(won: w == m.you) } } })
                .task(id: m.id) { await poll(m.id) }
        } else if let s = state, let opp = opp ?? view?.run?.opp {
            BattleBoard(state: s, you: 0, eyebrow: "Ranked", title: "vs \(opp.name)", foeName: opp.name,
                        leaveLabel: "Give up", leaveQuestion: "Give up? It counts as a loss.",
                        onMove: { from, mv, to in
                            do {
                                let r: RankedMoveReply = try await API.call("ranked/move", token: store.token, body: ["from": from, "move": mv, "to": to])
                                if let p = r.profile { store.profile = p }
                                if let v = r.view { view = v }
                                pending = r.result
                                if let st = r.state { state = st }
                            } catch {
                                await load(keepPhase: true)
                                throw error
                            }
                        },
                        onLeave: {
                            if let r: RankedMoveReply = try? await API.call("ranked/leave", token: store.token, body: [:]) {
                                if let p = r.profile { store.profile = p }
                                if let v = r.view { view = v }
                                if let res = r.result { show(res) } else { phase = .lobby }
                            }
                        },
                        onSettled: { if let r = pending { pending = nil; show(r) } })
        }
    }

    // Live match: check for the other player's moves every 2 seconds.
    private func poll(_ id: Int) async {
        while !Task.isCancelled, phase == .fight {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let m = match, m.status == "active", m.state?.turn != m.you else { continue }
            if let fresh: MatchView = try? await API.call("matches/\(id)", token: store.token), fresh != match { match = fresh }
        }
    }

    private func liveOver(won: Bool) async {
        let before = view?.place ?? 0, points = view?.points ?? 0
        await store.refresh()
        if let v: Ranked = try? await API.call("ranked", token: store.token) { view = v }
        match = nil
        let v = view
        show(RankedResult(won: won, delta: (v?.points ?? points) - points, points: v?.points ?? points, from: before, place: v?.place ?? before,
                          gold: won ? 150 : 0, xp: won ? 100 : 0))
    }

    private func show(_ r: RankedResult) {
        UINotificationFeedbackGenerator().notificationOccurred(r.won ? .success : .error)
        (r.won ? Sound.victory : Sound.defeat).play()
        withAnimation { phase = .result(r) }
    }

    // MARK: results

    private func result(_ r: RankedResult) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Text(r.won ? "Victory" : "Defeat").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase)
                .foregroundColor(r.won ? QuestsView.green : Color(hex: 0xFF7884))
            Text(r.delta >= 0 ? "+\(r.delta)" : "\(r.delta)").font(.chakra(52))
                .foregroundColor(r.won ? QuestsView.green : Color(hex: 0xFF7884))
            (Text("points this week · ") + Text("\(r.points)").font(.chakra(15)).foregroundColor(Theme.fg) + Text(" total"))
                .font(.barlow(15)).foregroundColor(Color(hex: 0xA9A5C2))
            HStack(spacing: 10) {
                Text("#\(r.from)").font(.chakra(15)).foregroundColor(Color(hex: 0xA9A5C2))
                Image(systemName: "arrow.right").font(.system(size: 13, weight: .bold)).foregroundColor(Color(hex: 0xA9A5C2))
                Text("#\(r.place)").font(.chakra(20)).foregroundColor(placeColor(r.place))
                Text(outlook(r.place)).font(.barlow(13)).foregroundColor(placeColor(r.place))
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(placeColor(r.place).opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(placeColor(r.place).opacity(0.45), lineWidth: 1))
            if r.won {
                HStack(spacing: 8) { statBox("+\(r.gold)", "Gold"); statBox("+\(r.xp)", "XP") }.padding(.top, 8)
            }
            Spacer()
            Button("Play again") { startSearch() }.buttonStyle(GoldButton())
            Button { phase = .lobby } label: { Text("Done").frame(maxWidth: .infinity) }.buttonStyle(OutlineButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }

    private func outlook(_ place: Int) -> String {
        let n = place == 1 ? 3 : place <= 3 ? 2 : place <= 10 ? 1 : place <= 20 || view?.rank == 0 ? 0 : -1
        return ["on track to rank down", "on track to stay", "on track to rank up", "on track to rank up twice", "on track to rank up 3 times"][n + 1]
    }

    private func statBox(_ v: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.chakra(20)).foregroundColor(Theme.fg)
            Text(label).font(.barlow(12)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12).goldPanel(14)
    }

    private func week(_ m: Ranked.Moved) -> some View {
        let change = m.to - m.from
        return VStack(spacing: 12) {
            Spacer()
            Text("Week results").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(QuestsView.green)
            Text("You finished #\(m.place)").font(.chakra(30)).foregroundColor(Theme.fg)
            Text(change > 1 ? "Ranked up \(change == 2 ? "twice" : "3 times")" : change == 1 ? "Ranked up" : change < 0 ? "Ranked down" : "Held your rank")
                .font(.barlow(15)).foregroundColor(Color(hex: 0xA9A5C2))
            HStack(spacing: 12) {
                if change != 0 {
                    RankEmblem(rank: m.from, size: 64).opacity(0.5)
                    Image(systemName: "arrow.right").font(.system(size: 18, weight: .bold)).foregroundColor(Color(hex: 0xA9A5C2))
                }
                RankEmblem(rank: m.to, size: 120)
            }
            .padding(.vertical, 10)
            Text(name(m.to)).font(.chakra(28)).foregroundColor(Self.color(m.to))
            Text("A new week starts now.").font(.barlow(13)).foregroundColor(Theme.muted)
            Spacer()
            Button("Let's go") { seen() }.buttonStyle(GoldButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
        .onAppear { (change > 0 ? Sound.legendary : change < 0 ? Sound.defeat : Sound.rare).play() }
    }

    private func season(_ r: Ranked.SeasonReward) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Text("Season \(r.season) rewards").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
            RankEmblem(rank: r.rank, size: 120)
            (Text("You reached ") + Text(name(r.rank)).foregroundColor(Self.color(r.rank))).font(.chakra(26)).foregroundColor(Theme.fg)
            Label(r.gold.formatted() + " gold", systemImage: "circle.hexagongrid.fill").font(.chakra(20)).foregroundColor(HuntView.gold)
            if let pack = r.pack, let img = Art.pack(pack) { Image(uiImage: img).resizable().scaledToFit().frame(height: 160) }
            Text("A new season starts now: everyone drops 2 ranks.").font(.barlow(13)).foregroundColor(Theme.muted)
            Spacer()
            Button("Claim") { claim() }.buttonStyle(GoldButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }

    // MARK: actions

    private func backButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                .frame(width: 44, height: 44).goldPanel(12)
        }
        .accessibilityLabel("Back")
    }

    static func left(_ ms: Double) -> String {
        let m = max(0, Int(ms / 1000 - Date().timeIntervalSince1970)) / 60
        return m >= 1440 ? "\(m / 1440)d \(m % 1440 / 60)h" : m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    private func load(keepPhase: Bool = false) async {
        do {
            let v: Ranked = try await API.call("ranked", token: store.token)
            view = v
            if let run = v.run { state = run.state; opp = run.opp }
            if keepPhase { return }
            if let r = v.reward { phase = .season(r) }
            else if let m = v.moved { phase = .week(m) }
            else if let id = v.liveMatch, let m: MatchView = try? await API.call("matches/\(id)", token: store.token) { match = m; phase = .fight }
            else if v.run != nil { phase = .fight }
            else { phase = .lobby }
        } catch { self.error = error.localizedDescription; if !keepPhase { phase = .lobby } }
    }

    private func startSearch() {
        error = nil
        searchStart = Date()
        phase = .searching
        Task { @MainActor in
            while phase == .searching {
                do {
                    let gone = Date().timeIntervalSince(searchStart) > 15
                    let r: RankedSearchReply = try await API.call(gone ? "ranked/ghost" : "ranked/search", token: store.token, body: [:])
                    view = r.view
                    if let id = r.view.liveMatch {
                        match = try await API.call("matches/\(id)", token: store.token)
                        if phase == .searching { withAnimation { phase = .found } }
                        return
                    }
                    if let run = r.view.run {
                        state = run.state
                        opp = run.opp
                        if phase == .searching { withAnimation { phase = .found } }
                        return
                    }
                } catch {
                    self.error = error.localizedDescription
                    phase = .lobby
                    return
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func cancelSearch() {
        phase = .lobby
        Task { let _: [String: Bool]? = try? await API.call("ranked/cancel", token: store.token, body: [:]) }
    }

    private func seen() {
        Task { @MainActor in
            let _: [String: Bool]? = try? await API.call("ranked/seen", token: store.token, body: [:])
            await load()
            await store.refresh()
        }
    }

    private func claim() {
        busy = true
        Task { @MainActor in
            do {
                let r: RankedClaimReply = try await API.call("ranked/claim", token: store.token, body: [:])
                store.profile = r.profile
                if let cards = r.cards {
                    store.pendingPackType = r.type ?? "omni"
                    store.pendingHolo = r.holo ?? []
                    onClose(cards)
                } else { await load() }
            } catch { self.error = error.localizedDescription; await load() }
            busy = false
        }
    }
}

// Rank emblem: a shield in the rank's colour (the Holo rank in rainbow foil), with a crown cut in for the top three.
struct RankEmblem: View {
    let rank: Int
    var size: CGFloat = 64

    var body: some View {
        let c = RankedView.color(rank)
        let fill: AnyShapeStyle = rank == 6 ? AnyShapeStyle(LinearGradient(colors: HoloFoil.rainbow, startPoint: .topLeading, endPoint: .bottomTrailing))
                                            : AnyShapeStyle(c)
        ZStack {
            Shield().fill(RadialGradient(colors: [c.opacity(0.55), Color(hex: 0x0E0C18)], center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: size * 0.6))
            Shield().stroke(fill, lineWidth: size * 0.045)
            Shield().fill(fill).scaleEffect(0.55).offset(y: -size * 0.02).opacity(0.9)
            if rank >= 5 {
                Crown().fill(Color(hex: 0x12111D)).frame(width: size * 0.26, height: size * 0.12).offset(y: -size * 0.08)
            }
        }
        .frame(width: size, height: size * 1.1)
        .accessibilityHidden(true)
    }
}

private struct Shield: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        p.move(to: CGPoint(x: r.midX, y: r.minY + h * 0.04))
        p.addLine(to: CGPoint(x: r.minX + w * 0.88, y: r.minY + h * 0.18))
        p.addLine(to: CGPoint(x: r.minX + w * 0.88, y: r.minY + h * 0.42))
        p.addQuadCurve(to: CGPoint(x: r.midX, y: r.minY + h * 0.82), control: CGPoint(x: r.minX + w * 0.88, y: r.minY + h * 0.7))
        p.addQuadCurve(to: CGPoint(x: r.minX + w * 0.12, y: r.minY + h * 0.42), control: CGPoint(x: r.minX + w * 0.12, y: r.minY + h * 0.7))
        p.addLine(to: CGPoint(x: r.minX + w * 0.12, y: r.minY + h * 0.18))
        p.closeSubpath()
        return p
    }
}

private struct Crown: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.25, y: r.minY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY * 0.6))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.75, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}


extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
