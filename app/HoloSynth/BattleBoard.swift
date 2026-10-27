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
        var heal = false             // the flash and number are a heal (green, +) rather than a hit
        var callout: String?         // a passive kicking in: "◆ LIFESTEAL +13"
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
            if state.winner == nil { Music.play(.battle) }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onDisappear { Music.play(.menu) }
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
        let isTarget = myTurn && selected != nil && move != nil && !ko && (healing ? mine : !mine)
        let w = cardWidth
        let artH = (w / 1.3).rounded()
        let pct = CGFloat(unit.hp) / CGFloat(unit.max ?? card.hp)
        let look = (healing && isTarget) || (f.flash && f.heal) ? outline(green: true)
            : outline(red: f.flash || isTarget, gold: (isSelected && !isTarget) || f.lunge != 0, ready: ready)
        let small: CGFloat = w > 150 ? 13 : (w > 112 ? 12 : 11)

        return VStack(spacing: 0) {
            ZStack {
                if let img = Art.image(card.id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel }
                if f.flash { Color(hex: f.heal ? 0x3DFF8A : 0xFF4D5E).opacity(f.heal ? 0.25 : 0.35) }
                if let dmg = f.pop {
                    Text(f.heal ? "+\(dmg)" : "−\(dmg)").font(.chakra(w > 150 ? 40 : (w > 112 ? 34 : 28))).foregroundColor(.white)
                        .shadow(color: Color(hex: f.heal ? 0x3DFF8A : 0xFF4D5E), radius: 8).shadow(color: .black, radius: 1, y: 2)
                        .transition(.asymmetric(insertion: .scale(scale: 0.3).combined(with: .opacity),
                                                removal: .opacity.combined(with: .offset(y: -26))))
                }
                if let c = f.callout {
                    VStack {
                        Text(c).font(.chakra(small)).tracking(1).foregroundColor(Theme.cyan).lineLimit(1).minimumScaleFactor(0.6)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Theme.ink.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.cyan, lineWidth: 1))
                            .shadow(color: Theme.cyan.opacity(0.6), radius: 6)
                        Spacer()
                    }
                    .padding(.top, 8).padding(.horizontal, 4)
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
                if ko {
                    Text("KO").font(.chakra(w > 150 ? 40 : 28)).foregroundColor(Theme.pink)
                        .shadow(color: .black, radius: 1, y: 2)
                        .transition(.scale(scale: 2.2).combined(with: .opacity))
                }
                if isTarget, let dmg = previewDamage(to: unit) {
                    VStack { Spacer()
                        Text(healing ? "+\(dmg)" : "−\(dmg)").font(.chakra(small)).foregroundColor(healing ? Color(hex: 0x06210F) : .white)
                            .frame(maxWidth: .infinity).padding(.vertical, 3)
                            .background(Color(hex: healing ? 0x3DFF8A : 0xFF4D5E).opacity(0.92), in: RoundedRectangle(cornerRadius: 8))
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
                                .frame(width: geo.size.width * CGFloat(ghost) / CGFloat(unit.max ?? card.hp))
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
        .background(card.face, in: RoundedRectangle(cornerRadius: 12))
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
    private func outline(green: Bool) -> (ring: Color, glow: Color, width: CGFloat, radius: CGFloat) {
        (Color(hex: 0x3DFF8A), Color(hex: 0x3DFF8A).opacity(0.7), 2, 16)
    }

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
                if unit?.cd2 != nil { moveButton("special2", card: card, unit: unit) }   // fused Epic/Legendary
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
            let wait = kind == "special2" ? (unit.cd2 ?? 0) : unit.cd
            name = kind == "basic" ? card.basic.name : kind == "special2" ? (card.special2?.name ?? "Special") : card.special.name
            if kind != "basic" && wait > 0 { sub = "Ready in \(wait) turn\(wait == 1 ? "" : "s")" }
            else {
                let dmg = card.dmg(kind, unit.f)
                sub = kind == "basic" ? "\(dmg) damage"
                    : kind == "special2" ? "\(dmg) damage · then waits \(card.special2?.cd ?? 0)"
                    : card.special.heals ? "Heals \(dmg) · then waits \(card.special.cd)"
                    : "\(dmg) damage · then waits \(card.special.cd)"
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
            if healing { return "Tap one of your cards to heal it with \(card.special.name)" }
            return "Tap an enemy to hit it with \(mv == "special" ? card.special.name : mv == "special2" ? (card.special2?.name ?? "") : card.basic.name)"
        }
        if let card { return "\(card.name) is up. Choose a move." }
        let ready = s.teams[you].indices.filter { s.teams[you][$0].hp > 0 && !s.acted[you][$0] }
        if ready.count == 1, let c = CardBook.card(s.teams[you][ready[0]].id) {
            return s.teams[you].count > 1 && s.acted[you].contains(true) ? "\(c.name) hasn't gone yet this round. Tap \(c.name)." : "Tap \(c.name) to act"
        }
        return "Tap one of your glowing cards"
    }

    // Same table as the server: each class beats two others.
    private static let beats: [String: [String]] = [
        "Fighter": ["Beast", "Arcanist"], "Beast": ["Mech", "Mystic"], "Mech": ["Fighter", "Spirit"],
        "Arcanist": ["Spirit", "Beast"], "Spirit": ["Mystic", "Fighter"], "Mystic": ["Arcanist", "Mech"],
    ]

    // The selected card is about to use a healing special: targets are your own cards.
    private var healing: Bool {
        guard move == "special", let sel = selected, s.teams[you].indices.contains(sel),
              let c = CardBook.card(s.teams[you][sel].id) else { return false }
        return c.special.heals
    }

    // Same sum as the server's hitFor: passives, then +20% when the attacker's class beats the target's, then the target's guard.
    private func previewDamage(to target: Unit) -> Int? {
        guard let sel = selected, let mv = move, let a = CardBook.card(s.teams[you][sel].id), let t = CardBook.card(target.id) else { return nil }
        let u = s.teams[you][sel], f = u.f
        if healing {
            let amount = Double(a.dmg("special", f)) * (u.ps == "blessing" ? 1 + Passives.value(a) / 100 : 1)
            return min(Int(amount.rounded()), (target.max ?? t.hp) - target.hp)
        }
        let low = { (x: Unit, c: Card) in Double(x.hp) < Double(x.max ?? c.hp) * 0.3 }
        var pct = 100.0
        switch u.ps ?? "" {
        case "firststrike" where u.hit != true: pct += Passives.value(a)
        case "momentum" where mv == "basic": pct += Passives.value(a) * Double(u.mom ?? 0)
        case "executioner" where low(target, t): pct += Passives.value(a)
        case "laststand" where low(u, a): pct += Passives.value(a)
        default: break
        }
        var dmg = (Double(a.dmg(mv, f)) * pct / 100 * (Self.beats[a.cls, default: []].contains(t.cls) ? 1.2 : 1)).rounded()
        if target.ps == "armor" || (target.ps == "phaseshift" && target.ph != true) { dmg = (dmg * (1 - Passives.value(t) / 100)).rounded() }
        return Int(dmg)
    }

    // MARK: input

    private func tap(side: Int, index i: Int, unit: Unit) {
        guard myTurn, !sending, unit.hp > 0 else { return }
        if side == you, healing, let from = selected {
            send(from: from, move: "special", to: i)
        } else if side == you {
            guard !s.acted[you][i] else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            Sound.select.play()
            if selected == i { selected = nil; move = nil } else { selected = i; move = nil }
            error = nil
        } else if let from = selected, let mv = move {
            send(from: from, move: mv, to: i)
        }
    }

    private func choose(_ kind: String) {
        guard let from = selected else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        Sound.move.play()
        move = kind
        // only one possible target: no need to tap it
        let side = healing ? you : 1 - you
        let living = s.teams[side].indices.filter { s.teams[side][$0].hp > 0 }
        if living.count == 1 { send(from: from, move: kind, to: living[0]) }
    }

    private func send(from: Int, move mv: String, to: Int) {
        sending = true
        error = nil
        Task {
            // stays locked until the move has played out (playBack unlocks), so nothing can be tapped mid-attack
            do { try await onMove(from, mv, to) }
            catch { self.error = error.localizedDescription; move = nil; sending = false }
        }
    }

    // MARK: playback

    private func key(_ side: Int, _ i: Int) -> Int { side * 10 + i }

    private func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }

    // Passives that kicked in on a move: a cyan callout over each card, and the HP it gained or lost.
    private func playPassives(_ e: LogEntry, _ start: BattleState) async -> BattleState {
        var cur = start
        for pa in e.pas ?? [] where cur.teams.indices.contains(pa.p) && cur.teams[pa.p].indices.contains(pa.i) {
            let k = key(pa.p, pa.i)
            if pa.n == "Rebirth" { cur.teams[pa.p][pa.i].hp = pa.v } else { cur.teams[pa.p][pa.i].hp = max(0, cur.teams[pa.p][pa.i].hp + pa.v) }
            let amount = pa.n == "Rebirth" || pa.v == 0 ? "" : pa.v > 0 ? " +\(pa.v)" : " −\(-pa.v)"
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { fx[k, default: HitFX()].callout = "◆ \(pa.n.uppercased())\(amount)"; shown = cur }
            await pause(0.75)
            withAnimation(.easeOut(duration: 0.3)) { fx[k]?.callout = nil }
        }
        return cur
    }

    private func playBack() async {
        guard !playing else { return }      // the running playback picks up later states itself
        playing = true
        while let from = shown, let target = latest, from != target {
            let fresh = max(0, min((target.moves ?? target.log.count) - (from.moves ?? from.log.count), target.log.count))
            var cur = from
            selected = nil; move = nil
            for e in target.log.suffix(fresh) {
                if let amount = e.heal {   // a Mystic healing its own side: green glow and a +number, no lunge
                    guard cur.teams[e.p].indices.contains(e.to) else { continue }
                    let t = key(e.p, e.to)
                    if acting != e.p { withAnimation { acting = e.p }; await pause(0.35) }
                    UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                    Sound.heal.play()
                    cur.teams[e.p][e.to].hp += amount
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { fx[t, default: HitFX()].heal = true; fx[t]?.flash = true; fx[t]?.pop = amount }
                    withAnimation(.easeOut(duration: 0.45)) { shown = cur }
                    await pause(0.5)
                    withAnimation(.easeOut(duration: 0.3)) { fx[t]?.flash = false }
                    await pause(0.35)
                    withAnimation(.easeOut(duration: 0.5)) { fx[t]?.pop = nil }
                    await pause(max(0.45, Sound.heal.duration - 0.65 + 0.1))
                    fx[t]?.heal = false
                    cur = await playPassives(e, cur)
                    continue
                }
                guard cur.teams.indices.contains(1 - e.p), cur.teams[1 - e.p].indices.contains(e.to) else { continue }
                let a = key(e.p, e.from), t = key(1 - e.p, e.to)
                if acting != e.p { withAnimation { acting = e.p }; await pause(0.35) }
                withAnimation(.easeIn(duration: 0.16)) { fx[a, default: HitFX()].lunge = 1 }
                await pause(0.16)
                // impact
                UIImpactFeedbackGenerator(style: e.ko ? .heavy : .medium).impactOccurred()
                let sound = e.ko ? Sound.ko : e.move != "basic" ? Sound.crit : Sound.hit
                sound.play()
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
                // wait for the hit sound to finish before anything else plays
                await pause(max(0.45, sound.duration - 0.65 + 0.1))
                cur = await playPassives(e, cur)
            }
            withAnimation(.easeOut(duration: 0.25)) { shown = target; acting = nil }
            if target.turn == you && target.winner == nil { UIImpactFeedbackGenerator(style: .light).impactOccurred(); Sound.turn.play() }
        }
        playing = false
        sending = false
        if latest?.winner != nil { Music.stop() }
        onSettled()
    }
}
