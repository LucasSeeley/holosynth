import SwiftUI
import UIKit

// A campaign level against the computer, full screen. You always move first; the computer answers each move.
struct CampaignBattleView: View {
    enum Next { case none, recruit, pack([String]) }

    @EnvironmentObject var store: GameStore
    let onClose: (Next) -> Void

    @State var run: CampaignRun?
    @State var error: String?
    @State var settled = true      // false while the last move is still playing out on the board

    var body: some View {
        ZStack {
            ScreenBackground()
            if let run {
                BattleBoard(state: run.state, you: 0,
                            eyebrow: run.boss ? "Boss · Level \(run.level)" : "Level \(run.level)", title: run.title,
                            foeName: run.boss ? "The boss" : "The enemy",
                            leaveLabel: "Quit", leaveQuestion: "Quit this fight? You can try again any time.",
                            onMove: { from, mv, to in
                                settled = false
                                do {
                                    let next: CampaignRun = try await API.call("campaign/move", token: store.token,
                                                                               body: ["from": from, "move": mv, "to": to])
                                    self.run = next
                                    if let p = next.profile { store.profile = p }
                                } catch {
                                    // out of step with the server (e.g. a reply that never arrived): load the real battle
                                    if let fresh: CampaignRun = try? await API.call("campaign/current", token: store.token) { self.run = fresh }
                                    settled = true; throw error
                                }
                            },
                            onLeave: {
                                _ = try? await API.call("campaign/leave", token: store.token, body: [:]) as [String: Bool]
                                onClose(.none)
                            },
                            onSettled: { settled = true })
                if let result = run.result, settled { resultPanel(result, run: run).transition(.opacity) }
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
                    if r.recruit == true {
                        Text("Recruit Pack earned").font(.chakra(22)).foregroundColor(Theme.fg)
                        if let img = Art.pack("recruit") {
                            Image(uiImage: img).resizable().scaledToFit().frame(width: 150).shadow(color: Theme.cyan.opacity(0.45), radius: 18)
                        }
                        Text("Your next starter is inside.").font(.barlow(15)).foregroundColor(Theme.muted)
                        Button("Open") { onClose(.recruit) }.buttonStyle(GoldButton())
                    } else {
                        if r.pack != nil {
                            Text("Boss reward: a free pack! Open it from the Play tab.").font(.barlow(15)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                        }
                        if store.profile?.campaign.next != nil {
                            Button("Next battle") { Task { await start() } }.buttonStyle(GoldButton())
                        }
                        Button("Exit") { onClose(r.pack.map { .pack($0) } ?? .none) }.buttonStyle(OutlineButton())
                    }
                } else {
                    Text("You go first every time. Try a different target order.")
                        .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    Button("Try again") { Task { await start() } }.buttonStyle(GoldButton())
                    Button("Exit") { onClose(.none) }.buttonStyle(OutlineButton())
                }
            }
            .padding(24)
            .frame(maxWidth: 340)
            .background(Theme.ink.opacity(0.92), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
            .padding(20)
        }
        .onAppear {
            if r.won { UINotificationFeedbackGenerator().notificationOccurred(.success); Sound.victory.play() }
            else { UINotificationFeedbackGenerator().notificationOccurred(.error); Sound.defeat.play() }
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

// A 1-card Recruit Pack holding a starter you don't have yet: at sign-up, and after campaign levels 3 and 6.
// It goes straight to the tear screen like every pack (no Open: you need the card to play), then swipe the card over.
struct RecruitView: View {
    var eyebrow = "Recruit Pack"
    var title = "Open your Recruit Pack"
    var subtitle: String? = nil
    let onDone: () -> Void

    var body: some View {
        PackTab(onClose: onDone, recruit: RecruitIntro(eyebrow: eyebrow, title: title, subtitle: subtitle))
    }
}
