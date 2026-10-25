import SwiftUI
import UIKit

// The battle screen, shared by friend matches and the campaign (approved design: "HoloSynth Battle Screen" canvas).
// Fixed layout so nothing jumps: enemy row, whose-turn badge, your row, and a move bar that is always there.
// New moves from the server are played back one at a time: the attacker lunges, the target shakes and flashes,
// the damage number pops and the HP bar drains.
struct BattleBoard: View {
    let state: BattleState                  // latest from the server
    let you: Int
    let eyebrow: String                     // e.g. "LEVEL 3"
    let title: String                       // e.g. "Night shift"
    let foeName: String
    let leaveLabel: String
    let leaveQuestion: String
    let onMove: (_ from: Int, _ move: String, _ to: Int) async throws -> Void
    let onLeave: () async -> Void
    var onSettled: () -> Void = {}          // playback finished and the screen shows `state`

    // not private: a private stored property would make the memberwise init private to this file
    @State var shown: BattleState?          // what's on screen; lags behind `latest` while moves play back
    @State var latest: BattleState?         // newest state seen (a @State so a running playback sees later ones)
    @State var acting: Int?                 // side whose move is playing back
    @State var fx: [Int: HitFX] = [:]       // per card, keyed side * 10 + index
    @State var selected: Int?
    @State var move: String?
    @State var sending = false
    @State var playing = false
    @State var error: String?
    @State var confirmLeave = false
    @State var pulse = false

    struct HitFX: Equatable {
        var lunge: CGFloat = 0
        var shakes: CGFloat = 0
        var flash = false
        var pop: Int?
        var ghostHP: Int?
    }

