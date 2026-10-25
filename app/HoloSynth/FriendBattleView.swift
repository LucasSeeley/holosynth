import SwiftUI

// Battle a friend, full screen: create a match and share its code, or type a friend's code to join.
struct FriendBattleView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void

    @State var match: MatchView?
    @State var codeInput = ""
    @State var busy = false
    @State var error: String?
    @State var settled = true      // false while a move is still playing out on the board

    var body: some View {
        ZStack {
            ScreenBackground()
            if let match, match.status != "waiting", let state = match.state { board(match, state) }
            else if let match { waiting(match) }
            else { lobby }
        }
        .task { await loadCurrent() }
        .task(id: match?.id) { await poll() }
    }

    // MARK: lobby

    private var lobby: some View {
        VStack(spacing: 18) {
            HStack(spacing: 10) {
                Button(action: onClose) {
                    Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                        .frame(width: 44, height: 44).goldPanel(12)
                }
                .accessibilityLabel("Back")
                Text("Battle a friend").font(.chakra(24)).foregroundColor(Theme.fg)
                Spacer()
            }
            Spacer()
            VStack(spacing: 10) {
                Text("Your team").sectionTitle()
                HStack(spacing: 8) {
                    ForEach(store.profile?.team ?? [], id: \.self) { id in
                        if let card = CardBook.card(id) { CardView(card: card) }
                    }
                }
                Text("Change it in Cards").font(.barlow(14)).foregroundColor(Theme.muted)
            }
            Button("Create a match") {
                Task { await run { match = try await API.call("matches", token: store.token, body: [:]) } }
            }
            .buttonStyle(GoldButton())
            .padding(.top, 6)
            HStack(spacing: 12) {
                Rectangle().fill(Theme.brass.opacity(0.25)).frame(height: 1)
                Text("or join a friend's match").font(.barlow(13)).foregroundColor(Theme.muted).fixedSize()
                Rectangle().fill(Theme.brass.opacity(0.25)).frame(height: 1)
            }
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
        .padding(16)
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
        ZStack {
            BattleBoard(state: s, you: m.you, eyebrow: "Friend battle", title: "vs \(m.players[1 - m.you] ?? "Opponent")",
                        foeName: m.players[1 - m.you] ?? "Opponent",
                        leaveLabel: "Forfeit", leaveQuestion: "Forfeit this match? Your opponent wins.",
                        onMove: { from, mv, to in
                            settled = false
                            do {
                                let next: MatchView = try await API.call("matches/\(m.id)/move", token: store.token,
                                                                         body: ["from": from, "move": mv, "to": to])
                                match = next
                                if next.state?.winner != nil { await store.refresh() }
                            } catch { settled = true; throw error }
                        },
                        onLeave: { await leave() },
                        onSettled: { settled = true })
            if let w = s.winner, settled {
                ZStack {
                    Color.black.opacity(0.6).ignoresSafeArea()
                    VStack(spacing: 14) {
                        Text(w == m.you ? "Victory" : "Defeated").font(.chakra(34)).textCase(.uppercase)
                            .foregroundColor(w == m.you ? Theme.brass : Theme.pink)
                        Text(w == m.you ? "+50 gold  ·  +25 XP" : "Better luck next time.").font(.barlow(16)).foregroundColor(Theme.fg)
                        Button("Back") { match = nil; Task { await store.refresh() } }.buttonStyle(GoldButton())
                    }
                    .padding(24).frame(maxWidth: 340)
                    .background(Theme.ink.opacity(0.92), in: RoundedRectangle(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
                    .padding(20)
                }
                .transition(.opacity)
                .onAppear { (w == m.you ? Sound.victory : Sound.defeat).play() }
            }
        }
    }

    @ViewBuilder private var errorText: some View {
        if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center) }
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
                if fresh.state != m.state { settled = false }   // their move plays out before any result shows
                match = fresh
                if fresh.state?.winner != nil { await store.refresh() }
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
}
