import SwiftUI
import UIKit

// A campaign level against the computer, full screen. You always move first; the computer answers each move.
struct CampaignBattleView: View {
    enum Next { case none, chooseCard, pack([String]) }

    @EnvironmentObject var store: GameStore
    let onClose: (Next) -> Void

    @State var run: CampaignRun?
    @State var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let run {
                VStack(spacing: 4) {
                    Text(run.boss ? "BOSS · LEVEL \(run.level)" : "LEVEL \(run.level)").sectionTitle()
                    Text(run.title).font(.chakra(22)).foregroundColor(Theme.fg)
                    BattleBoard(state: run.state, you: 0, foeName: run.boss ? "Boss" : "Enemy",
                                winText: "You won!", leaveLabel: "Quit",
                                leaveQuestion: "Quit this fight? You can try again any time.",
                                onMove: { from, mv, to in
                                    let next: CampaignRun = try await API.call("campaign/move", token: store.token,
                                                                               body: ["from": from, "move": mv, "to": to])
                                    self.run = next
                                    if let p = next.profile { store.profile = p }
                                },
                                onLeave: {
                                    _ = try? await API.call("campaign/leave", token: store.token, body: [:]) as [String: Bool]
                                    onClose(.none)
                                })
                }
                .padding(.top, 8)
                if let result = run.result { resultPanel(result, run: run) }
            } else if let error {
                VStack(spacing: 16) {
                    Text(error).font(.barlow(15, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center)
                    Button("Back") { onClose(.none) }.buttonStyle(OutlineButton())
                }
                .padding(24)
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .task { await load() }
    }

    private func resultPanel(_ r: CampaignRun.Result, run: CampaignRun) -> some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            VStack(spacing: 14) {
                Text(r.won ? "Victory" : "Defeated").font(.chakra(34)).textCase(.uppercase)
                    .foregroundColor(r.won ? Theme.brass : Theme.pink)
                    .shadow(color: (r.won ? Theme.brass : Theme.pink).opacity(0.6), radius: 16)
                if r.won {
                    Text(run.boss ? "You beat the boss!" : "Level \(run.level) cleared").font(.barlow(16)).foregroundColor(Theme.fg)
                    if let gold = r.gold, gold > 0 {
                        HStack(spacing: 6) {
                            Image(systemName: "circle.hexagongrid.fill").foregroundColor(Theme.brass)
                            Text("+\(gold)  ·  +\(r.xp ?? 0) XP").font(.chakra(17)).foregroundColor(Theme.fg)
                        }
                        .padding(.horizontal, 14).frame(height: 36).goldPanel(18)
                    }
                    if let id = r.newCard, let card = CardBook.card(id) {
                        CardView(card: card).frame(width: 150)
                        Text("\(card.name) joined your team! Battle a friend is unlocked.")
                            .font(.barlow(15)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                    }
                    if let pack = r.pack {
                        Text("Boss reward: a free pack!").font(.barlow(15)).foregroundColor(Theme.fg)
                        Button("Open your pack") { onClose(.pack(pack)) }.buttonStyle(GoldButton())
                    } else if r.chooseCard == true {
                        Text("A new card wants to join you.").font(.barlow(15)).foregroundColor(Theme.fg)
                        Button("Pick your new card") { onClose(.chooseCard) }.buttonStyle(GoldButton())
                    } else {
                        Button("Continue") { onClose(.none) }.buttonStyle(GoldButton())
                    }
                } else {
                    Text("You go first every time. Try a different target order.")
                        .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    Button("Try again") { Task { await start() } }.buttonStyle(GoldButton())
                    Button("Back") { onClose(.none) }.buttonStyle(OutlineButton())
                }
            }
            .padding(24)
            .frame(maxWidth: 340)
            .background(Theme.ink.opacity(0.92), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
            .padding(20)
        }
        .onAppear {
            if r.won { UINotificationFeedbackGenerator().notificationOccurred(.success) }
            else { UINotificationFeedbackGenerator().notificationOccurred(.error) }
        }
    }

    // Pick up a fight left open (app closed mid-battle), otherwise start the next level.
    private func load() async {
        do {
            let current: CampaignRun? = try await API.call("campaign/current", token: store.token)
            if let current { run = current } else { await start() }
        } catch { self.error = error.localizedDescription }
    }

    private func start() async {
        do { run = try await API.call("campaign/start", token: store.token, body: [:]); error = nil }
        catch { self.error = error.localizedDescription; run = nil }
    }
}

// Pick a card from a few on offer: your first card on sign-up, and your second after campaign level 3.
struct CardPicker: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let ids: [String]
    let cta: String
    var showAdvantage = false
    let onPick: (String) async -> Void

    @State var picked = 0
    @State var busy = false

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 22) {
                VStack(spacing: 8) {
                    Text(eyebrow).sectionTitle()
                    Text(title).font(.chakra(28)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                    Text(subtitle).font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                }
                HStack(alignment: .bottom, spacing: ids.count > 2 ? 8 : 14) {
                    ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
                        if let card = CardBook.card(id) {
                            Button { withAnimation(.spring(response: 0.3)) { picked = i } } label: {
                                CardView(card: card)
                                    .overlay {
                                        if i == picked {
                                            RoundedRectangle(cornerRadius: 8).stroke(Theme.brass, lineWidth: 3)
                                                .shadow(color: Theme.brass.opacity(0.7), radius: 12)
                                        }
                                    }
                                    .opacity(i == picked ? 1 : 0.7)
                                    .offset(y: i == picked ? -14 : 0)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(cta) \(card.name)")
                        }
                    }
                }
                .frame(maxWidth: ids.count > 2 ? .infinity : 330)
                .padding(.top, 14)
                if showAdvantage {
                    VStack(spacing: 4) {
                        Text("Class advantage · +20% damage").font(.chakra(11, semibold: true)).tracking(2)
                            .textCase(.uppercase).foregroundColor(Theme.brass)
                        (Text("Fighter").foregroundColor(Theme.cyan) + Text(" beats ") + Text("Beast").foregroundColor(Theme.pink)
                         + Text(" · ") + Text("Beast").foregroundColor(Theme.pink) + Text(" beats ") + Text("Mech").foregroundColor(Theme.orange)
                         + Text(" · ") + Text("Mech").foregroundColor(Theme.orange) + Text(" beats ") + Text("Fighter").foregroundColor(Theme.cyan))
                            .font(.barlow(14, semibold: true)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12).goldPanel()
                }
                if ids.indices.contains(picked), let card = CardBook.card(ids[picked]) {
                    Button(busy ? "…" : "\(cta) \(card.name)") {
                        busy = true
                        Task { await onPick(card.id); busy = false }
                    }
                    .buttonStyle(GoldButton())
                    .disabled(busy)
                }
            }
            .padding(16)
        }
    }
}
