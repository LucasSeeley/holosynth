import SwiftUI
import UIKit

// The battle itself, shared by friend matches and the campaign.
// Turns alternate; tap one of your ready cards, choose its move, then tap the enemy card to hit.
struct BattleBoard: View {
    let state: BattleState
    let you: Int
    let foeName: String
    let winText: String
    let leaveLabel: String
    let leaveQuestion: String
    let onMove: (_ from: Int, _ move: String, _ to: Int) async throws -> Void
    let onLeave: () async -> Void

    // not private: a private stored property would make the memberwise init private to this file
    @State var selected: Int?           // my card index
    @State var move: String?            // "basic" | "special"
    @State var hit: (side: Int, index: Int)?
    @State var confirmLeave = false
    @State var busy = false
    @State var error: String?

    private var myTurn: Bool { state.turn == you && state.winner == nil }

    var body: some View {
        VStack(spacing: 12) {
            row(side: 1 - you, mine: false, label: foeName, tappable: myTurn && move != nil && !busy)
            Text(status).font(.chakra(17, semibold: true)).foregroundColor(myTurn ? Theme.brass : Theme.muted)
                .multilineTextAlignment(.center).frame(maxWidth: .infinity)
            ForEach(Array(state.log.suffix(2).reversed().enumerated()), id: \.offset) { i, entry in
                Text(describe(entry)).font(.barlow(14)).foregroundColor(Theme.muted.opacity(i == 0 ? 1 : 0.6))
                    .multilineTextAlignment(.center)
            }
            row(side: you, mine: true, label: "You", tappable: myTurn && !busy)
            if myTurn, let sel = selected, let card = CardBook.card(state.teams[you][sel].id) {
                movePicker(card, unit: state.teams[you][sel])
            }
            if let error {
                Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center)
            }
            Spacer(minLength: 0)
            if state.winner == nil {
                Button(leaveLabel) { confirmLeave = true }
                    .font(.chakra(13, semibold: true)).tracking(1.5).foregroundColor(Theme.pink)
                    .frame(minHeight: 44)
                    .confirmationDialog(leaveQuestion, isPresented: $confirmLeave, titleVisibility: .visible) {
                        Button(leaveLabel, role: .destructive) { Task { await onLeave() } }
                    }
            }
        }
        .padding(12)
        .onChange(of: state.log.count) { _ in
            if let last = state.log.last { flash(side: 1 - last.p, index: last.to) }
        }
        .onChange(of: state.turn) { _ in selected = nil; move = nil }
    }

    private func row(side: Int, mine isMine: Bool, label: String, tappable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.chakra(12, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass.opacity(0.8))
            HStack(spacing: 8) {
                ForEach(Array(state.teams[side].enumerated()), id: \.offset) { i, unit in
                    if let card = CardBook.card(unit.id) {
                        let ko = unit.hp == 0
                        let acted = state.acted[side][i]
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
            .frame(maxWidth: .infinity, alignment: .leading)
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

    private var status: String {
        if let w = state.winner { return w == you ? winText : "You lost. Better luck next time." }
        if state.turn != you { return "\(foeName)'s turn…" }
        if selected == nil { return "Your turn: pick one of your cards" }
        if move == nil { return "Choose a move" }
        return "Now tap the enemy card to hit"
    }

    private func describe(_ e: LogEntry) -> String {
        guard let attacker = CardBook.card(state.teams[e.p][e.from].id),
              let target = CardBook.card(state.teams[1 - e.p][e.to].id) else { return "" }
        let moveName = e.move == "special" ? attacker.special.name : attacker.basic.name
        return "\(attacker.name) used \(moveName) on \(target.name) for \(e.dmg)\(e.adv ? " (class bonus)" : "")\(e.ko ? " — KO!" : "")"
    }

    private func attack(from: Int, move mv: String, to: Int) {
        busy = true
        Task {
            do { try await onMove(from, mv, to); selected = nil; move = nil; error = nil }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func flash(side: Int, index: Int) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation(.default.repeatCount(3, autoreverses: true)) { hit = (side, index) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { withAnimation { hit = nil } }
    }
}
