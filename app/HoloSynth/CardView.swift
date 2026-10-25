import SwiftUI

// A HoloSynth card front, drawn like the design sheet: 5:7, class symbol + name + HP, art, two moves.
// Everything scales with the card's width so it reads the same at any size.
struct CardView: View {
    let card: Card
    var hpNow: Int? = nil        // in battle: current HP
    var cooldown: Int = 0        // in battle: turns left before the special is ready

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
                    Spacer(minLength: 2)
                    Text(hpNow.map { "\($0)/\(card.hp) HP" } ?? "\(card.hp) HP")
                        .font(.system(size: w * 0.055, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.pink)
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
                    moveRow(card.basic.name, dmg: card.basic.dmg, cd: nil, w: w)
                    moveRow(card.special.name, dmg: card.special.dmg, cd: cooldown > 0 ? cooldown : card.special.cd, w: w,
                            ready: cooldown == 0)
                }
                Spacer(minLength: 0)
            }
            .foregroundColor(Theme.fg)
            .padding(w * 0.05)
            .frame(width: w, height: geo.size.height, alignment: .top)
            .background(LinearGradient(colors: [tint(0.38, over: 0x12111D), tint(0.12, over: 0x0A0912)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
            .clipShape(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous)
                .stroke(Theme.rarityColor(card.rarity), lineWidth: max(1, w * 0.008)))
        }
        .aspectRatio(5.0 / 7.0, contentMode: .fit)
    }

    // The character colour blended into a dark base, same as the design sheet's color-mix.
    private func tint(_ amount: Double, over base: UInt32) -> Color {
        let c = UInt32(card.color.dropFirst(), radix: 16) ?? base
        func ch(_ v: UInt32, _ shift: UInt32) -> Double { Double((v >> shift) & 0xFF) / 255 }
        func mix(_ shift: UInt32) -> Double { ch(c, shift) * amount + ch(base, shift) * (1 - amount) }
        return Color(red: mix(16), green: mix(8), blue: mix(0))
    }

    private func moveRow(_ name: String, dmg: Int, cd: Int?, w: CGFloat, ready: Bool = true) -> some View {
        HStack(spacing: w * 0.02) {
            Text(name).font(.system(size: w * 0.046, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
            if let cd {
                Text("\(cd)")
                    .font(.system(size: w * 0.03, weight: .regular, design: .monospaced))
                    .frame(width: w * 0.05, height: w * 0.05)
                    .background(Circle().fill(Theme.classColor(card.cls).opacity(ready ? 0.28 : 0.6)))
            }
            Spacer(minLength: 2)
            Text("\(dmg)").font(.system(size: w * 0.043, design: .monospaced))
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
