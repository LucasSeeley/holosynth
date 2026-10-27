import SwiftUI
import UIKit

// Legend Hunt, full screen: lobby → fight → won / got away. One try per 8-hour hunt against a fully fused Legendary and its support.
// Winning gives an Overload pack (opened from the Play tab): 1 in 5 hold the Legendary, the rest a guaranteed Epic.
struct HuntView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ pack: [String]?) -> Void

    enum Phase: Equatable { case loading, lobby, fight, won(HuntResult), lost }
    @State private var phase = Phase.loading
    @State private var home: HuntHome?
    @State private var state: BattleState?
    @State private var pending: HuntResult?     // result waiting for the last hits to play out
    @State private var error: String?
    @State private var busy = false

    static let gold = Color(hex: 0xFFD77A)
    static let full = Fusion(h: 3, b: 3, s: 3, x: true, p: true)   // same as the server's HUNT_FUSION
    private var legend: Card? { home.flatMap { CardBook.card($0.legend) } }

    var body: some View {
        ZStack {
            ScreenBackground()
            switch phase {
            case .loading: ProgressView().tint(Theme.brass)
            case .lobby: lobby
            case .fight: fight
            case .won(let r): won(r)
            case .lost: lost
            }
        }
        .disabled(busy)
        .task { await load() }
    }

    // MARK: lobby

    @ViewBuilder private var lobby: some View {
        let ready = home?.status == "ready"
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Button { onClose(nil) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                        .frame(width: 44, height: 44).goldPanel(12)
                }
                .accessibilityLabel("Back")
                Text("Legend Hunt").font(.chakra(24)).foregroundColor(Theme.fg)
            }
            if let legend {
                VStack(spacing: 10) {
                    HStack {
                        Label("Current legend", systemImage: "crown.fill").font(.chakra(12, semibold: true)).tracking(2.5)
                            .textCase(.uppercase).foregroundColor(Self.gold)
                        Spacer()
                        countdown
                    }
                    HStack(alignment: .bottom, spacing: 12) {
                        VStack(spacing: 6) {
                            CardView(card: legend, fusion: Self.full).frame(width: 180)
                                .shadow(color: Self.gold.opacity(0.55), radius: 18)
                            HStack(spacing: 6) { Pips(level: 3, size: 6); Text("Fully fused") }
                        }
                        if let id = home?.support, let support = CardBook.card(id) {
                            let f = home?.supportFusion
                            VStack(spacing: 6) {
                                Text("Support").font(.chakra(10, semibold: true)).tracking(2).textCase(.uppercase)
                                    .foregroundColor(Theme.rarityColor(support.rarity))
                                CardView(card: support, fusion: (f?.total ?? 0) > 0 ? f : nil).frame(width: 112)
                                Text("\(support.rarity) · \((f?.total ?? 0) > 0 ? "lightly fused" : "not fused")")
                            }
                        }
                    }
                    .font(.barlow(12)).foregroundColor(Color(hex: 0xA9A5C2))
                }
                .padding(14)
                .background(RadialGradient(colors: [Self.gold.opacity(0.22), .clear], center: UnitPoint(x: 0.5, y: 0.35),
                                           startRadius: 0, endRadius: 220), in: RoundedRectangle(cornerRadius: 20))
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Self.gold.opacity(0.55), lineWidth: 1))
                .shadow(color: Self.gold.opacity(0.15), radius: 20)

                HStack(spacing: 12) {
                    if let img = Art.pack("overload") {
                        Image(uiImage: img).resizable().scaledToFit().frame(height: 78).shadow(color: Self.gold.opacity(0.45), radius: 8)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Beat it to win").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Self.gold)
                        (Text("Overload Pack").font(.chakra(17)).foregroundColor(Theme.fg) + Text(" · 8 cards").font(.barlow(13)))
                        (Text("20%").font(.chakra(13)).foregroundColor(Self.gold) + Text(" chance of \(legend.name), else an Epic"))
                            .font(.barlow(13))
                        (Text("+ 5,000 gold · 1,000 XP").font(.chakra(13)).foregroundColor(Self.gold))
                    }
                    .foregroundColor(Color(hex: 0xA9A5C2))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .goldPanel(18)
                .accessibilityElement(children: .combine)

                Text(ready ? "One try per hunt. A new legend every 8 hours." : "You've hunted this one. A new legend is on its way.")
                    .font(.barlow(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity)
            }
            Spacer(minLength: 0)
            if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).frame(maxWidth: .infinity) }
            Button(ready ? "Hunt" : "Back soon") { start() }.buttonStyle(GoldButton()).disabled(!ready)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
    }

    private var countdown: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            (Text("New legend in ") + Text(Self.left(home?.next ?? 0)).font(.chakra(13)).foregroundColor(Theme.fg))
                .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
        }
    }

    static func left(_ ms: Double) -> String {
        let m = max(0, Int(ms / 1000 - Date().timeIntervalSince1970)) / 60
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    // MARK: fight

    @ViewBuilder private var fight: some View {
        if let state, let legend {
            BattleBoard(state: state, you: 0, eyebrow: "Legend Hunt", title: legend.name, foeName: legend.name,
                        leaveLabel: "Give up", leaveQuestion: "Give up? This uses today's try.",
                        onMove: { from, mv, to in
                            do {
                                let r: HuntReply = try await API.call("hunt/move", token: store.token, body: ["from": from, "move": mv, "to": to])
                                if let p = r.profile { store.profile = p }
                                pending = r.result
                                self.state = r.state
                            } catch {
                                if let h: HuntHome = try? await API.call("hunt", token: store.token), let s = h.state { self.state = s }
                                throw error
                            }
                        },
                        onLeave: {
                            if let r: ProfileReply = try? await API.call("hunt/leave", token: store.token, body: [:]) { store.profile = r.profile }
                            onClose(nil)
                        },
                        onSettled: finishFight)
        }
    }

    // The last hits have played out: show the win or the escape.
    private func finishFight() {
        guard let r = pending else { return }
        pending = nil
        if r.won {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Sound.victory.play()
            withAnimation { phase = .won(r) }
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            Sound.defeat.play()
            withAnimation { phase = .lost }
        }
    }

    // MARK: results

    private func won(_ r: HuntResult) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Label("Legend Hunt", systemImage: "crown.fill").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase)
                .foregroundColor(Self.gold)
            Text("\(legend?.name ?? "Legend") defeated!").font(.chakra(34)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                .shadow(color: Self.gold.opacity(0.5), radius: 14)
            if let img = Art.pack("overload") {
                Image(uiImage: img).resizable().scaledToFit().frame(height: 300).rotationEffect(.degrees(-3))
                    .shadow(color: Self.gold.opacity(0.6), radius: 26).padding(.top, 10)
            }
            if let g = r.gold, let x = r.xp {
                Label("+\(g.formatted()) gold  ·  +\(x.formatted()) XP", systemImage: "circle.hexagongrid.fill")
                    .font(.chakra(18)).foregroundColor(Self.gold)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Theme.brass.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
            }
            Text("Your Overload Pack is waiting on the Play tab.\nIs \(legend?.name ?? "the legend") in it?")
                .font(.barlow(15)).foregroundColor(Color(hex: 0xA9A5C2)).multilineTextAlignment(.center)
            Spacer()
            Button("Collect") { onClose(r.pack ?? []) }.buttonStyle(GoldButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
        .background(RadialGradient(colors: [Self.gold.opacity(0.25), .clear], center: UnitPoint(x: 0.5, y: 0.45), startRadius: 0, endRadius: 260))
    }

    private var lost: some View {
        VStack(spacing: 12) {
            Spacer()
            Label("Legend Hunt", systemImage: "crown.fill").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase)
                .foregroundColor(Color(hex: 0xFF7884))
            Text("\(legend?.name ?? "The legend") got away").font(.chakra(34)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
            if let legend { CardView(card: legend, fusion: Self.full).frame(width: 190).saturation(0.4).opacity(0.45).padding(.top, 8) }
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                (Text("A new legend appears in ") + Text(Self.left(home?.next ?? 0)).font(.chakra(15)).foregroundColor(Theme.fg) + Text("."))
                    .font(.barlow(15)).foregroundColor(Color(hex: 0xA9A5C2))
            }
            Spacer()
            Button { onClose(nil) } label: { Text("Done").frame(maxWidth: .infinity) }.buttonStyle(OutlineButton())
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }

    // MARK: actions

    private func load() async {
        do {
            let h: HuntHome = try await API.call("hunt", token: store.token)
            home = h
            if h.status == "playing", let s = h.state { state = s; phase = .fight } else { phase = .lobby }
        } catch { self.error = error.localizedDescription; phase = .lobby }
    }

    private func start() {
        busy = true
        Task { @MainActor in
            do {
                let h: HuntHome = try await API.call("hunt/start", token: store.token, body: [:])
                home = h
                state = h.state
                error = nil
                await store.refresh()   // the Play tile shows the try as used
                withAnimation { phase = .fight }
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

