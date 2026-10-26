import SwiftUI

// The once-a-day prize wheel. The server picks the prize; the wheel spins to land on it.
struct DailySpinView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ pack: [String]?) -> Void   // the pack won, to open on the Packs tab

    // must match SPIN_SLOTS in server/src/game.js (clockwise from the top)
    static let slots: [(kind: String, amount: Int)] = [("gold", 50), ("xp", 25), ("gold", 100), ("pack", 1),
                                                        ("gold", 25), ("xp", 50), ("gold", 250), ("xp", 25)]
    @State private var angle: Double = 0
    @State private var spinning = false
    @State private var reply: SpinReply?
    @State private var landed = false
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) {
                Text("Daily spin").font(.chakra(12, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
                if landed, let r = reply { result(r) } else { ready }
            }
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity).frame(height: 600)
            .background(RadialGradient(colors: [Theme.backRed.opacity(0.35), .clear], center: UnitPoint(x: 0.5, y: 0.3),
                                       startRadius: 0, endRadius: 260), in: RoundedRectangle(cornerRadius: 26))
            .background(Color(hex: 0x0E0C18), in: RoundedRectangle(cornerRadius: 26))
            .overlay(RoundedRectangle(cornerRadius: 26).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                Button { close() } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundColor(Theme.muted)
                        .frame(width: 36, height: 36).goldPanel(10)
                }
                .accessibilityLabel("Close")
                .disabled(spinning)
                .padding(12)
            }
            .shadow(color: Theme.brass.opacity(0.18), radius: 30)
            .padding(.horizontal, 16)
        }
    }

    private var ready: some View {
        VStack(spacing: 14) {
            Text("Spin to win").font(.chakra(26)).foregroundColor(Theme.fg).padding(.top, -6)
            wheel(300)
            Text(error ?? "Gold, XP or a free pack. One spin every day.")
                .font(.barlow(14, semibold: error != nil)).foregroundColor(error != nil ? Theme.pink : Color(hex: 0xA9A5C2))
                .multilineTextAlignment(.center)
            Button("Spin") { spin() }.buttonStyle(GoldButton()).disabled(spinning)
        }
    }

    // Every prize uses the same layout (title, a fixed-height art box, line, button) so nothing jumps between them.
    @ViewBuilder private func result(_ r: SpinReply) -> some View {
        let pack = r.kind == "pack", gold = r.kind == "gold"
        let color = pack ? Color(hex: 0xFF7884) : gold ? Color(hex: 0xFFD77A) : Color(hex: 0x3FF0FF)
        Text(pack ? "Free pack!" : gold ? "\(r.amount) gold!" : "\(r.amount) XP!")
            .font(.chakra(34)).textCase(.uppercase).foregroundColor(color).shadow(color: color.opacity(0.6), radius: 12)
        ZStack {
            if pack, let img = Art.image("pack") {
                Image(uiImage: img).resizable().scaledToFit().frame(height: 250).rotationEffect(.degrees(-4))
                    .shadow(color: Theme.backRed.opacity(0.8), radius: 20, y: 14)
            } else if gold {
                Image(systemName: "hexagon.fill").font(.system(size: 170))
                    .foregroundStyle(LinearGradient(colors: [Color(hex: 0xFFE39A), Color(hex: 0xD99A22)], startPoint: .top, endPoint: .bottom))
                    .overlay(Image(systemName: "hexagon").font(.system(size: 78, weight: .heavy)).foregroundColor(Color(hex: 0x1A0D05)))
                    .shadow(color: Theme.brass.opacity(0.7), radius: 24)
            } else {
                Text("XP").font(.chakra(64)).tracking(3).foregroundColor(color).shadow(color: color.opacity(0.8), radius: 12)
                    .frame(width: 180, height: 180)
                    .background(RadialGradient(colors: [Color(hex: 0x1A4A57), Color(hex: 0x0B1E26)], center: UnitPoint(x: 0.5, y: 0.35),
                                               startRadius: 0, endRadius: 110), in: Circle())
                    .overlay(Circle().stroke(color, lineWidth: 3))
                    .shadow(color: color.opacity(0.45), radius: 30)
            }
        }
        .frame(height: 270)
        .accessibilityHidden(true)
        Text(pack ? "The wheel landed on the jackpot." : gold ? "Added to your gold." : "Added to your level.")
            .font(.barlow(14)).foregroundColor(Color(hex: 0xA9A5C2))
        Button(pack ? "Open it now" : "Collect") { close() }.buttonStyle(GoldButton())
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            Text("Next spin in \(SpinClock.left(until: r.profile.nextSpin))").font(.barlow(13)).foregroundColor(Theme.muted).monospacedDigit()
        }
    }

    // MARK: wheel

    private func wheel(_ size: CGFloat) -> some View {
        ZStack(alignment: .top) {
            ZStack {
                Circle().fill(Color(hex: 0x0B0A14))
                ZStack {
                    ForEach(0..<8, id: \.self) { i in slice(i, size: size) }
                }
                .rotationEffect(.degrees(angle))
                ForEach(0..<8, id: \.self) { i in   // gold pegs between slices
                    Circle().fill(Color(hex: 0xFFD77A)).frame(width: size * 0.025, height: size * 0.025)
                        .offset(y: -size * 0.456).rotationEffect(.degrees(Double(i) * 45 - 22.5))
                }
                Circle().stroke(Theme.brass, lineWidth: 3)
                Circle().fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom))
                    .frame(width: size * 0.21, height: size * 0.21)
                    .overlay(Circle().stroke(Theme.ink, lineWidth: 4))
                    .overlay(Text("Spin").font(.chakra(size * 0.047)).tracking(1.5).textCase(.uppercase).foregroundColor(Color(hex: 0x1A0D05)))
            }
            .frame(width: size, height: size)
            Pointer().fill(Color(hex: 0xFF4D5E)).overlay(Pointer().stroke(Theme.ink, lineWidth: 3))
                .frame(width: 30, height: 36).offset(y: -16).shadow(color: .black.opacity(0.6), radius: 4, y: 3)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Prize wheel: gold, XP and a free pack")
    }

    private func slice(_ i: Int, size: CGFloat) -> some View {
        let (kind, amount) = Self.slots[i]
        let lit = landed && reply?.slot == i
        let fg = kind == "gold" ? Theme.brass : kind == "xp" ? Color(hex: 0x3FF0FF) : Color(hex: 0xFF4D5E)
        let bg = kind == "gold" ? Color(hex: 0x3A2A0E) : kind == "xp" ? Color(hex: 0x0D2A33) : Color(hex: 0x3A0A14)
        let ink = lit ? Color(hex: 0x1A0D05) : fg
        return ZStack(alignment: .top) {
            Slice().fill(lit ? fg : bg).overlay(Slice().stroke(Theme.ink, lineWidth: 3))
            VStack(spacing: 1) {
                if kind == "pack" {
                    if let img = Art.image("pack") { Image(uiImage: img).resizable().scaledToFit().frame(height: size * 0.16) }
                    Text("Pack").font(.chakra(size * 0.038)).tracking(1.5).textCase(.uppercase)
                } else {
                    Text("\(amount)").font(.chakra(size * 0.075))
                    if kind == "gold" { Image(systemName: "circle.hexagongrid.fill").font(.system(size: size * 0.045)) }
                    else { Text("XP").font(.chakra(size * 0.042, semibold: true)).tracking(2) }
                }
            }
            .foregroundColor(ink)
            .padding(.top, size * 0.1)
        }
        .frame(width: size * 0.91, height: size * 0.91)
        .rotationEffect(.degrees(Double(i) * 45))
    }

    // MARK: actions

    private func spin() {
        spinning = true
        error = nil
        Sound.move.play()
        Task { @MainActor in
            do {
                let r: SpinReply = try await API.call("spin", token: store.token, body: [:])
                reply = r
                // land the won slot under the pointer after 5 full turns, a little off-centre so it looks natural
                let target = 360 * 5 - Double(r.slot) * 45 + Double.random(in: -15...15)
                withAnimation(.timingCurve(0.12, 0.7, 0.1, 1, duration: 4.2)) { angle = target }
                try? await Task.sleep(nanoseconds: 4_300_000_000)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                (r.kind == "pack" ? Sound.legendary : Sound.rare).play()
                withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) { landed = true }
            } catch {
                self.error = error.localizedDescription
            }
            spinning = false
        }
    }

    private func close() {
        if let r = reply { store.profile = r.profile }
        onClose(reply?.kind == "pack" ? reply?.cards : nil)
    }

}

