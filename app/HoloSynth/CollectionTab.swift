import SwiftUI

// Every card in the set, in number order. Owned cards show their face; the rest show the card back.
// "Edit team" lets you pick the 3 cards you take into battle.
struct CollectionTab: View {
    @EnvironmentObject var store: GameStore
    @State private var editing = false
    @State private var picked: [String] = []
    @State private var zoomed: Card?
    @AppStorage("collectionSort") private var sort = 0   // 0 Synth #, 1 HP, 2 Rarity; the button steps through them


    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
    // A full team is 3; while the campaign is still handing out cards it is however many you own.
    private var teamSize: Int { min(3, store.profile?.collection.count ?? 0) }

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    teamSection
                    let owned = store.profile?.collection ?? [:]
                    HStack {
                        Text("Collection · \(owned.count) of \(CardBook.all.count)").sectionTitle()
                        Spacer()
                        Button { sort = (sort + 1) % 3 } label: {
                            Label(CardSort.names[sort % 3], systemImage: "arrow.up.arrow.down")
                        }
                        .buttonStyle(OutlineButton())
                        .accessibilityLabel("Sort by \(CardSort.names[sort % 3]), tap to change")
                    }
                    .padding(.top, 8)
                    LazyVGrid(columns: columns, spacing: 10) {
                        // owned cards first in the chosen order, then locked cards in number order
                        ForEach(sorted(CardBook.all.filter { owned[$0.id] != nil }) + CardBook.all.filter { owned[$0.id] == nil }) { card in
                            cell(card, count: owned[card.id] ?? 0)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(ScreenBackground())
        .sheet(item: $zoomed) { card in
            ZStack {
                ScreenBackground()
                CardView(card: card).padding(.horizontal, 40)
            }
        }
    }

    private func sorted(_ cards: [Card]) -> [Card] { CardSort.apply(cards, sort) }

    private var teamSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(editing ? "Pick \(teamSize) · \(picked.count)/\(teamSize)" : "Your team").sectionTitle()
                Spacer()
                if editing {
                    Button("Cancel") { editing = false }.buttonStyle(OutlineButton(color: Theme.muted))
                    Button("Save") {
                        Task { await store.setTeam(picked); editing = false }
                    }
                    .buttonStyle(OutlineButton())
                    .disabled(picked.count != teamSize)
                } else {
                    Button("Edit team") {
                        picked = store.profile?.team ?? []
                        editing = true
                    }
                    .buttonStyle(OutlineButton())
                }
            }
            HStack(spacing: 10) {
                let team = editing ? picked : (store.profile?.team ?? [])
                ForEach(0..<3, id: \.self) { i in
                    if i < team.count, let card = CardBook.card(team[i]) {
                        CardView(card: card)
                    } else {
                        RoundedRectangle(cornerRadius: 8).stroke(Theme.brass.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4]))
                            .aspectRatio(5.0 / 7.0, contentMode: .fit)
                    }
                }
            }
            if let error = store.error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
        }
    }

    @ViewBuilder
    private func cell(_ card: Card, count: Int) -> some View {
        if count > 0 {
            CardView(card: card)
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text("×\(count)").font(.chakra(9)).monospacedDigit()
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05))
                            .scaleEffect(0.5, anchor: .topTrailing).offset(x: 2, y: -2)
                            .accessibilityLabel("\(count) copies")
                    }
                }
                .overlay {
                    if editing, picked.contains(card.id) {
                        RoundedRectangle(cornerRadius: 8).stroke(Theme.brass, lineWidth: 3).shadow(color: Theme.brass, radius: 8)
                    }
                }
                .onTapGesture {
                    if editing {
                        if let i = picked.firstIndex(of: card.id) { picked.remove(at: i) }
                        else if picked.count < teamSize { picked.append(card.id) }
                    } else {
                        zoomed = card
                    }
                }
        } else {
            CardBack().opacity(0.35)
                .overlay(Text("#\(card.num)").font(.chakra(13, semibold: true)).foregroundColor(Theme.fg))
        }
    }
}
