import SwiftUI

// Every card in the set, two across so they're readable. Owned cards first (in the chosen sort), then card backs.
// Your team sits pinned on top: drag any card onto a slot to swap it in, or tap "+ Team" and then the slot.
// Team slots can be dragged onto each other to reorder. Every change saves straight away.
struct CollectionTab: View {
    @EnvironmentObject var store: GameStore
    @State private var zoomed: Card?
    @State private var pending: String?          // tapped "+ Team"; waiting for a slot
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
                        ForEach(CardSort.apply(CardBook.all.filter { owned[$0.id] != nil }, sort, counts: owned) + CardBook.all.filter { owned[$0.id] == nil }) { card in
                            cell(card, count: owned[card.id] ?? 0)
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 16)
            }
        }
        .background(ScreenBackground())
        .sheet(item: $zoomed) { card in FuseSheet(card: card) { zoomed = nil } }
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
        .onTapGesture { if let p = pending { put(p, at: i) } }
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first else { return false }
            put(id, at: i)
            return true
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(pending != nil ? "Puts the chosen card here" : "Drop a card here to add it to your team")
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

    @ViewBuilder
    private func cell(_ card: Card, count: Int) -> some View {
        if count > 0 {
            let onTeam = team.contains(card.id)
            CardView(card: card, fusion: store.profile?.fusion(card.id))
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text("×\(count)").font(.chakra(9)).monospacedDigit()
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05))
                            .offset(x: 3, y: -3)
                            .accessibilityLabel("\(count) copies")
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
                .onTapGesture { if pending != nil { pending = nil } else { zoomed = card } }
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
