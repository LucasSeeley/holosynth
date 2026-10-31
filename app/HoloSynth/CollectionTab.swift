import SwiftUI

// Every card in the set, two across so they're readable. Owned cards first (in the chosen sort), then card backs.
// Your team sits pinned on top: drag any card onto a slot to swap it in, or tap "+ Team" and then the slot.
// Team slots can be dragged onto each other to reorder. Every change saves straight away.
// Under the team: your 2 power card slots, filled the same way (drag a power card on, or tap "+ Power" then the slot).
struct CollectionTab: View {
    @EnvironmentObject var store: GameStore
    @State private var zoomed: Entry?
    @State private var pending: String?          // tapped "+ Team"; waiting for a slot
    @State private var pendingPower: String?     // tapped "+ Power"; waiting for a power slot
    @State private var showPowers = false        // the Power tab of the collection
    @State private var zoomedPower: Power?
    @AppStorage("collectionSort") private var sort = 0   // 0 Synth #, 1 HP, 2 Rarity; the button steps through them

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 14), count: 2)
    // A full team is 3; while the campaign is still handing out cards it is however many you own.
    private var teamSize: Int { min(3, store.profile?.collection.count ?? 0) }
    private var team: [String] { store.profile?.team ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar()
            teamBar.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    let owned = store.profile?.collection ?? [:]
                    HStack(spacing: 6) {
                        tabButton("Characters", on: !showPowers, tint: Theme.brass) { showPowers = false }
                        tabButton("Power · \(powersOwned.values.reduce(0, +))", on: showPowers, tint: Power.violet) { showPowers = true }
                        Spacer()
                    }
                    if showPowers {
                        LazyVGrid(columns: columns, spacing: 14) {
                            ForEach(Power.all.filter { (powersOwned[$0.id] ?? 0) > 0 }) { powerCell($0) }
                        }
                        if powersOwned.isEmpty {
                            Text("No power cards yet. They come in Power Packs in the Shop, and now and then in any pack.")
                                .font(.barlow(14)).foregroundColor(Theme.muted).frame(maxWidth: .infinity).padding(.top, 20)
                        }
                    } else {
                    HStack {
                        Text("Collection · \(owned.count) of \(CardBook.all.count)").sectionTitle()
                        Spacer()
                        Button { sort = (sort + 1) % CardSort.names.count } label: {
                            Label(CardSort.names[sort % CardSort.names.count], systemImage: "arrow.up.arrow.down")
                        }
                        .buttonStyle(OutlineButton())
                        .accessibilityLabel("Sort by \(CardSort.names[sort % CardSort.names.count]), tap to change")
                    }
                    LazyVGrid(columns: columns, spacing: 14) {
                        // owned cards first in the chosen order, then locked cards in number order
                        ForEach(entries(owned)) { e in
                            cell(e.card, count: copies(e, owned), holo: e.holo)
                        }
                    }
                    }
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 16)
            }
        }
        .background(ScreenBackground())
        .sheet(item: $zoomed) { e in FuseSheet(card: e.card, holo: e.holo) { zoomed = nil } }
        .sheet(item: $zoomedPower) { p in ZStack { ScreenBackground(); PowerCardView(power: p).padding(40) } }
    }

    // MARK: team bar (pinned)

    private var teamBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Your team").sectionTitle()
                Spacer()
                Text(note).font(.barlow(12)).foregroundColor(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { teamSlot($0) }
            }
            HStack(alignment: .firstTextBaseline) {
                Text("Power cards").font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Power.violet)
                Spacer()
                Text(pendingPower.flatMap { Power.of($0) }.map { "Tap where \($0.name) goes" } ?? "2 per battle · used up when played")
                    .font(.barlow(11)).foregroundColor(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
            HStack(spacing: 8) {
                ForEach(0..<2, id: \.self) { powerSlot($0) }
            }
            if let error = store.error { Text(error).font(.barlow(13, semibold: true)).foregroundColor(Theme.pink) }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(LinearGradient(colors: [Theme.brass.opacity(0.10), Theme.field], startPoint: .top, endPoint: .bottom),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.4), lineWidth: 1))
    }

    private var note: String {
        if let p = pending, let c = CardBook.card(p) { return "Tap who \(c.name) replaces" }
        return "Drag a card here, or tap + Team"
    }

    @ViewBuilder private func teamSlot(_ i: Int) -> some View {
        let picking = pending != nil && i < teamSize
        Group {
            if i < team.count, let card = CardBook.card(team[i]) {
                VStack(spacing: 4) {
                    Group { if let img = Art.image(card.id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel } }
                        .frame(width: 70, height: 54).clipShape(RoundedRectangle(cornerRadius: 9))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.rarityColor(card.rarity), lineWidth: 1))
                    Text(card.name).font(.chakra(13)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                }
                .draggable(card.id) { Avatar(id: card.id, size: 60) }   // drag one slot onto another to reorder
            } else {
                VStack(spacing: 4) {
                    Image(systemName: i < teamSize ? "plus" : "lock.fill").font(.system(size: 18, weight: .medium))
                        .foregroundColor(Theme.brass.opacity(0.7)).frame(width: 70, height: 54)
                    Text(i < teamSize ? "Empty" : "Level \(i == 1 ? 3 : 6)").font(.barlow(12)).foregroundColor(Theme.muted)
                }
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(picking ? Color(hex: 0xFFD77A) : Theme.brass.opacity(0.35), style: StrokeStyle(lineWidth: picking ? 1.5 : 1, dash: picking ? [5] : [])))
        .shadow(color: picking ? Theme.brass.opacity(0.45) : .clear, radius: 8)
        .overlay(alignment: .topLeading) { Text("\(i + 1)").font(.chakra(10, semibold: true)).foregroundColor(Theme.muted).padding(6) }
        .contentShape(Rectangle())
        .onTapGesture {   // placing a card, or else open the one in the slot
            if let p = pending { put(p, at: i) }
            else if i < team.count, let card = CardBook.card(team[i]) { zoomed = Entry(card: card, holo: store.profile?.battleUsesHolo(card.id) ?? false) }
        }
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first else { return false }
            put(id, at: i)
            return true
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(pending != nil ? "Puts the chosen card here" : "Drop a card here to add it to your team")
    }

    // MARK: power cards

    private var powersOwned: [String: Int] { store.profile?.powers ?? [:] }
    private var powerTeam: [String] { store.profile?.powerTeam ?? [] }

    private func tabButton(_ title: String, on: Bool, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.chakra(12)).foregroundColor(on ? Theme.fg : tint)
                .padding(.horizontal, 14).frame(height: 32)
                .background(tint.opacity(on ? 0.28 : 0.1), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(tint.opacity(on ? 1 : 0.5), lineWidth: 1))
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func powerSlot(_ i: Int) -> some View {
        let picking = pendingPower != nil
        Group {
            if i < powerTeam.count, let p = Power.of(powerTeam[i]) {
                HStack(spacing: 8) {
                    Image(systemName: p.symbol).font(.system(size: 20)).foregroundColor(Theme.cyan).shadow(color: Theme.cyan, radius: 3)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).font(.chakra(13)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                        Text(p.rarity).font(.barlow(10)).foregroundColor(Theme.rarityColor(p.rarity))
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .draggable("pw:" + p.id) { Image(systemName: p.symbol).font(.system(size: 30)).foregroundColor(Theme.cyan) }
            } else {
                Text("+ Power").font(.barlow(12)).foregroundColor(Theme.muted).frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity).frame(height: 50)
        .background(LinearGradient(colors: [Power.violet.opacity(0.22), Theme.panel.opacity(0.9)], startPoint: .leading, endPoint: .trailing),
                    in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12)
            .stroke(picking ? Power.violet : (i < powerTeam.count ? Theme.rarityColor(Power.of(powerTeam[i])?.rarity ?? "") : Power.violet.opacity(0.5)),
                    style: StrokeStyle(lineWidth: picking ? 1.5 : 1, dash: picking || i >= powerTeam.count ? [5] : [])))
        .shadow(color: picking ? Power.violet.opacity(0.5) : .clear, radius: 8)
        .contentShape(Rectangle())
        .onTapGesture { if let p = pendingPower { putPower(p, at: i) } }
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first, id.hasPrefix("pw:") else { return false }
            putPower(String(id.dropFirst(3)), at: i)
            return true
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Drop a power card here to take it into battle")
    }

    // Puts power card `id` in power slot `i`; with only one copy, moving it between slots swaps them.
    private func putPower(_ id: String, at i: Int) {
        pendingPower = nil
        guard (powersOwned[id] ?? 0) > 0 else { return }
        var next = powerTeam
        if let from = next.firstIndex(of: id), (powersOwned[id] ?? 0) < 2 || from == i {
            guard i < next.count, from != i else { return }
            next.swapAt(from, i)
        } else if i < next.count {
            next[i] = id
        } else {
            next.append(id)
        }
        Task { await store.setPowerTeam(next) }
    }

    private func powerCell(_ p: Power) -> some View {
        let count = powersOwned[p.id] ?? 0
        return PowerCardView(power: p)
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("×\(count)").font(.chakra(9)).monospacedDigit()
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Power.violet, in: Capsule()).foregroundColor(.white)
                        .offset(x: 3, y: -3)
                        .accessibilityLabel("\(count) copies")
                }
            }
            .overlay(alignment: .topLeading) {
                Button { pendingPower = pendingPower == p.id ? nil : p.id } label: {
                    Text("+ Power").font(.chakra(11)).tracking(1.2).textCase(.uppercase)
                        .foregroundColor(pendingPower == p.id ? .white : Power.violet)
                        .padding(.leading, 7).padding(.trailing, 10).frame(height: 28)
                        .background(pendingPower == p.id ? AnyShapeStyle(Power.violet) : AnyShapeStyle(Theme.ink.opacity(0.88)), in: UnevenRounded())
                        .overlay(UnevenRounded().stroke(Power.violet.opacity(0.7), lineWidth: 1))
                }
                .padding(.top, 28).offset(x: -1)
                .accessibilityLabel("Take \(p.name) into battle")
            }
            .overlay { if pendingPower == p.id { RoundedRectangle(cornerRadius: 10).stroke(Power.violet, lineWidth: 3).shadow(color: Power.violet, radius: 8) } }
            .onTapGesture { if pendingPower != nil { pendingPower = nil } else { zoomedPower = p } }
            .draggable("pw:" + p.id) { PowerCardView(power: p).frame(width: 110) }
    }

    // Puts `id` in slot `i`: a card already on the team swaps places, a new one replaces whoever is there.
    private func put(_ id: String, at i: Int) {
        pending = nil
        guard i < teamSize, store.profile?.collection[id] != nil else { return }
        var next = team
        if let from = next.firstIndex(of: id) {
            guard i < next.count, from != i else { return }
            next.swapAt(from, i)
        } else if i < next.count {
            next[i] = id
        } else {
            next.append(id)
        }
        Task { await store.setTeam(next) }
    }

    // MARK: collection

    // One cell per card you own (holo copies get a cell of their own next to the normal one), then locked cards.
    struct Entry: Identifiable { let card: Card; let holo: Bool; var id: String { card.id + (holo ? "#holo" : "") } }

    private func entries(_ owned: [String: Int]) -> [Entry] {
        let holoCount = { (id: String) in store.profile?.holoCount(id) ?? 0 }
        let mine = CardSort.apply(CardBook.all.filter { owned[$0.id] != nil }, sort, counts: owned,
                                  holos: Set(owned.keys.filter { holoCount($0) > 0 }),
                                  hp: { c in max(c.maxHP(store.profile?.fusion(c.id)), holoCount(c.id) > 0 ? c.maxHP(store.profile?.holo(c.id)) : 0) })   // fused / holo HP counts
        let holoFirst = CardSort.names[sort % CardSort.names.count] == "Holo"
        var out: [Entry] = []
        for c in mine {
            let normal = (owned[c.id] ?? 0) > holoCount(c.id), holo = holoCount(c.id) > 0
            if holo && holoFirst { out.append(Entry(card: c, holo: true)) }
            if normal { out.append(Entry(card: c, holo: false)) }
            if holo && !holoFirst { out.append(Entry(card: c, holo: true)) }
        }
        return out + CardBook.all.filter { owned[$0.id] == nil }.map { Entry(card: $0, holo: false) }
    }

    // Copies a cell stands for: holo copies on the holo cell, the rest on the normal one.
    private func copies(_ e: Entry, _ owned: [String: Int]) -> Int {
        let holo = store.profile?.holoCount(e.card.id) ?? 0
        return e.holo ? holo : (owned[e.card.id] ?? 0) - holo
    }

    @ViewBuilder
    private func cell(_ card: Card, count: Int, holo: Bool) -> some View {
        if count > 0 {
            let onTeam = team.contains(card.id) && holo == (store.profile?.battleUsesHolo(card.id) ?? false)
            CardView(card: card, fusion: holo ? store.profile?.holo(card.id) : store.profile?.fusion(card.id))
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text("×\(count)").font(.chakra(9)).monospacedDigit()
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05))
                            .offset(x: 3, y: -3)
                            .accessibilityLabel("\(count) copies")
                    }
                }
                .overlay(alignment: .top) {
                    if store.newCards.contains(card.id) {
                        Text("New").font(.chakra(8)).tracking(1.3).textCase(.uppercase).foregroundColor(.white)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Theme.pink, in: RoundedRectangle(cornerRadius: 6))
                            .shadow(color: Theme.pink.opacity(0.7), radius: 5)
                            .offset(y: -6)
                    }
                }
                .overlay(alignment: .topLeading) {
                    Group {
                        if onTeam {
                            Text("On team").font(.chakra(10)).tracking(1.2).textCase(.uppercase).foregroundColor(Color(hex: 0x1A0D05))
                                .padding(.leading, 7).padding(.trailing, 9).frame(height: 24)
                                .background(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom),
                                            in: UnevenRounded())
                        } else {
                            Button { pending = pending == card.id ? nil : card.id } label: {
                                Text("+ Team").font(.chakra(11)).tracking(1.2).textCase(.uppercase)
                                    .foregroundColor(pending == card.id ? Color(hex: 0x1A0D05) : Theme.brass)
                                    .padding(.leading, 7).padding(.trailing, 10).frame(height: 28)
                                    .background(pending == card.id ? AnyShapeStyle(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom))
                                                                   : AnyShapeStyle(Theme.ink.opacity(0.88)), in: UnevenRounded())
                                    .overlay(UnevenRounded().stroke(Theme.brass.opacity(0.7), lineWidth: 1))
                            }
                            .accessibilityLabel("Add \(card.name) to your team")
                        }
                    }
                    .padding(.top, 28).offset(x: -1)
                }
                .overlay {
                    if pending == card.id {
                        RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0xFFD77A), lineWidth: 3).shadow(color: Theme.brass, radius: 8)
                    }
                }
                .onTapGesture { if pending != nil { pending = nil } else { zoomed = Entry(card: card, holo: holo); store.seen(card.id) } }
                .draggable(card.id) { CardView(card: card).frame(width: 110) }
        } else {
            CardBack().opacity(0.35)
                .overlay(Text("#\(card.num)").font(.chakra(15, semibold: true)).foregroundColor(Theme.fg))
        }
    }
}

// A tag stuck to the card's left edge: square on the left, rounded on the right.
private struct UnevenRounded: Shape {
    func path(in r: CGRect) -> Path {
        let rad = min(8, r.height / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - rad, y: r.minY))
        p.addArc(center: CGPoint(x: r.maxX - rad, y: r.minY + rad), radius: rad, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - rad))
        p.addArc(center: CGPoint(x: r.maxX - rad, y: r.maxY - rad), radius: rad, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}
