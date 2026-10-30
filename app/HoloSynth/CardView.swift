import SwiftUI

// A HoloSynth card front, drawn like the design sheet: 5:7, class symbol + name + HP, art, two moves, a joke.
// Everything scales with the card's width so it reads the same at any size.
struct CardView: View {
    let card: Card
    var hpNow: Int? = nil        // in battle: current HP
    var cooldown: Int = 0        // in battle: turns left before the special is ready
    var fusion: Fusion? = nil    // fused copy: boosted stats in gold, ✦ crest, maybe a second special; holo copy: rainbow foil
    private static let goldText = Color(hex: 0xFFD77A)

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            VStack(alignment: .leading, spacing: w * 0.04) {
                HStack(alignment: .center, spacing: w * 0.02) {
                    if let icon = Art.classIcon(card.cls) {
                        Image(uiImage: icon).resizable().frame(width: w * 0.063, height: w * 0.063)
                            .accessibilityLabel(card.cls)
                    }
                    Text(card.name).font(.system(size: w * 0.055, weight: .bold))
                    if let f = fusion, f.total > 0 {
                        Text("✦ \(f.total)").font(.chakra(w * 0.04)).foregroundColor(Self.goldText)
                            .padding(.horizontal, w * 0.024).padding(.vertical, w * 0.006)
                            .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: w * 0.03))
                            .overlay(RoundedRectangle(cornerRadius: w * 0.03).stroke(Self.goldText, lineWidth: 1))
                            .accessibilityLabel("Fused \(f.total) times")
                    }
                    Spacer(minLength: 2)
                    let maxHP = card.maxHP(fusion)
                    Text(hpNow.map { "\($0)/\(maxHP) HP" } ?? "\(maxHP) HP")
                        .font(.system(size: w * 0.055, weight: .bold, design: .monospaced))
                        .foregroundColor((fusion?.h ?? 0) > 0 ? Self.goldText : Theme.pink)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.5)

                ZStack {
                    Color(hex: 0x070612)
                    if let img = Art.image(card.id) {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else if let icon = Art.classIcon(card.cls) {
                        Image(uiImage: icon).resizable().scaledToFit().padding(w * 0.2)
                    }
                }
                .aspectRatio(1.3, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: w * 0.07, style: .continuous))

                VStack(spacing: w * 0.02) {
                    moveRow(card.basic.name, dmg: card.dmg("basic", fusion), cd: nil, w: w, boosted: (fusion?.b ?? 0) > 0)
                    moveRow(card.special.name, dmg: card.dmg("special", fusion), cd: cooldown > 0 ? cooldown : card.special.cd, w: w,
                            ready: cooldown == 0, heal: card.special.heals, boosted: (fusion?.s ?? 0) > 0)
                    if fusion?.x == true || card.cls == "Synth", let s2 = card.special2 {   // Synths: always on, never fused
                        moveRow(s2.name, dmg: card.dmg("special2", fusion), cd: s2.cd, w: w, boosted: card.cls != "Synth")
                            .foregroundColor(card.cls == "Synth" ? Theme.fg : Self.goldText)   // gold only means fused
                    }
                }
                if fusion?.passive == true || card.cls == "Synth", let ps = Passives.of(card) {
                    HStack(spacing: w * 0.02) {
                        Image(systemName: "diamond.fill").font(.system(size: w * 0.035))
                        Text(ps.name).lineLimit(1).minimumScaleFactor(0.6)
                        Spacer(minLength: 2)
                        Text(ps.short).font(.system(size: w * 0.043, design: .monospaced))
                    }
                    .font(.system(size: w * 0.044, weight: .bold)).foregroundColor(Theme.cyan)
                    .padding(.horizontal, w * 0.025).padding(.vertical, w * 0.012)
                    .background(Theme.cyan.opacity(0.12), in: RoundedRectangle(cornerRadius: w * 0.03))
                    .overlay(RoundedRectangle(cornerRadius: w * 0.03).stroke(Theme.cyan.opacity(0.55), lineWidth: 1))
                    .accessibilityLabel("Passive: \(ps.name), \(ps.text)")
                }
                Spacer(minLength: 0)
                Text(card.quip)
                    .font(.system(size: w * 0.03).italic())   // one line, the same size as the printed cards
                    .foregroundColor(Theme.fg.opacity(0.62))
                    .multilineTextAlignment(.center).lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
            }
            .foregroundColor(Theme.fg)
            .padding(w * 0.05)
            .frame(width: w, height: geo.size.height, alignment: .top)
            .background(card.face)
            .clipShape(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous)
                .stroke((fusion?.total ?? 0) > 0 ? Self.goldText : Theme.rarityColor(card.rarity), lineWidth: max(1, w * ((fusion?.total ?? 0) > 0 ? 0.012 : 0.008))))
            .shadow(color: (fusion?.total ?? 0) > 0 ? Self.goldText.opacity(0.45) : .clear, radius: w * 0.06)
            .modifier(HoloFoil(on: fusion?.holo == true || card.cls == "Synth", width: w))   // Synths always look holo
        }
        .aspectRatio(5.0 / 7.0, contentMode: .fit)
    }

    private func moveRow(_ name: String, dmg: Int, cd: Int?, w: CGFloat, ready: Bool = true, heal: Bool = false, boosted: Bool = false) -> some View {
        HStack(spacing: w * 0.02) {
            Text(name).font(.system(size: w * 0.046, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
            if let cd {   // the cooldown sits right after the move name
                Text("\(cd)")
                    .font(.system(size: w * 0.035, weight: .regular).monospacedDigit())   // same size as web
                    .frame(width: w * 0.056, height: w * 0.056)
                    .background(Circle().fill(Theme.classColor(card.cls).opacity(ready ? 0.28 : 0.6)))
            }
            Spacer(minLength: 2)
            Text(heal ? "+\(dmg) HP" : "\(dmg)").font(.system(size: w * 0.043, weight: boosted ? .bold : .regular, design: .monospaced))
                .foregroundColor(heal ? Color(hex: 0x3DFF8A) : boosted ? Self.goldText : Theme.fg)
        }
    }
}

// The shared card back.
struct CardBack: View {
    var body: some View {
        GeometryReader { geo in
            Group {
                if let img = Art.image("card_back") { Image(uiImage: img).resizable().scaledToFill() }
                else { Theme.backRed }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipShape(RoundedRectangle(cornerRadius: geo.size.width * 0.06, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: geo.size.width * 0.06, style: .continuous)
                .stroke(Theme.backRed, lineWidth: max(1, geo.size.width * 0.008)))
        }
        .aspectRatio(5.0 / 7.0, contentMode: .fit)
    }
}

extension Card {
    // The character colour blended into a dark base, same as the design sheet's color-mix.
    func tint(_ amount: Double, over base: UInt32) -> Color {
        let c = UInt32(color.dropFirst(), radix: 16) ?? base
        func ch(_ v: UInt32, _ shift: UInt32) -> Double { Double((v >> shift) & 0xFF) / 255 }
        func mix(_ shift: UInt32) -> Double { ch(c, shift) * amount + ch(base, shift) * (1 - amount) }
        return Color(red: mix(16), green: mix(8), blue: mix(0))
    }

    // Card background: the character's colour, kept dark so text stays readable.
    var face: LinearGradient {
        LinearGradient(colors: [tint(0.38, over: 0x12111D), tint(0.12, over: 0x0A0912)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}