    private var s: BattleState { shown ?? state }
    private var myTurn: Bool { s.turn == you && s.winner == nil && !playing }
    private var cardWidth: CGFloat {
        switch max(s.teams[0].count, s.teams[1].count) {
        case 1: return 170
        case 2: return 150
        default: return 112
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Text("Enemy").font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase)
                .foregroundColor(Color(hex: 0xFF7884)).frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 6)
            row(side: 1 - you)
            Spacer(minLength: 12)
            turnBadge
            Spacer(minLength: 12)
            row(side: you)
            teamLabel.padding(.horizontal, 12).padding(.top, 6)
            moveBar.padding(.top, 16)
        }
        .onAppear {
            if shown == nil { shown = state; latest = state }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onChange(of: state) { new in
            latest = new
            Task { await playBack() }
        }
    }

    // MARK: pieces

    private var topBar: some View {
        HStack(spacing: 12) {
            Button { confirmLeave = true } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.muted)
                    .frame(width: 44, height: 44).goldPanel(12)
            }
            .accessibilityLabel(leaveLabel)
            .opacity(s.winner == nil ? 1 : 0)
            .disabled(s.winner != nil)
            .confirmationDialog(leaveQuestion, isPresented: $confirmLeave, titleVisibility: .visible) {
                Button(leaveLabel, role: .destructive) { Task { await onLeave() } }
            }
            VStack(spacing: 1) {
                Text(eyebrow).font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                Text(title).font(.chakra(17)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 16).padding(.top, 4)
    }

    private var turnBadge: some View {
        let side = acting ?? s.turn
        let mine = side == you
        return Group {
            if s.winner == nil {
                Text(mine ? "Your turn" : "Enemy turn")
                    .font(.chakra(14)).tracking(2.5).textCase(.uppercase)
                    .padding(.horizontal, 18).padding(.vertical, 7)
                    .foregroundColor(mine ? Color(hex: 0x1A0D05) : Color(hex: 0xFF7884))
                    .background {
                        if mine {
                            Capsule().fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom))
                                .shadow(color: Color(hex: 0xE0A12A).opacity(0.4), radius: 10, y: 6)
                        } else {
                            Capsule().fill(Color(hex: 0xFF4D5E).opacity(0.15))
                                .overlay(Capsule().stroke(Color(hex: 0xFF4D5E).opacity(0.6), lineWidth: 1))
                        }
                    }
                    .id(mine)
                    .transition(.scale(scale: 0.7).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.6), value: mine)
        .frame(height: 34)
    }

    private func row(side: Int) -> some View {
        HStack(alignment: side == you ? .bottom : .top, spacing: cardWidth > 150 ? 0 : (cardWidth > 112 ? 16 : 8)) {
            ForEach(Array(s.teams[side].enumerated()), id: \.offset) { i, unit in
                if let card = CardBook.card(unit.id) { token(card, unit: unit, side: side, index: i) }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
    }

    private func token(_ card: Card, unit: Unit, side: Int, index i: Int) -> some View {
        let mine = side == you
        let f = fx[side * 10 + i] ?? HitFX()
        let ko = unit.hp == 0
        let acted = s.acted[side][i]
        let ready = mine && myTurn && !ko && !acted
        let isSelected = mine && selected == i && myTurn
        let isTarget = !mine && myTurn && selected != nil && move != nil && !ko
        let w = cardWidth
        let artH = (w / 1.3).rounded()
        let pct = CGFloat(unit.hp) / CGFloat(card.hp)
        let look = outline(red: f.flash || isTarget, gold: isSelected || f.lunge != 0, ready: ready)
        let small: CGFloat = w > 150 ? 13 : (w > 112 ? 12 : 11)

        return VStack(spacing: 0) {
            ZStack {
                if let img = Art.image(card.id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel }
                if f.flash { Color(hex: 0xFF4D5E).opacity(0.35) }
                if let dmg = f.pop {
                    Text("−\(dmg)").font(.chakra(w > 150 ? 40 : (w > 112 ? 34 : 28))).foregroundColor(.white)
                        .shadow(color: Color(hex: 0xFF4D5E), radius: 8).shadow(color: .black, radius: 1, y: 2)
                        .transition(.asymmetric(insertion: .scale(scale: 0.3).combined(with: .opacity),
                                                removal: .opacity.combined(with: .offset(y: -26))))
                }
                if ko {
                    Text("KO").font(.chakra(w > 150 ? 40 : 28)).foregroundColor(Theme.pink)
                        .shadow(color: .black, radius: 1, y: 2)
                        .transition(.scale(scale: 2.2).combined(with: .opacity))
                }
                if isTarget, let dmg = previewDamage(to: unit) {
                    VStack { Spacer()
                        Text("−\(dmg)").font(.chakra(small)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 3)
                            .background(Color(hex: 0xFF4D5E).opacity(0.92), in: RoundedRectangle(cornerRadius: 8))
                            .padding(6)
                    }
                }
                VStack {
                    HStack {
                        if acted && !ko && mine { chip("DONE", size: small - 2) }
                        Spacer()
                        if unit.cd > 0 && !ko { chip("⟳ \(unit.cd)", size: small - 2) }
                    }
                    Spacer()
                }
                .padding(5)
            }
            .frame(width: w, height: artH)
            .clipped()
            .saturation(ko ? 0 : 1)

            VStack(spacing: 5) {
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(Theme.classColor(card.cls)).frame(width: 8, height: 8)
                        .accessibilityLabel(card.cls)
                    Text(card.name).font(.chakra(w > 150 ? 15 : (w > 112 ? 14 : 12))).lineLimit(1)
                    Spacer(minLength: 2)
                    Text("\(unit.hp)").font(.chakra(small)).monospacedDigit()
                }
                .foregroundColor(Theme.fg)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.1))
                        if let ghost = f.ghostHP {
                            Capsule().fill(Color(hex: 0xFF4D5E).opacity(0.6))
                                .frame(width: geo.size.width * CGFloat(ghost) / CGFloat(card.hp))
                        }
                        Capsule().fill(pct > 0.5 ? Color(hex: 0x3DFF8A) : (pct > 0.25 ? Color(hex: 0xFFB03D) : Color(hex: 0xFF4D5E)))
                            .frame(width: geo.size.width * pct)
                    }
                }
                .frame(height: 6)
            }
            .padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 8)
        }
        .frame(width: w)
        .background(cardTint(card), in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(look.ring, lineWidth: look.width))
        .shadow(color: look.glow, radius: look.radius)
        .opacity(ko ? 0.4 : (mine && acted && myTurn ? 0.45 : 1))
        .scaleEffect(ko ? 0.94 : 1)
        .modifier(Shake(animatableData: f.shakes))
        .offset(y: (isSelected ? (mine ? -10 : 10) : 0) + f.lunge * (mine ? -30 : 30))
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
        .animation(.easeOut(duration: 0.4), value: ko)
        .contentShape(Rectangle())
        .onTapGesture { tap(side: side, index: i, unit: unit) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(ready || isTarget ? .isButton : [])
    }

    // Card outline: red when targeted or hit, bright gold when selected or attacking, soft pulsing gold when ready.
    private func outline(red: Bool, gold: Bool, ready: Bool) -> (ring: Color, glow: Color, width: CGFloat, radius: CGFloat) {
        if red { return (Color(hex: 0xFF4D5E), Color(hex: 0xFF4D5E).opacity(0.7), 2, 16) }
        if gold { return (Color(hex: 0xFFD77A), Theme.brass.opacity(0.8), 2, 18) }
        if ready { return (Theme.brass, Theme.brass.opacity(pulse ? 0.55 : 0.15), 1, 10) }
        return (Color(hex: 0x9A97AD).opacity(0.45), .clear, 1, 0)
    }

    private func chip(_ text: String, size: CGFloat) -> some View {
        Text(text).font(.chakra(size)).foregroundColor(Theme.muted)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Theme.ink.opacity(0.85), in: RoundedRectangle(cornerRadius: 6))
    }

    private var teamLabel: some View {
        let team = s.teams[you]
        let living = team.indices.filter { team[$0].hp > 0 }
        let left = living.filter { !s.acted[you][$0] }.count
        return HStack {
            Text("Your team").font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
            Spacer()
            if living.count > 1 && s.winner == nil {
                HStack(spacing: 5) {
                    ForEach(0..<living.count, id: \.self) { i in
                        Circle().fill(i < left ? Theme.brass : Theme.brass.opacity(0.2)).frame(width: 7, height: 7)
                    }
                    Text("\(left) of \(living.count) left this round").font(.barlow(12)).foregroundColor(Theme.muted)
                }
            }
        }
    }

    private var moveBar: some View {
        let card = selected.flatMap { s.teams[you].indices.contains($0) ? CardBook.card(s.teams[you][$0].id) : nil }
        let unit = selected.flatMap { s.teams[you].indices.contains($0) ? s.teams[you][$0] : nil }
        return VStack(spacing: 10) {
            Text(error ?? prompt(card)).font(.barlow(15, semibold: true))
                .foregroundColor(error != nil ? Theme.pink : (myTurn || playing ? Theme.fg : Color(hex: 0xFF7884)))
                .multilineTextAlignment(.center).lineLimit(2).frame(minHeight: 20)
            HStack(spacing: 10) {
                moveButton("basic", card: card, unit: unit)
                moveButton("special", card: card, unit: unit)
            }
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(Theme.ink.opacity(0.92).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.brass.opacity(0.25)).frame(height: 1) }
    }

    private func moveButton(_ kind: String, card: Card?, unit: Unit?) -> some View {
        let name: String, sub: String
        var enabled = false
        if let card, let unit, myTurn {
            name = kind == "basic" ? card.basic.name : card.special.name
            if kind == "special" && unit.cd > 0 { sub = "Ready in \(unit.cd) turn\(unit.cd == 1 ? "" : "s")" }
            else {
                sub = kind == "basic" ? "\(card.basic.dmg) damage" : "\(card.special.dmg) damage · then waits \(card.special.cd)"
                enabled = !sending
            }
        } else {
            name = kind == "basic" ? "Basic attack" : "Special"
            sub = myTurn ? "Pick a card first" : "Wait for your turn"
        }
        let chosen = move == kind && card != nil && myTurn
        return Button { choose(kind) } label: {
            VStack(spacing: 3) {
                Text(name).font(.chakra(16)).lineLimit(1).minimumScaleFactor(0.7)
                Text(sub).font(.barlow(13, semibold: true)).lineLimit(1).minimumScaleFactor(0.7)
                    .foregroundColor(chosen ? Color(hex: 0x3A2408) : (enabled ? Theme.brass : Color(hex: 0x6E6A88)))
            }
            .foregroundColor(chosen ? Color(hex: 0x1A0D05) : (enabled ? Theme.fg : Color(hex: 0x6E6A88)))
            .frame(maxWidth: .infinity).frame(height: 66)
            .background {
                if chosen {
                    RoundedRectangle(cornerRadius: 14).fill(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom))
                        .shadow(color: Color(hex: 0xE0A12A).opacity(0.4), radius: 10, y: 6)
                } else {
                    RoundedRectangle(cornerRadius: 14).fill(Theme.field)
                        .overlay(RoundedRectangle(cornerRadius: 14)
                            .stroke(Theme.brass.opacity(enabled ? 0.55 : 0.2), style: StrokeStyle(lineWidth: 1, dash: card == nil ? [4] : [])))
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .animation(.spring(response: 0.25), value: chosen)
    }

    // MARK: rules shown on screen

    private func prompt(_ card: Card?) -> String {
        if playing { return acting == you ? "Hit!" : "\(foeName) attacks…" }
        if s.winner != nil { return "" }
        if s.turn != you { return "Waiting for \(foeName)…" }
        if let card, let mv = move {
            return "Tap an enemy to hit it with \(mv == "special" ? card.special.name : card.basic.name)"
        }
        if let card { return "\(card.name) is up. Choose a move." }
        let ready = s.teams[you].indices.filter { s.teams[you][$0].hp > 0 && !s.acted[you][$0] }
        if ready.count == 1, let c = CardBook.card(s.teams[you][ready[0]].id) {
            return s.teams[you].count > 1 && s.acted[you].contains(true) ? "\(c.name) hasn't gone yet this round. Tap \(c.name)." : "Tap \(c.name) to act"
        }
        return "Tap one of your glowing cards"
    }

    private static let beats = ["Fighter": "Beast", "Beast": "Mech", "Mech": "Fighter"]

    // Same sum as the server: +20% when the attacker's class beats the target's.
    private func previewDamage(to target: Unit) -> Int? {
        guard let sel = selected, let mv = move, let a = CardBook.card(s.teams[you][sel].id), let t = CardBook.card(target.id) else { return nil }
        let base = Double(mv == "special" ? a.special.dmg : a.basic.dmg)
        return Int((base * (Self.beats[a.cls] == t.cls ? 1.2 : 1)).rounded())
    }

    // MARK: input

    private func tap(side: Int, index i: Int, unit: Unit) {
        guard myTurn, !sending, unit.hp > 0 else { return }
        if side == you {
            guard !s.acted[you][i] else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            if selected == i { selected = nil; move = nil } else { selected = i; move = nil }
            error = nil
        } else if let from = selected, let mv = move {
            send(from: from, move: mv, to: i)
        }
    }

    private func choose(_ kind: String) {
        guard let from = selected else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        move = kind
        // one enemy left standing: no need to tap it
        let living = s.teams[1 - you].indices.filter { s.teams[1 - you][$0].hp > 0 }
        if living.count == 1 { send(from: from, move: kind, to: living[0]) }
    }

    private func send(from: Int, move mv: String, to: Int) {
        sending = true
        error = nil
        Task {
            do { try await onMove(from, mv, to) }
            catch { self.error = error.localizedDescription; move = nil }
            sending = false
        }
    }

    // MARK: playback

    private func key(_ side: Int, _ i: Int) -> Int { side * 10 + i }

    private func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }

    private func playBack() async {
        guard !playing else { return }      // the running playback picks up later states itself
        playing = true
        while let from = shown, let target = latest, from != target {
            let fresh = max(0, min((target.moves ?? target.log.count) - (from.moves ?? from.log.count), target.log.count))
            var cur = from
            selected = nil; move = nil
            for e in target.log.suffix(fresh) {
                guard cur.teams.indices.contains(1 - e.p), cur.teams[1 - e.p].indices.contains(e.to) else { continue }
                let a = key(e.p, e.from), t = key(1 - e.p, e.to)
                if acting != e.p { withAnimation { acting = e.p }; await pause(0.35) }
                withAnimation(.easeIn(duration: 0.16)) { fx[a, default: HitFX()].lunge = 1 }
                await pause(0.16)
                // impact
                UIImpactFeedbackGenerator(style: e.ko ? .heavy : .medium).impactOccurred()
                fx[t, default: HitFX()].ghostHP = cur.teams[1 - e.p][e.to].hp
                cur.teams[1 - e.p][e.to].hp = max(0, cur.teams[1 - e.p][e.to].hp - e.dmg)
                withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { fx[a]?.lunge = 0 }
                withAnimation(.linear(duration: 0.45)) { fx[t]?.shakes += 1 }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { fx[t]?.flash = true; fx[t]?.pop = e.dmg }
                withAnimation(.easeOut(duration: 0.45)) { shown = cur }
                await pause(0.3)
                withAnimation(.easeOut(duration: 0.3)) { fx[t]?.flash = false }
                await pause(0.35)
                withAnimation(.easeOut(duration: 0.5)) { fx[t]?.ghostHP = nil; fx[t]?.pop = nil }
                await pause(0.45)
            }
            withAnimation(.easeOut(duration: 0.25)) { shown = target; acting = nil }
            if target.turn == you && target.winner == nil { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        }
        playing = false
        onSettled()
    }
}
