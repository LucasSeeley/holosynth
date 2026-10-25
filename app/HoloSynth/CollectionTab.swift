import SwiftUI

// Every card in the set, in number order. Owned cards show their face; the rest show the card back.
// "Edit team" lets you pick the 3 cards you take into battle.
struct CollectionTab: View {
    @EnvironmentObject var store: GameStore
    @State private var editing = false
    @State private var picked: [String] = []
    @State private var zoomed: Card?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    teamSection
                    let owned = store.profile?.collection ?? [:]
                    Text("Collection · \(owned.count) of \(CardBook.all.count)").sectionTitle().padding(.top, 8)
                    LazyVGrid(columns: columns, spacing: 10) {
                        // owned cards first, each group still in number order
                        ForEach(CardBook.all.filter { owned[$0.id] != nil } + CardBook.all.filter { owned[$0.id] == nil }) { card in
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

    private var teamSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(editing ? "Pick 3 cards · \(picked.count)/3" : "Your team").sectionTitle()
                Spacer()
                if editing {
                    Button("Cancel") { editing = false }.buttonStyle(OutlineButton(color: Theme.muted))
                    Button("Save") {
                        Task { await store.setTeam(picked); editing = false }
                    }
                    .buttonStyle(OutlineButton())
                    .disabled(picked.count != 3)
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
                        Text("×\(count)").font(.caption2.bold().monospacedDigit())
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05)).offset(x: 4, y: -6)
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
                        else if picked.count < 3 { picked.append(card.id) }
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
