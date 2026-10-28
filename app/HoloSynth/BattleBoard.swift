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
    @State var preHit: (from: Int, to: Int, move: String)?   // your attack, already winding up while the server answers
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
        var callout: String?         // a passive kicking in: "◆ LIFESTEAL +13", or a power card played
        var calloutPower = false     // violet (power card) rather than cyan (passive)
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
            Spacer(minLength: 22)
            turnBadge
            Spacer(minLength: 22)
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
        let isTarget = targetable(unit, mine: mine, ko: ko, index: i)
        let w = cardWidth
        let artH = (w / 1.3).rounded()
        let pct = CGFloat(unit.hp) / CGFloat(unit.max ?? card.hp)
        let look = ring(f, isTarget: isTarget, isSelected: isSelected, ready: ready)
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
                if let c = f.callout { callout(c, power: f.calloutPower, size: small) }
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
                    statusIcons(unit, size: small)
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
    // Split out of token() so the compiler can type-check it in time.
    private func ring(_ f: HitFX, isTarget: Bool, isSelected: Bool, ready: Bool) -> (ring: Color, glow: Color, width: CGFloat, radius: CGFloat) {
        if powerMove != nil && isTarget { return (Power.violet, Power.violet.opacity(pulse ? 0.8 : 0.4), 2, 16) }
        if (healing && isTarget) || (f.flash && f.heal) { return outline(green: true) }
        return outline(red: f.flash || isTarget, gold: (isSelected && !isTarget) || f.lunge != 0, ready: ready)
    }

    // A passive (cyan) or power card (violet) callout over a card.
    private func callout(_ text: String, power: Bool, size: CGFloat) -> some View {
        let tint = power ? Power.violet : Theme.cyan
        return VStack {
            Spacer()
            Text(text).font(.chakra(size)).tracking(1).foregroundColor(tint).lineLimit(1).minimumScaleFactor(0.6)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Theme.ink.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint, lineWidth: 1))
                .shadow(color: tint.opacity(0.6), radius: 6)
        }
        .padding(.bottom, 8).padding(.horizontal, 4)
        .transition(.scale(scale: 0.5).combined(with: .opacity))
    }

    // Power cards waiting on this card: Deflector, Ricochet, Overclock, Rally.
    private func statusIcons(_ unit: Unit, size: CGFloat) -> some View {
        var syms: [String] = []
        if unit.sh == true { syms.append("shield.fill") }
        if unit.mi == true { syms.append("arrow.left.arrow.right") }
        if unit.oc == true { syms.append("bolt.fill") }
        if unit.od == true { syms.append("flame.fill") }
        return HStack(spacing: 3) {
            ForEach(syms, id: \.self) { sym in
                Image(systemName: sym).font(.system(size: size - 1, weight: .bold)).foregroundColor(Power.violet)
                    .padding(3).background(Theme.ink.opacity(0.85), in: Circle())
            }
            Spacer()
        }
    }

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
        let powers = s.pw?[you] ?? []
        return VStack(spacing: 10) {
            Text(error ?? prompt(card)).font(.barlow(15, semibold: true))
                .foregroundColor(error != nil ? Theme.pink : (myTurn || playing ? Theme.fg : Color(hex: 0xFF7884)))
                .multilineTextAlignment(.center).lineLimit(2).frame(minHeight: 20)
            if !powers.isEmpty {   // your power hand, fanned in the bottom-right corner above the moves
                HStack { Spacer(); powerHand(powers, enabled: card != nil && myTurn && !sending) }.frame(height: 104, alignment: .bottom)
            }
            HStack(spacing: 10) {
                moveButton("basic", card: card, unit: unit)
                moveButton("special", card: card, unit: unit)
                if unit?.cd2 != nil { moveButton("special2", card: card, unit: unit) }   // fused Epic/Legendary
            }
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 26)   // a little up from the bottom edge
        .frame(maxWidth: .infinity)
        .background(Theme.ink.opacity(0.92).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.brass.opacity(0.25)).frame(height: 1) }
    }

    // Your power cards as a little fanned hand above the move buttons, bottom right. Tap one to play it with the selected card.
    private func powerHand(_ powers: [String], enabled: Bool) -> some View {
        ZStack(alignment: .bottomTrailing) {
            ForEach(Array(powers.prefix(2).enumerated()), id: \.offset) { k, id in
                if let p = Power.of(id) {
                    let picked = powerMove?.id == p.id
                    Button { if enabled { choosePower(p) } else { error = myTurn ? "Pick one of your cards first" : nil } } label: { miniPower(p, glow: picked || enabled) }
                        .buttonStyle(.plain)
                        .rotationEffect(.degrees(powers.count > 1 ? (k == 0 ? -9 : 7) : 0), anchor: .bottom)
                        .offset(x: powers.count > 1 && k == 0 ? -52 : 0, y: picked ? -16 : 0)
                        .zIndex(picked ? 2 : Double(k))
                        .accessibilityLabel("Power card: \(p.name). \(p.effect)")
                }
            }
        }
        .frame(width: powers.count > 1 ? 124 : 72, height: 100, alignment: .bottomTrailing)
        .opacity(enabled || powerMove != nil ? 1 : 0.55)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: powerMove?.id)
    }

    private func miniPower(_ p: Power, glow: Bool) -> some View {
        VStack(spacing: 3) {
            Text("Power").font(.chakra(7, semibold: true)).tracking(1).textCase(.uppercase).foregroundColor(Power.violet)
            ZStack {
                RadialGradient(colors: [Theme.rarityColor(p.rarity).opacity(0.35), Color(hex: 0x120A24)], center: .center, startRadius: 0, endRadius: 30)
                if let img = Art.image("power_" + p.id) { Image(uiImage: img).resizable().scaledToFill() }
                else { Image(systemName: p.symbol).font(.system(size: 18)).foregroundColor(Theme.cyan) }
            }
            .frame(width: 60, height: 52).clipShape(RoundedRectangle(cornerRadius: 6))
            Text(p.name).font(.chakra(10)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(5)
        .frame(width: 70, height: 98)
        .background(LinearGradient(colors: [Color(hex: 0x2A1450), Color(hex: 0x0B0918)], startPoint: .top, endPoint: .bottom), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.rarityColor(p.rarity), lineWidth: 1))
        .shadow(color: glow ? Power.violet.opacity(0.7) : .black.opacity(0.6), radius: glow ? 10 : 6, y: glow ? 0 : 4)
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
        if playing || preHit != nil { return acting == you ? "Hit!" : "\(foeName) attacks…" }
        if s.winner != nil { return "" }
        if s.turn != you { return "Waiting for \(foeName)…" }
        if let p = powerMove {
            return p.target == "ko" ? "Tap a knocked-out card to revive it" : p.target == "acted" ? "Tap a card that already went to let it act again"
                : "Tap one of your cards for \(p.name)"
        }
        if let card, let mv = move {
            if healing { return "Tap one of your cards to heal it with \(card.special.name)" }
            return "Tap an enemy to hit it with \(mv == "special" ? card.special.name : mv == "special2" ? (card.special2?.name ?? "") : card.basic.name)"
        }
        if let card { return (s.pw?[you] ?? []).isEmpty ? "\(card.name) is up. Choose a move." : "\(card.name) is up. Choose a move or a power card." }
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
    private func targetable(_ unit: Unit, mine: Bool, ko: Bool, index i: Int) -> Bool {
        guard myTurn, selected != nil, move != nil else { return false }
        if let p = powerMove { return mine && powerCanTarget(p, unit: unit, index: i) }
        return !ko && (healing ? mine : !mine)
    }

    // The power card picked and waiting for a target, if any.
    private var powerMove: Power? { move.flatMap { $0.hasPrefix("pw:") ? Power.of($0) : nil } }
    private func powerCanTarget(_ p: Power, unit: Unit, index i: Int) -> Bool {
        switch p.target {
        case "ko": return unit.hp == 0
        case "acted": return unit.hp > 0 && i != selected && s.acted[you][i]
        default: return unit.hp > 0
        }
    }

    private var healing: Bool {
        guard move == "special", let sel = selected, s.teams[you].indices.contains(sel),
              let c = CardBook.card(s.teams[you][sel].id) else { return false }
        return c.special.heals
    }

    // Same sum as the server's hitFor: passives, then +20% when the attacker's class beats the target's, then the target's guard.
    private func previewDamage(to target: Unit) -> Int? {
        guard powerMove == nil, let sel = selected, let mv = move, let a = CardBook.card(s.teams[you][sel].id), let t = CardBook.card(target.id) else { return nil }
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
        guard myTurn, !sending else { return }
        if side == you, let p = powerMove, let from = selected {
            if powerCanTarget(p, unit: unit, index: i) { send(from: from, move: "pw:" + p.id, to: i) }
            return
        }
        guard unit.hp > 0 else { return }
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

    // Picked a power card from the tray: no target needed plays it straight away.
    private func choosePower(_ p: Power) {
        guard let from = selected else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        Sound.move.play()
        if p.target == "none" { send(from: from, move: "pw:" + p.id, to: 0); return }
        move = "pw:" + p.id
        let ok = s.teams[you].indices.filter { powerCanTarget(p, unit: s.teams[you][$0], index: $0) }
        if ok.count == 1 { send(from: from, move: move!, to: ok[0]) }
    }

    private func choose(_ kind: String) {
        guard let from = selected else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        Sound.move.play()
        move = kind   // then tap the target, even when there's only one
    }

    private func send(from: Int, move mv: String, to: Int) {
        // an attack on the enemy winds up right away (the lunge); the hit, dodge or block lands once the server answers
        if (mv == "basic" || mv == "special") && !healing && !playing {
            preHit = (from, to, mv)
            selected = nil; move = nil
            withAnimation { acting = you }
            withAnimation(.easeIn(duration: 0.16)) { fx[key(you, from), default: HitFX()].lunge = 1 }
        }
        sending = true
        error = nil
        Task {
            // stays locked until the move has played out (playBack unlocks), so nothing can be tapped mid-attack
            do { try await onMove(from, mv, to) }
            catch {
                self.error = error.localizedDescription; move = nil; sending = false
                if let pre = preHit { preHit = nil; withAnimation { fx[key(you, pre.from)]?.lunge = 0; acting = nil } }
            }
        }
    }

    // MARK: playback

    private func key(_ side: Int, _ i: Int) -> Int { side * 10 + i }

    private func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }

    // Passives that kicked in on a move: a cyan callout over each card, and the HP it gained or lost.
    // Callouts with no HP change on this hit's cards (the attacker's boost: Executioner, First Strike...; the target's
    // block: Deflector, Armor, Phase Shift) land with the impact, by hit(); the rest play after it.
    private func atImpact(_ pa: PassiveHit, _ e: LogEntry) -> Bool { pa.v == 0 && ((pa.p == 1 - e.p && pa.i == e.to) || (pa.p == e.p && pa.i == e.from)) }
    private func guards(_ e: LogEntry) -> [String] { (e.pas ?? []).filter { atImpact($0, e) && $0.p == 1 - e.p }.map(\.n) }
    private func boosts(_ e: LogEntry) -> [String] { (e.pas ?? []).filter { atImpact($0, e) && $0.p == e.p }.map(\.n) }

    private func playPassives(_ e: LogEntry, _ start: BattleState, skipGuards: Bool = false) async -> BattleState {
        var cur = start
        for pa in e.pas ?? [] where cur.teams.indices.contains(pa.p) && cur.teams[pa.p].indices.contains(pa.i)
            && !(skipGuards && atImpact(pa, e)) {
            let k = key(pa.p, pa.i)
            if pa.n == "Rebirth" { cur.teams[pa.p][pa.i].hp = pa.v } else { cur.teams[pa.p][pa.i].hp = max(0, cur.teams[pa.p][pa.i].hp + pa.v) }
            let amount = pa.n == "Rebirth" || pa.v == 0 ? "" : pa.v > 0 ? " +\(pa.v)" : " −\(-pa.v)"
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { fx[k, default: HitFX()].callout = "◆ \(pa.n.uppercased())\(amount)"; shown = cur }
            await pause(0.75)
            withAnimation(.easeOut(duration: 0.3)) { fx[k]?.callout = nil }
        }
        return cur
    }

    private func showDodge(_ t: Int) async {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { fx[t, default: HitFX()].callout = "◆ DODGE" }
        await pause(0.8)
        withAnimation(.easeOut(duration: 0.3)) { fx[t]?.callout = nil }
        await pause(0.2)
    }

    // One attack: the attacker lunges, the target shakes and flashes, the number pops and the HP bar drains.
    // `lunged`: your own attack, already wound up while the server answered. `guards`: blocks shown on the impact.
    private func hit(_ start: BattleState, p: Int, from: Int, to: Int, dmg: Int, ko: Bool, special: Bool, dodge: Bool = false,
                     guards: [String] = [], boosts: [String] = [], lunged: Bool = false) async -> BattleState {
        var cur = start
        let a = key(p, from), t = key(1 - p, to)
        if !lunged {
            if acting != p { withAnimation { acting = p }; await pause(0.35) }
            withAnimation(.easeIn(duration: 0.16)) { fx[a, default: HitFX()].lunge = 1 }
            await pause(0.16)
        }
        if dodge {   // the target slips aside: no damage
            withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { fx[a]?.lunge = 0 }
            Sound.dodge.play()
            withAnimation(.linear(duration: 0.45)) { fx[t, default: HitFX()].shakes += 1 }
            await showDodge(t)
            return cur
        }
        // impact (a block's callout lands with it)
        let blocked = guards.contains("Deflector")
        UIImpactFeedbackGenerator(style: ko ? .heavy : blocked ? .rigid : .medium).impactOccurred()
        let sound = ko ? Sound.ko : blocked ? Sound.deflect : special ? Sound.crit : Sound.hit
        sound.play()
        fx[t, default: HitFX()].ghostHP = cur.teams[1 - p][to].hp
        cur.teams[1 - p][to].hp = max(0, cur.teams[1 - p][to].hp - dmg)
        withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { fx[a]?.lunge = 0 }
        withAnimation(.linear(duration: 0.45)) { fx[t]?.shakes += 1 }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
            if let g = guards.first { fx[t]?.callout = "◆ " + g.uppercased() }
            if let b = boosts.first { fx[a]?.callout = "◆ " + b.uppercased() }
            fx[t]?.flash = true; fx[t]?.pop = dmg
        }
        withAnimation(.easeOut(duration: 0.45)) { shown = cur }
        await pause(0.3)
        withAnimation(.easeOut(duration: 0.3)) { fx[t]?.flash = false }
        let called = !guards.isEmpty || !boosts.isEmpty
        await pause(called ? 0.55 : 0.35)
        withAnimation(.easeOut(duration: 0.5)) { fx[t]?.ghostHP = nil; fx[t]?.pop = nil; if called { fx[t]?.callout = nil; fx[a]?.callout = nil } }
        // wait for the hit sound to finish before anything else plays
        await pause(max(0.45, sound.duration - 0.65 + 0.1))
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
                if let id = e.pw, let p = Power.of(id) {   // a power card: a violet callout on each card it touched
                    if acting != e.p { withAnimation { acting = e.p }; await pause(0.35) }
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Sound.rare.play()
                    let spots = (e.fx ?? []).filter { cur.teams.indices.contains($0.p) && cur.teams[$0.p].indices.contains($0.i) }
                    let keys = spots.isEmpty ? [key(e.p, e.from)] : spots.map { key($0.p, $0.i) }
                    for x in spots { cur.teams[x.p][x.i].hp = x.hp }
                    if var pw = cur.pw, pw.indices.contains(e.p), let k = pw[e.p].firstIndex(of: id) { pw[e.p].remove(at: k); cur.pw = pw }
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                        for k in keys { fx[k, default: HitFX()].callout = "◆ " + p.name.uppercased(); fx[k]?.calloutPower = true }
                        shown = cur
                    }
                    await pause(0.9)
                    withAnimation(.easeOut(duration: 0.3)) { for k in keys { fx[k]?.callout = nil; fx[k]?.calloutPower = false } }
                    await pause(0.25)
                    continue
                }
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
                var wound = false
                if let pre = preHit, e.p == you, pre.from == e.from, pre.to == e.to, pre.move == e.move { wound = true; preHit = nil }
                cur = await hit(cur, p: e.p, from: e.from, to: e.to, dmg: e.dmg, ko: e.ko, special: e.move != "basic", dodge: e.dodge == true,
                                guards: guards(e), boosts: boosts(e), lunged: wound)
                cur = await playPassives(e, cur, skipGuards: e.dodge != true)
            }
            if let pre = preHit { preHit = nil; withAnimation { fx[key(you, pre.from)]?.lunge = 0 } }   // a wind-up the answer didn't match
            withAnimation(.easeOut(duration: 0.25)) { shown = target; acting = nil }
            if target.turn == you && target.winner == nil { UIImpactFeedbackGenerator(style: .light).impactOccurred(); Sound.turn.play() }
        }
        playing = false
        sending = false
        if latest?.winner != nil { Music.stop() }
        onSettled()
    }
}
