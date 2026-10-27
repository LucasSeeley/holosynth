import SwiftUI

// A power card face (5:7 like the character cards): POWER tag and rarity, the art (or its symbol until art arrives),
// the name and what it does.
struct PowerCardView: View {
    let power: Power

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, tint = Theme.rarityColor(power.rarity)
            VStack(alignment: .leading, spacing: w * 0.04) {
                HStack {
                    Text("Power").font(.chakra(w * 0.045, semibold: true)).tracking(w * 0.01).textCase(.uppercase).foregroundColor(Power.violet)
                    Spacer()
                    Text(power.rarity).font(.system(size: w * 0.045)).foregroundColor(tint)
                }
                ZStack {
                    RadialGradient(colors: [tint.opacity(0.35), Color(hex: 0x120A24)], center: .center, startRadius: 0, endRadius: w * 0.5)
                    if let img = Art.image("power_" + power.id) {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else {
                        Image(systemName: power.symbol).font(.system(size: w * 0.3)).foregroundColor(Theme.cyan).shadow(color: Theme.cyan, radius: w * 0.04)
                    }
                }
                .aspectRatio(1.3, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: w * 0.07, style: .continuous))
                Text(power.name).font(.system(size: w * 0.06, weight: .bold)).lineLimit(1).minimumScaleFactor(0.6)
                Text(power.effect).font(.system(size: w * 0.046)).foregroundColor(Theme.muted).lineLimit(3).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                Text("Used up when played").font(.system(size: w * 0.036).italic()).foregroundColor(Theme.fg.opacity(0.5)).frame(maxWidth: .infinity)
            }
            .foregroundColor(Theme.fg)
            .padding(w * 0.05)
            .frame(width: w, height: geo.size.height, alignment: .top)
            .background(LinearGradient(colors: [Color(hex: 0x241240), Color(hex: 0x0B0918)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .clipShape(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: w * 0.06, style: .continuous).stroke(tint, lineWidth: max(1, w * 0.008)))
        }
        .aspectRatio(5.0 / 7.0, contentMode: .fit)
        .accessibilityElement(children: .combine)
    }
}
