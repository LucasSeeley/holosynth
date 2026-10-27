import SwiftUI

// Fusion (v1.2): tap a card in the collection to see it big; Fuse spends spare copies on your best copy of it.
// HP +10%, basic +20%, special +10% per fusion (5 copies each, max 3 per stat). Epic & Legendary cards can also unlock a
// stronger second special for 10 copies + 10,000 gold. The server checks the costs; these screens only show them.
struct FuseSheet: View {
    @EnvironmentObject var store: GameStore
    let card: Card
    var holo = false            // fusing your holo copy instead of your normal one
    let onClose: () -> Void

    @State private var fusing = false
    @State private var busy = false
    @State private var error: String?
    @State private var result: (line: String, before: Int, after: Int, stat: String)?

    private static let gold = Color(hex: 0xFFD77A)
    private let cost = 5, maxLevel = 3, secondCopies = 10, secondGold = 10_000
    private let fuseGold = [1000, 2500, 5000]   // a stat's 1st, 2nd and 3rd fusion (same as the server)

    private var fusion: Fusion? { holo ? store.profile?.holo(card.id) : store.profile?.fusion(card.id) }
    private var copies: Int { store.profile?.collection[card.id] ?? 0 }
    private var holoCopies: Int { store.profile?.holoCount(card.id) ?? 0 }
    // Copies you can spend: plain copies, keeping one back if none is fused yet (it becomes the fused one).
    private var spare: Int {
        let fusedCount = store.profile?.fused?.filter { $0.card == card.id }.count ?? 0
        return max(0, copies - fusedCount - (fusion == nil ? 1 : 0))
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            if let r = result { done(r) } else if fusing { fuseScreen } else { detail }
        }
    }

    // MARK: card detail

    private var detail: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)
            CardView(card: card, fusion: fusion).padding(.horizontal, 40)
            HStack(spacing: 14) {
                (Text("×\(holo ? holoCopies : copies - holoCopies)").font(.chakra(14)).foregroundColor(Theme.fg) + Text(holo ? " holo" : " copies"))
                pipLabel("HP", fusion?.h ?? 0); pipLabel("Basic", fusion?.b ?? 0); pipLabel("Special", fusion?.s ?? 0)
            }
            .font(.barlow(14)).foregroundColor(Theme.muted)
            Button { fusing = true } label: { Label("Fuse", systemImage: "sparkles") }.buttonStyle(GoldButton())
                .padding(.horizontal, 24)
            Text("Fusing uses \(cost) spare copies and some gold").font(.barlow(13)).foregroundColor(Theme.muted)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 20)
    }

    // MARK: fuse screen

    private var fuseScreen: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Fuse \(card.name)\(holo ? " (Holo)" : "")").font(.chakra(24)).foregroundColor(Theme.fg)
                Spacer()
                closeButton { fusing = false }
            }
            .padding(.horizontal, 16).padding(.top, 14)
            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    HStack(spacing: 14) {
                        CardView(card: card, fusion: fusion).frame(width: 120)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(cost) copies + gold per fusion").sectionTitle()
                            (Text("You have ") + Text("\(spare) spare").font(.chakra(14)).foregroundColor(Theme.fg) + Text(" copies."))
                                .font(.barlow(14)).foregroundColor(Theme.muted)
                            Text("Each stat can be fused \(maxLevel) times.").font(.barlow(13)).foregroundColor(Theme.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    VStack(spacing: 0) {
                        statRow("HP +10%", sub: "HP", stat: "h", level: fusion?.h ?? 0,
                                now: card.maxHP(fusion), next: card.maxHP(bumped("h")))
                        statRow("Basic +20%", sub: card.basic.name, stat: "b", level: fusion?.b ?? 0,
                                now: card.dmg("basic", fusion), next: card.dmg("basic", bumped("b")))
                        statRow("Special +10%", sub: card.special.name, stat: "s", level: fusion?.s ?? 0,
                                now: card.dmg("special", fusion), next: card.dmg("special", bumped("s")), last: true)
                    }
                    .padding(.horizontal, 14)
                    .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
                    if let s2 = card.special2 { secondSpecial(s2) }
                    if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                }
                .padding(.horizontal, 16).padding(.bottom, 16)
            }
        }
    }

    private func bumped(_ stat: String) -> Fusion {
        var f = fusion ?? Fusion()
        switch stat {
        case "h": f.h = min(maxLevel, f.h + 1)
        case "b": f.b = min(maxLevel, f.b + 1)
        case "s": f.s = min(maxLevel, f.s + 1)
        default: f.x = true
        }
        return f
    }

    private func statRow(_ title: String, sub: String, stat: String, level: Int, now: Int, next: Int, last: Bool = false) -> some View {
        let maxed = level >= maxLevel
        let price = maxed ? 0 : fuseGold[level]
        let gold = store.profile?.gold ?? 0
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) { Text(title).font(.chakra(16)).foregroundColor(Theme.fg); Pips(level: level) }
                HStack(spacing: 6) {
                    Text(sub).lineLimit(1)
                    Text("\(now)").font(.system(size: 14, design: .monospaced))
                    if !maxed {
                        Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold))
                        Text("\(next)").font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundColor(Self.gold)
                    }
                }
                .font(.barlow(13)).foregroundColor(Theme.muted)
                if !maxed {
                    Text("\(cost) copies + \(price.formatted()) gold").font(.barlow(12))
                        .foregroundColor(gold < price ? Color(hex: 0xFF7884) : Theme.muted)
                }
            }
            Spacer(minLength: 4)
            if maxed {
                Text("Max").font(.chakra(12)).tracking(1.5).textCase(.uppercase).foregroundColor(Self.gold)
                    .frame(width: 84, height: 40).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
            } else {
                Button("Fuse") { fuse(stat, title: sub, before: now, after: next) }
                    .buttonStyle(GoldButton(height: 40)).frame(width: 84)
                    .disabled(busy || spare < cost || gold < price)
            }
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Theme.brass.opacity(0.1)).frame(height: 1) } }
    }

    private func secondSpecial(_ s2: Card.Special) -> some View {
        let unlocked = fusion?.x == true
        let gold = store.profile?.gold ?? 0
        let short = spare < secondCopies ? "Need \(secondCopies - spare) more copies"
            : gold < secondGold ? "Need \((secondGold - gold).formatted()) more gold" : nil
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Second special").font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Self.gold)
                Spacer()
                Text(unlocked ? "Unlocked" : "Epic & Legendary only").font(.barlow(12)).foregroundColor(unlocked ? Theme.online : Theme.muted)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(s2.name).font(.chakra(18)).foregroundColor(Theme.fg)
                (Text("\(card.dmg("special2", fusion))").font(.system(size: 13, design: .monospaced)).foregroundColor(Theme.fg)
                 + Text(" damage · cooldown \(s2.cd) · gets the Special bonus too"))
                    .font(.barlow(13)).foregroundColor(Theme.muted)
            }
            if !unlocked {
                HStack(spacing: 10) {
                    (Text("Costs ") + Text("\(secondCopies) copies").font(.chakra(13)).foregroundColor(Theme.fg)
                     + Text(" + ") + Text("\(secondGold.formatted()) gold").font(.chakra(13)).foregroundColor(Theme.fg))
                        .font(.barlow(13)).foregroundColor(Theme.muted)
                    Spacer(minLength: 4)
                    Button("Unlock") { fuse("x", title: s2.name, before: 0, after: card.dmg("special2", bumped("x"))) }
                        .buttonStyle(GoldButton(height: 40)).frame(width: 100)
                        .disabled(busy || short != nil)
                }
                if let short { Text(short).font(.barlow(12)).foregroundColor(Color(hex: 0xFF7884)) }
            }
        }
        .padding(14)
        .background(LinearGradient(colors: [Theme.brass.opacity(0.16), Theme.field], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Self.gold.opacity(0.6), lineWidth: 1))
    }

    // MARK: result (same layout as the other reward screens)

    private func done(_ r: (line: String, before: Int, after: Int, stat: String)) -> some View {
        VStack(spacing: 18) {
            Spacer()
            Text(r.stat == "x" ? "Unlocked!" : "Fused!").font(.chakra(34)).textCase(.uppercase).foregroundColor(Self.gold)
                .shadow(color: Self.gold.opacity(0.6), radius: 12)
            CardView(card: card, fusion: fusion).frame(width: 210).shadow(color: Self.gold.opacity(0.7), radius: 22)
            HStack(spacing: 8) {
                Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)).foregroundColor(Self.gold)
                Text(r.line)
                if r.stat != "x" {
                    Text("\(r.before)").font(.system(size: 16, design: .monospaced))
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                }
                Text("\(r.after)").font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundColor(Self.gold)
            }
            .font(.barlow(16)).foregroundColor(Theme.muted)
            Button("Nice") { result = nil }.buttonStyle(GoldButton()).frame(width: 240)
            Spacer()
        }
        .padding(.horizontal, 24)
        .onAppear { Sound.legendary.play() }
    }

    private func fuse(_ stat: String, title: String, before: Int, after: Int) {
        busy = true; error = nil
        Task {
            do {
                let p: Profile = try await API.call("fuse", token: store.token, body: ["card": card.id, "stat": stat, "holo": holo])
                store.profile = p
                result = (title, before, after, stat)
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func pipLabel(_ name: String, _ level: Int) -> some View {
        HStack(spacing: 6) { Text(name); Pips(level: level, size: 7) }
    }

    private func closeButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass)
                .frame(width: 40, height: 40).goldPanel(12)
        }
        .accessibilityLabel("Close")
    }
}

// Three diamonds: how many times a stat has been fused.
struct Pips: View {
    let level: Int
    var size: CGFloat = 8
    var body: some View {
        HStack(spacing: size * 0.6) {
            ForEach(0..<3, id: \.self) { i in
                Rectangle().fill(i < level ? Color(hex: 0xFFD77A) : Theme.fg.opacity(0.15))
                    .frame(width: size, height: size).rotationEffect(.degrees(45))
                    .shadow(color: i < level ? Color(hex: 0xFFD77A) : .clear, radius: 3)
            }
        }
        .accessibilityLabel("\(level) of 3")
    }
}
