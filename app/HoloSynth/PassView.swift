import SwiftUI
import UIKit

// Season Pass, full screen: this season's prize (the season card and a Legends Pack), your tier and Pass XP,
// and the 30-tier reward track as a swipeable row of card-sized tiles. The server keeps the XP and what's claimed;
// a claimed pack waits in Your packs on the Play tab.
struct PassView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void

    @State private var busy = false
    @State private var note: String?
    static let packNames = ["power": "Power Pack", "cyber": "Cyber Pack", "magic": "Magic Pack", "omni": "Omni Pack",
                            "overload": "Overload Pack", "legends": "Legends Pack"]
    static func name(_ r: PassInfo.Reward) -> String {
        if let g = r.gold { return "\(g.formatted()) gold" }
        if let p = r.power { return Power.all.first { $0.id == p }?.name ?? "Power card" }
        let pack = packNames[r.pack ?? ""] ?? "Pack"
        return r.card != nil ? "Season card + \(pack)" : pack
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile?.pass {
                ScrollViewReader { proxy in ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        header(p).padding(.horizontal, 16).id("top")
                        hero(p)
                        VStack(spacing: 6) {
                            let prize = p.rewards.last?.card.flatMap { CardBook.card($0) }
                            Text(prize?.name ?? "Season \(p.season) card").font(.chakra(26)).foregroundColor(Theme.fg)
                            Text("A holo \(prize.map { $0.cls + " " } ?? "")card you can only get this season. Reach tier \(p.tiers) to unlock it, plus a \(Self.packNames[p.rewards.last?.pack ?? ""] ?? "pack").")
                                .font(.barlow(14)).foregroundColor(Color(hex: 0xA9A5C2)).multilineTextAlignment(.center).frame(maxWidth: 320)
                        }
                        .padding(.horizontal, 24)
                        progress(p).padding(.horizontal, 16).padding(.top, 18)
                        if let note { Text(note).font(.barlow(13, semibold: true)).foregroundColor(HuntView.gold).padding(.top, 12) }
                        track(p, outer: proxy)
                        HStack(spacing: 10) {
                            earn("Daily quests", "100 to 250 Pass XP each")
                            earn("Battle wins", "20 Pass XP each (Gauntlet and Ranked: 10 a day)")
                        }
                        .fixedSize(horizontal: false, vertical: true)   // both boxes the same height
                        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
                    }
                } }
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .disabled(busy)
        .task { await store.refresh() }   // XP earned since the profile was last loaded
    }

    private func header(_ p: PassInfo) -> some View {
        HStack(spacing: 12) {
            Button(action: onClose) {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                    .frame(width: 44, height: 44).goldPanel(12)
            }
            .accessibilityLabel("Back")
            Text("Season \(p.season)").font(.chakra(24)).foregroundColor(Theme.fg)
            Spacer()
            TimelineView(.periodic(from: .now, by: 60)) { _ in
                (Text("Ends in ") + Text(Self.ends(p.ends)).font(.chakra(13)).foregroundColor(Theme.fg))
                    .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
            }
        }
        .padding(.top, 8)
    }

    // The tier-30 prize: the season card and its Legends Pack side by side, straight, the same height.
    private func hero(_ p: PassInfo) -> some View {
        GeometryReader { g in   // fill the width between the 16pt edges, card and pack the same height
            let h = (g.size.width - 14) / (5.0 / 7.0 + 0.6)
            prize(p.rewards.last, cardWidth: h * 5 / 7, gap: 14).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1.365, contentMode: .fit)
        .frame(maxWidth: 388)
        .shadow(color: .black.opacity(0.7), radius: 18, y: 14)
        .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 24)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    // Season card + its pack, both card height (5:7), tops and bottoms lined up. The hero and the tier-30 tile both use it.
    private func prize(_ r: PassInfo.Reward?, cardWidth w: CGFloat, gap: CGFloat) -> some View {
        HStack(spacing: gap) {
            SeasonCardView(id: r?.card, width: w)
            if let img = Art.pack(r?.pack ?? "legends") {
                Image(uiImage: img).resizable().scaledToFit().frame(height: w * 7 / 5)
            }
        }
    }

    private func progress(_ p: PassInfo) -> some View {
        let into = p.tier >= p.tiers ? p.per : p.xp - p.tier * p.per
        return HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text("TIER").font(.chakra(10, semibold: true)).tracking(1)
                Text("\(p.shown)").font(.chakra(24)).monospacedDigit()
            }
            .foregroundColor(Color(hex: 0x2A1A00))
            .frame(width: 62, height: 62)
            .background(LinearGradient(colors: [HuntView.gold, Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom), in: Hexagon())
            .accessibilityElement(children: .ignore).accessibilityLabel("Tier \(p.shown) of \(p.tiers)")
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(p.tier >= p.tiers ? "Every tier reached" : "\(into.formatted()) / \(p.per.formatted()) Pass XP")
                    Spacer()
                    if p.toClaim > 0 { Text("\(p.toClaim) to claim").foregroundColor(HuntView.gold) }
                }
                .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2)).monospacedDigit()
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.1))
                        Capsule().fill(LinearGradient(colors: [Color(hex: 0xE0A12A), HuntView.gold], startPoint: .leading, endPoint: .trailing))
                            .frame(width: g.size.width * CGFloat(into) / CGFloat(max(p.per, 1)))
                            .shadow(color: HuntView.gold.opacity(0.6), radius: 6)
                    }
                }
                .frame(height: 12)
            }
        }
    }

    private func track(_ p: PassInfo, outer: ScrollViewProxy?) -> some View {
        let firstReady = (0..<p.tier).first { !p.claimed.contains($0 + 1) }
        let focus = (firstReady ?? min(p.tier, p.tiers - 1)) + 1
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(Array(p.rewards.enumerated()), id: \.offset) { i, r in tier(i + 1, r, p).id(i + 1) }
            }
            .padding(.horizontal, 16).padding(.vertical, 22)
        }
        .onAppear {
            guard let proxy = outer else { return }
            proxy.scrollTo(focus, anchor: .center)
            proxy.scrollTo("top", anchor: .top)   // scrollTo also moves the page; put the page back at the top
        }
    }

    private func tier(_ t: Int, _ r: PassInfo.Reward, _ p: PassInfo) -> some View {
        let claimed = p.claimed.contains(t), reached = t <= p.tier, current = t == p.tier + 1
        let big = r.pack != nil, final = t == p.tiers
        let into = p.xp - p.tier * p.per
        return VStack(alignment: .leading, spacing: 8) {   // number and claim line sit under the card (tier 30 also has its pack beside it)
            if final, r.card != nil {
                prize(r, cardWidth: 104, gap: 8)
                    .opacity(claimed ? 0.45 : 1)
                    .accessibilityElement(children: .ignore).accessibilityLabel("Tier \(t): \(Self.name(r))")
            } else {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0x14121F))
                RadialGradient(colors: [(big && !reached ? Theme.backRed : Theme.brass).opacity(big && !reached ? 0.35 : 0.16), .clear],
                               center: .init(x: 0.5, y: 0.4), startRadius: 0, endRadius: 80)
                if !reached && !current && !big {
                    CardBack()
                } else {
                    VStack(spacing: 4) {
                        art(r).frame(maxHeight: .infinity)
                        Text(Self.name(r)).font(.chakra(12, semibold: true)).foregroundColor(Theme.fg)
                        .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8).padding(.horizontal, 6).padding(.bottom, 8)
                    }
                }
            }
            .frame(width: 104, height: 146)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(
                reached && !claimed || current || final ? HuntView.gold : (!reached && !big ? Theme.backRed.opacity(0.6) : Theme.brass.opacity(0.35)),
                lineWidth: current ? 2 : 1))
            .shadow(color: reached && !claimed ? Color(hex: 0xFFC53D).opacity(0.45) : final ? Color(hex: 0x78DCFF).opacity(0.35) : .clear, radius: 10)
            .opacity(claimed ? 0.45 : 1)
            .accessibilityElement(children: .ignore).accessibilityLabel("Tier \(t): \(Self.name(r))")
            }
            Text("\(t)").font(.chakra(14)).foregroundColor(current ? HuntView.gold : Theme.muted).monospacedDigit().frame(width: 104)
            Group {
                if claimed {
                    Text("Claimed").font(.chakra(12, semibold: true)).foregroundColor(QuestsView.green)
                } else if reached {
                    Button("Claim") { claim(t) }.buttonStyle(GoldButton(height: 30)).frame(width: 84)
                } else if current {
                    Text("\(into.formatted()) / \(p.per.formatted())").font(.chakra(12, semibold: true)).foregroundColor(HuntView.gold).monospacedDigit()
                }
            }
            .frame(width: 104, height: 30)
        }
    }

    @ViewBuilder private func art(_ r: PassInfo.Reward) -> some View {
        if let g = r.gold {
            Coins(n: g >= 750 ? 4 : 3).frame(width: 72, height: 72)
        } else if let id = r.power, let pw = Power.all.first(where: { $0.id == id }) {
            PowerCardView(power: pw).frame(width: 64, height: 90)
        } else if let pack = r.pack, let img = Art.pack(pack) {
            Image(uiImage: img).resizable().scaledToFit().frame(height: 100)
        }
    }

    private func earn(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.chakra(14)).foregroundColor(Theme.fg)
            Text(text).font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2)).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
    }
    // "23d 4h" (or "5h 12m" on the last day) until `ms`.
    static func ends(_ ms: Double) -> String {
        let m = max(0, Int(ms / 1000 - Date().timeIntervalSince1970)) / 60
        return m >= 1440 ? "\(m / 1440)d \(m % 1440 / 60)h" : HuntView.left(ms)
    }

    private func claim(_ t: Int) {
        busy = true
        Task { @MainActor in
            do {
                let r: PassClaimReply = try await API.call("pass/claim", token: store.token, body: ["tier": t])
                store.profile = r.profile
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Sound.rare.play()
                note = r.reward.pack != nil ? "\(Self.packNames[r.reward.pack ?? ""] ?? "Pack") added to Your packs" : "\(Self.name(r.reward)) claimed"
            } catch {
                note = error.localizedDescription
                await store.refresh()
            }
            busy = false
        }
    }
}