// One eighth of the wheel, pointing up.
private struct Slice: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY), r = min(rect.width, rect.height) / 2
        var p = Path()
        p.move(to: c)
        p.addArc(center: c, radius: r, startAngle: .degrees(-90 - 22.5), endAngle: .degrees(-90 + 22.5), clockwise: false)
        p.closeSubpath()
        return p
    }
}

// The red pin at the top of the wheel.
private struct Pointer: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let r = rect.width / 2
        p.move(to: CGPoint(x: rect.midX, y: rect.maxY))    // tip, then up round the head and back
        p.addArc(center: CGPoint(x: rect.midX, y: rect.minY + r), radius: r * 0.95, startAngle: .degrees(160), endAngle: .degrees(20), clockwise: false)
        p.closeSubpath()
        return p
    }
}

enum SpinClock {
    // "05:12:48" until the wheel resets (server time, ms since 1970).
    static func left(until ms: Double) -> String {
        let t = max(0, Int(ms / 1000 - Date().timeIntervalSince1970))
        return String(format: "%02d:%02d:%02d", t / 3600, t / 60 % 60, t % 60)
    }
    static func ready(_ ms: Double) -> Bool { ms / 1000 <= Date().timeIntervalSince1970 }
}

// The Play tab's Daily Spin row: glows with a Spin button when ready, counts down once today's spin is used.
struct SpinTile: View {
    let nextSpin: Double
    let open: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let ready = SpinClock.ready(nextSpin)
            HStack(spacing: 12) {
                MiniWheel(lit: ready).frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daily spin").font(.chakra(16)).foregroundColor(Theme.fg)
                    Text(ready ? "Ready to spin!" : "Next spin in").font(.barlow(13)).foregroundColor(ready ? Theme.brass : Color(hex: 0xA9A5C2))
                }
                Spacer(minLength: 4)
                if ready {
                    Button("Spin", action: open).buttonStyle(GoldButton(height: 40)).frame(width: 90)
                } else {
                    Label(SpinClock.left(until: nextSpin), systemImage: "clock").font(.chakra(15)).monospacedDigit()
                        .foregroundColor(Theme.fg).labelStyle(.titleAndIcon)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.brass.opacity(0.25), lineWidth: 1))
                }
            }
            .padding(.leading, 11).padding(.trailing, 12).frame(height: 68)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(ready ? 0.55 : 0.2), lineWidth: 1))
            .shadow(color: Theme.brass.opacity(ready ? 0.15 : 0), radius: 12)
            .contentShape(Rectangle())
            .onTapGesture { if ready { open() } }
        }
    }
}

