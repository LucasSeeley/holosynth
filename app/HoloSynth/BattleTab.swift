import SwiftUI
import UIKit

// Battle a friend: one player makes an invite code, the other types it in.
// Turns alternate; tap one of your ready cards, choose its move, then tap the enemy card to hit.
struct BattleTab: View {
    @EnvironmentObject var store: GameStore
    @State private var match: MatchView?
    @State private var codeInput = ""
    @State private var busy = false
    @State private var error: String?
    @State private var selected: Int?           // my card index
    @State private var move: String?            // "basic" | "special"
    @State private var hit: (side: Int, index: Int)?
    @State private var confirmLeave = false

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar()
            ZStack {
                ScreenBackground()
                lobby
            }
        }
        // The code screen and the match itself take over the whole screen: no tabs mid-battle.
        .fullScreenCover(isPresented: Binding(get: { match != nil }, set: { if !$0 { match = nil } })) {
            ZStack {
                ScreenBackground()
                if let match, match.status != "waiting", let state = match.state { board(match, state) }
                else if let match { waiting(match) }
            }
        }
        .task { await loadCurrent() }
        .task(id: match?.id) { await poll() }
    }

    // MARK: lobby

    private var lobby: some View {
        VStack(spacing: 18) {
            Spacer()
            HStack(spacing: 10) {
                ForEach(store.profile?.team ?? [], id: \.self) { id in
                    if let card = CardBook.card(id) { CardView(card: card) }
                }
            }
            .padding(.horizontal, 8)
            Text("Your team · change it in Cards").font(.barlow(14)).foregroundColor(Theme.muted)
            Button("Create a match") {
                Task { await run { match = try await API.call("matches", token: store.token, body: [:]) } }
            }
            .buttonStyle(GoldButton())
            .padding(.top, 8)
            HStack(spacing: 10) {
                HStack(spacing: 12) {
                    Image(systemName: "number").font(.system(size: 17, weight: .medium)).foregroundColor(Theme.brass)
                    TextField("", text: $codeInput, prompt: Text("Friend's code").foregroundColor(Theme.muted))
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .font(.chakra(17, semibold: true)).foregroundColor(Theme.fg)
                }
                .padding(.horizontal, 16).frame(height: 54)
                .goldPanel()
                Button("Join") {
                    Task { await run { match = try await API.call("matches/join", token: store.token, body: ["code": codeInput]) } }
                }
                .buttonStyle(OutlineButton()).frame(height: 54)
                .disabled(codeInput.count < 5)
            }
            errorText
            Spacer()
        }
        .padding(20)
        .disabled(busy)
    }

    private func waiting(_ m: MatchView) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Text("Send this code to a friend").sectionTitle()
            Text(m.code).font(.chakra(54)).tracking(6).foregroundColor(Theme.fg)
                .shadow(color: Theme.brass.opacity(0.5), radius: 14)
                .textSelection(.enabled)
                .padding(.horizontal, 24).padding(.vertical, 8)
                .goldPanel(16, lit: true)
            ShareLink(item: "Battle me in HoloSynth! Code: \(m.code)") {
                Label("Share code", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(GoldButton(height: 50)).frame(width: 220)
            ProgressView().tint(Theme.brass)
            Text("Waiting for them to join…").font(.barlow(14)).foregroundColor(Theme.muted)
            Button("Cancel") { Task { await leave() } }.buttonStyle(OutlineButton(color: Theme.pink))
            errorText
            Spacer()
        }
        .padding(20)
    }

    // MARK: board

    private func board(_ m: MatchView, _ s: BattleState) -> some View {
        let me = m.you, foe = 1 - m.you
        let myTurn = s.turn == me && s.winner == nil
        return VStack(spacing: 12) {
            row(s, side: foe, mine: false, label: m.players[foe] ?? "Opponent", tappable: myTurn && move != nil)
            Text(status(m, s)).font(.chakra(17, semibold: true)).foregroundColor(myTurn ? Theme.brass : Theme.muted)
                .multilineTextAlignment(.center).frame(maxWidth: .infinity)
            if let last = s.log.last { Text(describe(last, m)).font(.barlow(14)).foregroundColor(Theme.muted) }
            row(s, side: me, mine: true, label: "You", tappable: myTurn)
            if myTurn, let sel = selected, let card = CardBook.card(s.teams[me][sel].id) { movePicker(card, unit: s.teams[me][sel]) }
            errorText
            Spacer(minLength: 0)
            if s.winner != nil {
                Button("Back") { match = nil; Task { await store.refresh() } }
                    .buttonStyle(GoldButton(height: 50)).frame(width: 200)
            } else {
                Button("Forfeit") { confirmLeave = true }.font(.chakra(13, semibold: true)).tracking(1.5).foregroundColor(Theme.pink)
                    .confirmationDialog("Forfeit this match? Your opponent wins.", isPresented: $confirmLeave, titleVisibility: .visible) {
                        Button("Forfeit", role: .destructive) { Task { await leave() } }
                    }
            }
        }
        .padding(12)
        .onChange(of: s.log.count) { _ in
            if let last = s.log.last { flash(side: 1 - last.p, index: last.to) }
        }
    }

    private func row(_ s: BattleState, side: Int, mine isMine: Bool, label: String, tappable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.chakra(12, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass.opacity(0.8))
            HStack(spacing: 8) {
                ForEach(Array(s.teams[side].enumerated()), id: \.offset) { i, unit in
                    if let card = CardBook.card(unit.id) {
                        let ko = unit.hp == 0
                        let acted = s.acted[side][i]
                        CardView(card: card, hpNow: unit.hp, cooldown: unit.cd)
                            .saturation(ko ? 0 : 1)
                            .opacity(ko ? 0.35 : (isMine && acted ? 0.55 : 1))
                            .overlay { if ko { Text("KO").font(.chakra(28)).foregroundColor(Theme.pink) } }
                            .overlay {
                                if isMine && selected == i {
                                    RoundedRectangle(cornerRadius: 8).stroke(Theme.brass, lineWidth: 3)
                                        .shadow(color: Theme.brass, radius: 8)
                                }
                            }
                            .offset(x: hit.map { $0.side == side && $0.index == i } == true ? 6 : 0)
                            .onTapGesture {
                                guard tappable, !ko else { return }
                                if isMine { if !acted { selected = i; move = nil } }
                                else if let from = selected, let mv = move { attack(from: from, move: mv, to: i) }
                            }
                    }
                }
            }
        }
    }

    private func movePicker(_ card: Card, unit: Unit) -> some View {
        HStack(spacing: 10) {
            moveButton("basic", title: card.basic.name, dmg: card.basic.dmg, enabled: true)
            moveButton("special", title: card.special.name, dmg: card.special.dmg, enabled: unit.cd == 0,
                       note: unit.cd > 0 ? "ready in \(unit.cd)" : nil)
        }
    }

    private func moveButton(_ id: String, title: String, dmg: Int, enabled: Bool, note: String? = nil) -> some View {
        Button { move = id } label: {
            VStack(spacing: 2) {
                Text(title).font(.chakra(15)).lineLimit(1).minimumScaleFactor(0.7)
                Text(note ?? "\(dmg) damage").font(.barlow(13, semibold: true)).monospacedDigit()
            }
            .frame(maxWidth: .infinity).padding(10)
            .foregroundColor(move == id ? Color(hex: 0x1A0D05) : Theme.fg)
            .background {
                if move == id {
                    RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)],
                                                                          startPoint: .top, endPoint: .bottom))
                } else {
                    Color.clear.goldPanel(12)
                }
            }
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    @ViewBuilder private var errorText: some View {
        if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center) }
    }

    // MARK: text

    private func status(_ m: MatchView, _ s: BattleState) -> String {
        if let w = s.winner { return w == m.you ? "You won! +50 gold, +25 XP" : "You lost. Better luck next time." }
        if s.turn != m.you { return "\(m.players[1 - m.you] ?? "Opponent")'s turn…" }
        if selected == nil { return "Your turn: pick one of your cards" }
        if move == nil { return "Choose a move" }
        return "Now tap the enemy card to hit"
    }

    private func describe(_ e: LogEntry, _ m: MatchView) -> String {
        guard let s = m.state,
              let attacker = CardBook.card(s.teams[e.p][e.from].id),
              let target = CardBook.card(s.teams[1 - e.p][e.to].id) else { return "" }
        let moveName = e.move == "special" ? attacker.special.name : attacker.basic.name
        return "\(attacker.name) used \(moveName) on \(target.name) for \(e.dmg)\(e.adv ? " (class bonus)" : "")\(e.ko ? " — KO!" : "")"
    }

    // MARK: actions

    private func run(_ work: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do { try await work(); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func loadCurrent() async {
        guard match == nil else { return }
        await run {
            let current: MatchView? = try await API.call("matches/current", token: store.token)
            match = current
        }
    }

    // While a match is open, check for the other player's moves every 2 seconds.
    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let m = match, m.status != "done", m.state?.turn != m.you || m.status == "waiting" else { continue }
            if let fresh: MatchView = try? await API.call("matches/\(m.id)", token: store.token), fresh != match {
                match = fresh
                if fresh.state?.winner != nil { await store.refresh() }
            }
        }
    }

    private func attack(from: Int, move mv: String, to: Int) {
        guard let m = match else { return }
        Task {
            await run {
                match = try await API.call("matches/\(m.id)/move", token: store.token, body: ["from": from, "move": mv, "to": to])
                selected = nil
                move = nil
                if match?.state?.winner != nil { await store.refresh() }
            }
        }
    }

    private func leave() async {
        guard let m = match else { return }
        await run {
            let _: [String: Bool] = try await API.call("matches/\(m.id)/leave", token: store.token, body: [:])
            match = nil
        }
        await store.refresh()
    }

    private func flash(side: Int, index: Int) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation(.default.repeatCount(3, autoreverses: true)) { hit = (side, index) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { withAnimation { hit = nil } }
    }
}
