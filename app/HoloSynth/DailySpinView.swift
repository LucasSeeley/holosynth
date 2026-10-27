import SwiftUI

// The once-a-day prize wheel. The server picks the prize; the wheel spins to land on it.
struct DailySpinView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ pack: [String]?) -> Void   // the pack won, to open on the Shop tab

    // must match SPIN_SLOTS in server/src/game.js (clockwise from the top)
    static let slots: [(kind: String, amount: Int)] = [("gold", 100), ("xp", 100), ("gold", 250), ("pack", 1), ("xp", 100),
                                                        ("gold", 500), ("xp", 250), ("gold", 100), ("xp", 500)]
    static let step = 360 / Double(slots.count)   // degrees per slice
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
        .task { await store.refresh() }   // today's wheel pack, in case the app was left open past midnight
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
            if pack, let img = Art.pack(r.packType ?? "cyber") {
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
        Text(pack ? "Jackpot! Open it from the Play tab." : gold ? "Added to your gold." : "Added to your level.")
            .font(.barlow(14)).foregroundColor(Color(hex: 0xA9A5C2))
        Button("Collect") { close() }.buttonStyle(GoldButton())
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
                    ForEach(Self.slots.indices, id: \.self) { i in slice(i, size: size) }
                }
                .rotationEffect(.degrees(angle))
                ForEach(Self.slots.indices, id: \.self) { i in   // gold pegs between slices
                    Circle().fill(Color(hex: 0xFFD77A)).frame(width: size * 0.025, height: size * 0.025)
                        .offset(y: -size * 0.456).rotationEffect(.degrees((Double(i) - 0.5) * Self.step))
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
                    if let img = Art.pack(store.profile?.spinPack ?? "cyber") { Image(uiImage: img).resizable().scaledToFit().frame(height: size * 0.19) }
                } else {
                    Text("\(amount)").font(.chakra(size * 0.075))
                    if kind == "gold" { Image(systemName: "circle.hexagongrid.fill").font(.system(size: size * 0.045)) }
                    else { Text("XP").font(.chakra(size * 0.042, semibold: true)).tracking(2) }
                }
            }
            .foregroundColor(ink)
            .padding(.top, size * (kind == "pack" ? 0.05 : 0.1))   // the pack sits in the middle of its slice
        }
        .frame(width: size * 0.91, height: size * 0.91)
        .rotationEffect(.degrees(Double(i) * Self.step))
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
                let target = 360 * 5 - Double(r.slot) * Self.step + Double.random(in: -13...13)
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
        p.addArc(center: c, radius: r, startAngle: .degrees(-90 - DailySpinView.step / 2), endAngle: .degrees(-90 + DailySpinView.step / 2), clockwise: false)
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


// Little wheel icon for the tile: coloured slices when ready, dimmed when used.
struct MiniWheel: View {
    let lit: Bool
    var body: some View {
        let on: [String: UInt32] = ["gold": 0xE8B85A, "xp": 0x3FF0FF, "pack": 0xFF4D5E]
        let off: [String: UInt32] = ["gold": 0x3A2A0E, "xp": 0x0D2A33, "pack": 0x3A0A14]
        ZStack {
            Circle().fill(Color(hex: 0x0B0A14))
            ForEach(DailySpinView.slots.indices, id: \.self) { i in
                Slice().fill(Color(hex: (lit ? on : off)[DailySpinView.slots[i].kind] ?? 0))
                    .overlay(Slice().stroke(Theme.ink, lineWidth: 1.5))
                    .padding(3).rotationEffect(.degrees(Double(i) * DailySpinView.step))
            }
            Circle().stroke(Theme.brass, lineWidth: 1.5)
            Circle().fill(Theme.brass).frame(width: 12, height: 12).overlay(Circle().stroke(Theme.ink, lineWidth: 1.5))
        }
        .shadow(color: lit ? Theme.brass.opacity(0.5) : .clear, radius: 6)
        .accessibilityHidden(true)
    }
}