// Little wheel icon for the tile: coloured slices when ready, dimmed when used.
private struct MiniWheel: View {
    let lit: Bool
    var body: some View {
        let on: [UInt32] = [0xE8B85A, 0x3FF0FF, 0xE8B85A, 0xFF4D5E, 0xE8B85A, 0x3FF0FF, 0xE8B85A, 0x3FF0FF]
        let off: [UInt32] = [0x3A2A0E, 0x0D2A33, 0x3A2A0E, 0x3A0A14, 0x3A2A0E, 0x0D2A33, 0x3A2A0E, 0x0D2A33]
        ZStack {
            Circle().fill(Color(hex: 0x0B0A14))
            ForEach(0..<8, id: \.self) { i in
                Slice().fill(Color(hex: (lit ? on : off)[i])).overlay(Slice().stroke(Theme.ink, lineWidth: 1.5))
                    .padding(3).rotationEffect(.degrees(Double(i) * 45))
            }
            Circle().stroke(Theme.brass, lineWidth: 1.5)
            Circle().fill(Theme.brass).frame(width: 12, height: 12).overlay(Circle().stroke(Theme.ink, lineWidth: 1.5))
        }
        .shadow(color: lit ? Theme.brass.opacity(0.5) : .clear, radius: 6)
        .accessibilityHidden(true)
    }
}
