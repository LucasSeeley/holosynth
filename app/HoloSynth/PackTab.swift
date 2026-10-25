import SwiftUI
import UIKit

// Buy a pack, swipe across it to tear it open, then tap each card to flip it.
// Rarity tells on the flip: Rare blue flash, Epic purple + shake, Legendary gold burst.
struct PackTab: View {
    @EnvironmentObject var store: GameStore
    @State private var pulled: [String] = []     // cards in the pack being opened
    @State private var torn = false
    @State private var flipped: Set<Int> = []
    @State private var buying = false
    @State private var tearProgress: CGFloat = 0
    @State private var burst: Color?

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar()
            ZStack {
                Theme.bg.ignoresSafeArea()
                if pulled.isEmpty { shop }
                else if !torn { sealedPack }
                else { reveal }
                if let burst {
                    burst.opacity(0.45).ignoresSafeArea().allowsHitTesting(false).transition(.opacity)
                }
            }
        }
        .onAppear {
            guard let starter = store.starterPack else { return }
            store.starterPack = nil
            flipped = []; torn = false; tearProgress = 0
            pulled = starter
        }
    }

    private var shop: some View {
        VStack(spacing: 20) {
            Spacer()
            packImage.frame(maxHeight: 360)
            Text("Card pack · 3 cards").font(.headline).foregroundColor(Theme.fg)
            Button {
                buying = true
                Task {
                    if let cards = await store.buyPack() {
                        flipped = []; torn = false; tearProgress = 0
                        pulled = cards
                    }
                    buying = false
                }
            } label: {
                Label(buying ? "Opening…" : "Buy for 250 gold", systemImage: "circle.hexagongrid.fill")
                    .font(.headline).padding(.horizontal, 28).padding(.vertical, 14)
                    .background(Theme.gold, in: Capsule()).foregroundColor(.black)
            }
            .disabled(buying || (store.profile?.gold ?? 0) < 250)
            if (store.profile?.gold ?? 0) < 250 {
                Text("Win battles to earn 50 gold each.").font(.footnote).foregroundColor(Theme.muted)
            }
            if let error = store.error { Text(error).font(.footnote).foregroundColor(Theme.pink) }
            Spacer()
        }
        .padding(24)
    }

    private var packImage: some View {
        Group {
            if let img = Art.image("pack") { Image(uiImage: img).resizable().scaledToFit() }
            else { RoundedRectangle(cornerRadius: 12).fill(Theme.backRed) }
        }
        .shadow(color: Theme.backRed.opacity(0.7), radius: 24)
    }

    private var sealedPack: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack(alignment: .top) {
                packImage.frame(maxHeight: 420)
                // tear line follows your finger across the top of the pack
                Rectangle().fill(Theme.gold)
                    .frame(width: 260 * tearProgress, height: 3)
                    .shadow(color: Theme.gold, radius: 6)
                    .frame(maxWidth: 260, alignment: .leading)
                    .padding(.top, 34)
            }
            .gesture(DragGesture(minimumDistance: 5)
                .onChanged { tearProgress = min(1, abs($0.translation.width) / 220) }
                .onEnded { _ in
                    if tearProgress > 0.6 {
                        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { torn = true }
                    } else {
                        withAnimation { tearProgress = 0 }
                    }
                })
            Text("Swipe across the top to tear it open").font(.subheadline).foregroundColor(Theme.muted)
            Spacer()
        }
        .padding(24)
    }

    private var reveal: some View {
        VStack(spacing: 18) {
            Spacer()
            HStack(spacing: 10) {
                ForEach(Array(pulled.enumerated()), id: \.offset) { i, id in
                    FlipCard(card: CardBook.card(id), flipped: flipped.contains(i))
                        .onTapGesture { flip(i, id) }
                }
            }
            .padding(.horizontal, 14)
            Text(flipped.count < pulled.count ? "Tap each card to flip it" : "Added to your collection")
                .font(.subheadline).foregroundColor(Theme.muted)
            if flipped.count == pulled.count {
                Button("Done") { pulled = [] }
                    .font(.headline).padding(.horizontal, 30).padding(.vertical, 12)
                    .background(Theme.cyan, in: Capsule()).foregroundColor(.black)
            }
            Spacer()
        }
    }

    private func flip(_ i: Int, _ id: String) {
        guard !flipped.contains(i) else { return }
        withAnimation(.easeInOut(duration: 0.45)) { _ = flipped.insert(i) }
        let rarity = CardBook.card(id)?.rarity ?? "Common"
        guard rarity != "Common" else {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        let color = Theme.rarityColor(rarity)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation(.easeOut(duration: 0.15)) { burst = color }
            withAnimation(.easeIn(duration: rarity == "Legendary" ? 1.2 : 0.5).delay(0.15)) { burst = nil }
        }
    }
}

// Card back that turns over to its face. Epic and Legendary cards glow and shake when revealed.
struct FlipCard: View {
    let card: Card?
    let flipped: Bool
    @State private var shake: CGFloat = 0

    var body: some View {
        ZStack {
            CardBack().opacity(flipped ? 0 : 1)
            Group {
                if let card { CardView(card: card) } else { CardBack() }
            }
            .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
            .opacity(flipped ? 1 : 0)
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .shadow(color: glow.opacity(flipped ? 0.9 : 0), radius: 16)
        .scaleEffect(flipped && card?.rarity == "Legendary" ? 1.08 : 1)
        .offset(x: shake)
        .onChange(of: flipped) { isFlipped in
            guard isFlipped, let r = card?.rarity, r == "Epic" || r == "Legendary" else { return }
            withAnimation(.default.repeatCount(4, autoreverses: true).delay(0.35)) { shake = 6 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { shake = 0 }
        }
    }

    private var glow: Color {
        guard let card, card.rarity != "Common" else { return .clear }
        return Theme.rarityColor(card.rarity)
    }
}