// The season card: the real card once it's out, a holo card back with a "?" until then.
struct SeasonCardView: View {
    let id: String?
    let width: CGFloat
    var body: some View {
        if let id, let c = CardBook.card(id) {
            CardView(card: c).frame(width: width, height: width * 7 / 5)   // pin 5:7 so a scroll row can't squeeze it
        } else {
            CardBack().frame(width: width, height: width * 7 / 5)
                .overlay(Text("?").font(.chakra(width * 0.34)).foregroundColor(.white.opacity(0.9)).shadow(color: Color(hex: 0x78DCFF), radius: 12))
                .modifier(HoloFoil(on: true, width: width))
        }
    }
}

// A little stack of gold coins (3 or 4).
private struct Coins: View {
    let n: Int
    var body: some View {
        GeometryReader { g in
            let s = g.size.width / 80, spots: [(CGFloat, CGFloat)] = n >= 4 ? [(0, -4), (-13, 10), (13, 10), (0, 20)] : [(0, 6), (-13, 14), (13, 14)]
            ZStack {
                ForEach(Array(spots.enumerated()), id: \.offset) { _, p in
                    Circle().fill(Theme.brass).overlay(Circle().stroke(Color(hex: 0x7A4F10), lineWidth: 1.5 * s))
                        .overlay(Circle().inset(by: 5.5 * s).stroke(Color(hex: 0x1A0D05).opacity(0.45), lineWidth: 1.6 * s))
                        .frame(width: 26 * s, height: 26 * s)
                        .position(x: (40 + p.0) * s, y: (36 + p.1) * s)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

private struct Hexagon: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX + r.width * 0.25, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.75, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.75, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.25, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.midY))
        p.closeSubpath()
        return p
    }
}
