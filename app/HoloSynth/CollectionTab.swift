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
                    Text("Collection · \(owned.count) of \(CardBook.all.count)")
                        .font(.headline).foregroundColor(Theme.fg)
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(CardBook.all) { card in
                            cell(card, count: owned[card.id] ?? 0)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(item: $zoomed) { card in
            ZStack {
                Theme.bg.ignoresSafeArea()
                VStack(spacing: 16) {
                    CardView(card: card).padding(.horizontal, 40)
                    Text("#\(card.num) · \(card.look)").font(.footnote).foregroundColor(Theme.muted)
                        .multilineTextAlignment(.center).padding(.horizontal, 30)
                }
            }
        }
    }

    private var teamSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(editing ? "Pick 3 cards (\(picked.count)/3)" : "Your team").font(.headline).foregroundColor(Theme.fg)
                Spacer()
                if editing {
                    Button("Cancel") { editing = false }
                    Button("Save") {
                        Task { await store.setTeam(picked); editing = false }
                    }
                    .disabled(picked.count != 3)
                    .fontWeight(.bold)
                } else {
                    Button("Edit team") {
                        picked = store.profile?.team ?? []
                        editing = true
                    }
                }
            }
            HStack(spacing: 10) {
                let team = editing ? picked : (store.profile?.team ?? [])
                ForEach(0..<3, id: \.self) { i in
                    if i < team.count, let card = CardBook.card(team[i]) {
                        CardView(card: card)
                    } else {
                        RoundedRectangle(cornerRadius: 8).stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [4]))
                            .aspectRatio(5.0 / 7.0, contentMode: .fit)
                    }
                }
            }
            if let error = store.error { Text(error).font(.footnote).foregroundColor(Theme.pink) }
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
                            .background(Theme.gold, in: Capsule()).foregroundColor(.black).offset(x: 4, y: -6)
                    }
                }
                .overlay {
                    if editing, picked.contains(card.id) {
                        RoundedRectangle(cornerRadius: 8).stroke(Theme.cyan, lineWidth: 3)
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
                .overlay(Text("#\(card.num)").font(.caption.monospacedDigit()).foregroundColor(Theme.fg))
        }
    }
}
