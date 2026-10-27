import SwiftUI

// Trading with a friend: build an offer (up to 3 cards and some gold each way), answer one, or see it through.
// Cards on your team stay locked unless you own a spare copy; the server checks everything again on accept.

// MARK: build an offer (also used to counter one)
struct TradeBuilder: View {
    @EnvironmentObject var store: GameStore
    let friend: String
    let avatar: String
    var counter: Trade? = nil                   // answering this offer
    let onClose: () -> Void

    @State private var give: [String] = []
    @State private var get: [String] = []
    @State private var giveGold = 0
    @State private var getGold = 0
    @State private var cards: TradeCards?
    @State private var picking: Bool?           // true: my cards, false: theirs
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 12) {
                TradeHeader(title: counter == nil ? "Trade with \(friend)" : "Counter \(friend)", avatar: avatar, onClose: onClose)
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        side("You give", cards: $give, gold: $giveGold, goldLabel: "Add gold", maxGold: cards?.gold ?? 0, mine: true)
                        side("You get", cards: $get, gold: $getGold, goldLabel: "Ask for gold", maxGold: 1_000_000, mine: false)
                        if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                        Button(sending ? "Sending…" : "Send offer", action: send).buttonStyle(GoldButton())
                            .disabled(sending || cards == nil || (give.isEmpty && get.isEmpty && giveGold == 0 && getGold == 0))
                        Text("\(friend) can accept, decline or send a counter offer.")
                            .font(.barlow(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 16).padding(.bottom, 16)
                }
            }
        }
        .task {
            if let c = counter { give = c.give; get = c.get; giveGold = c.giveGold; getGold = c.getGold }
            do { cards = try await API.call("trades/cards/\(friend)", token: store.token) }
            catch { self.error = error.localizedDescription }
        }
        .sheet(item: Binding(get: { picking.map { PickSide(mine: $0) } }, set: { picking = $0?.mine })) { p in
            TradePicker(title: p.mine ? "Pick cards to give" : "Pick from \(friend)'s cards",
                        avatar: p.mine ? (store.profile?.avatar ?? "volt") : avatar,
                        spare: (p.mine ? cards?.mine : cards?.theirs) ?? [:],
                        fused: (p.mine ? cards?.mineFused : cards?.theirsFused) ?? [],
                        owned: p.mine ? (store.profile?.collection ?? [:]) : [:],
                        team: p.mine ? Set(store.profile?.team ?? []) : [],
                        picked: p.mine ? $give : $get) { picking = nil }
        }
    }

    private struct PickSide: Identifiable { let mine: Bool; var id: Bool { mine } }

    // Fusion levels of a fused copy in this offer ("card#12"), wherever we know it from.
    private func fusion(_ token: String) -> Fusion? {
        guard let id = TradeItem.fusedId(token) else { return nil }
        let all = (cards?.mineFused ?? []) + (cards?.theirsFused ?? []) + Array((counter?.fusions ?? [:]).values)
        return all.first { String($0.id) == id }?.fusion
    }

    private func side(_ title: String, cards list: Binding<[String]>, gold: Binding<Int>, goldLabel: String, maxGold: Int, mine: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).sectionTitle()
                Spacer()
                Text(mine ? "up to 3 cards" : "from \(friend)'s cards").font(.barlow(12)).foregroundColor(Theme.muted)
            }
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    if i < list.wrappedValue.count, let card = TradeItem.card(list.wrappedValue[i]) {
                        CardView(card: card, fusion: fusion(list.wrappedValue[i]))
                            .overlay(alignment: .topTrailing) {
                                Button { list.wrappedValue.remove(at: i) } label: {
                                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(Theme.brass)
                                        .frame(width: 24, height: 24).background(Theme.ink, in: Circle())
                                        .overlay(Circle().stroke(Theme.brass.opacity(0.6), lineWidth: 1))
                                }
                                .offset(x: 7, y: -7)
                                .accessibilityLabel("Remove \(card.name)")
                            }
                    } else {
                        Button { picking = mine } label: {
                            RoundedRectangle(cornerRadius: 8).stroke(Theme.brass.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, dash: [5]))
                                .background(Theme.ink.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                                .overlay(Image(systemName: "plus").font(.system(size: 24, weight: .medium)).foregroundColor(Theme.brass))
                                .aspectRatio(5.0 / 7.0, contentMode: .fit)
                        }
                        .accessibilityLabel("Add a card")
                    }
                }
            }
            HStack(spacing: 10) {
                Text(goldLabel).font(.barlow(14)).foregroundColor(Theme.muted)
                Spacer()
                stepButton("minus") { gold.wrappedValue = max(0, gold.wrappedValue - 50) }
                Label("\(gold.wrappedValue)", systemImage: "circle.hexagongrid.fill").font(.chakra(17)).monospacedDigit()
                    .foregroundColor(Theme.fg).frame(minWidth: 80)
                stepButton("plus") { gold.wrappedValue = min(maxGold, gold.wrappedValue + 50) }
            }
        }
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass).frame(width: 34, height: 34).goldPanel(10)
        }
    }

    private func send() {
        sending = true; error = nil
        Task {
            do {
                var body: [String: Any] = ["to": friend, "give": give, "get": get, "giveGold": giveGold, "getGold": getGold]
                if let c = counter { body["counter"] = c.id }
                _ = try await store.socialAction("trades", body)
                onClose()
            } catch { self.error = error.localizedDescription }
            sending = false
        }
    }
}

// MARK: pick cards for one side
struct TradePicker: View {
    let title: String
    let avatar: String
    let spare: [String: Int]          // plain copies that can be traded
    let fused: [FusedCopy]            // fused copies that can be traded (each its own item)
    let owned: [String: Int]          // my whole collection, to show team cards as locked; empty for their side
    let team: Set<String>
    @Binding var picked: [String]
    let onDone: () -> Void
    @AppStorage("collectionSort") private var sort = 0

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        // plain copies you have (or team cards, shown locked); cards whose every copy is fused only appear as fused copies
        let ids = Set(spare.keys).union(owned.keys.filter { team.contains($0) })
        let cards = CardSort.apply(CardBook.all.filter { ids.contains($0.id) }, sort, counts: spare)
        let order = Dictionary(uniqueKeysWithValues: CardSort.apply(CardBook.all, sort).enumerated().map { ($1.id, $0) })
        let fusedSorted = fused.sorted { (order[$0.card] ?? 0, $1.fusion.total) < (order[$1.card] ?? 0, $0.fusion.total) }
        ZStack {
            ScreenBackground()
            VStack(spacing: 12) {
                TradeHeader(title: title, avatar: avatar, onClose: onDone)
                HStack {
                    Text("\(picked.count) of 3 picked").sectionTitle()
                    Spacer()
                    Button { sort = (sort + 1) % CardSort.names.count } label: { Label(CardSort.names[sort % CardSort.names.count], systemImage: "arrow.up.arrow.down") }
                        .buttonStyle(OutlineButton())
                        .accessibilityLabel("Sort by \(CardSort.names[sort % CardSort.names.count]), tap to change")
                }
                .padding(.horizontal, 16)
                if !owned.isEmpty {
                    Text("Team cards are locked unless you have a spare copy.").font(.barlow(13)).foregroundColor(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16)
                }
                ScrollView(showsIndicators: false) {
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(fusedSorted) { fusedCell($0) }
                        ForEach(cards) { cell($0) }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 4)
                }
                Button("Done", action: onDone).buttonStyle(GoldButton()).padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
    }

    @ViewBuilder private func cell(_ card: Card) -> some View {
        let free = spare[card.id] ?? 0
        let chosen = picked.filter { $0 == card.id }.count
        let have = owned[card.id] ?? free
        CardView(card: card)
            .overlay(alignment: .topTrailing) {
                if have > 1 {
                    Text("×\(have)").font(.chakra(9)).monospacedDigit()
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05))
                        .scaleEffect(0.5, anchor: .topTrailing).offset(x: 2, y: -2)
                }
            }
            .opacity(free == 0 ? 0.35 : 1)
            .overlay {
                if free == 0 {
                    Text("On team").font(.chakra(10, semibold: true)).tracking(1.5).textCase(.uppercase).foregroundColor(Theme.brass)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
                }
            }
            .overlay {
                if chosen > 0 { RoundedRectangle(cornerRadius: 8).stroke(Theme.brass, lineWidth: 3).shadow(color: Theme.brass, radius: 8) }
            }
            .overlay(alignment: .bottom) {
                if chosen > 0 && free > 1 {   // duplicates: choose how many copies
                    HStack(spacing: 2) {
                        copyButton("minus") { remove(card.id) }
                        Text("\(chosen) of \(free)").font(.chakra(12)).monospacedDigit().foregroundColor(Theme.fg).fixedSize().frame(minWidth: 40)
                        copyButton("plus") { if picked.count < 3 && chosen < free { picked.append(card.id) } }
                    }
                    .padding(2).background(Theme.ink, in: Capsule()).overlay(Capsule().stroke(Theme.brass, lineWidth: 1))
                    .padding(.bottom, 6)
                }
            }
            .onTapGesture {
                guard free > 0 else { return }
                if chosen == 0 { if picked.count < 3 { picked.append(card.id) } }
                else if free == 1 { remove(card.id) }
            }
            .accessibilityAddTraits(chosen > 0 ? .isSelected : [])
    }

    // A fused copy is one item: tap to add or remove it.
    @ViewBuilder private func fusedCell(_ copy: FusedCopy) -> some View {
        let token = TradeItem.token(copy)
        let chosen = picked.contains(token)
        if let card = CardBook.card(copy.card) {
            CardView(card: card, fusion: copy.fusion)
                .overlay {
                    if chosen { RoundedRectangle(cornerRadius: 8).stroke(Theme.brass, lineWidth: 3).shadow(color: Theme.brass, radius: 8) }
                }
                .onTapGesture {
                    if chosen { picked.removeAll { $0 == token } } else if picked.count < 3 { picked.append(token) }
                }
                .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    private func copyButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundColor(Theme.brass)
                .frame(width: 26, height: 26).background(Theme.brass.opacity(0.15), in: Circle())
        }
    }

    private func remove(_ id: String) { if let i = picked.lastIndex(of: id) { picked.remove(at: i) } }
}

// MARK: an open offer — answer it (theirs) or cancel it (mine)
struct TradeOfferView: View {
    @EnvironmentObject var store: GameStore
    let trade: Trade
    let onCounter: () -> Void
    let onClose: () -> Void
    @State private var busy = false
    @State private var error: String?
    @State private var done: TradeDone?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let d = done { complete(d) } else { offer }
        }
    }

    private var offer: some View {
        VStack(spacing: 12) {
            TradeHeader(title: trade.mine ? "Your offer to \(trade.name)" : "\(trade.name) wants to trade", avatar: trade.avatar, onClose: onClose)
            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    if trade.mine {   // pending and accepted share one layout; only the tag and the button change
                        let ready = trade.status == "accepted"
                        Text(ready ? "Accepted" : "Pending · waiting for \(trade.name)")
                            .font(.chakra(12, semibold: true)).tracking(2).textCase(.uppercase).lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundColor(ready ? Theme.online : Theme.muted)
                            .padding(.horizontal, 14).frame(height: 30)
                            .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(ready ? Theme.online : Theme.muted.opacity(0.6), lineWidth: 1))
                    }
                    show("You get", trade.get, gold: trade.getGold)
                    show("You give", trade.give, gold: trade.giveGold)
                    if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                    if trade.mine {
                        if trade.status == "accepted" {
                            Button(busy ? "Claiming…" : "Claim") { claim() }.buttonStyle(GoldButton()).disabled(busy)
                        } else {
                            Button { answer("cancel") } label: {
                                Text("Cancel offer").font(.chakra(18)).tracking(2.2).textCase(.uppercase).foregroundColor(Theme.muted)
                                    .frame(maxWidth: .infinity).frame(height: 56)
                                    .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.muted.opacity(0.5), lineWidth: 1))
                            }
                            .disabled(busy)
                        }
                    } else {
                        HStack(spacing: 10) {
                            Button { answer("decline") } label: { Text("Decline").frame(maxWidth: .infinity) }
                                .buttonStyle(OutlineButton(color: Theme.muted))
                            Button { onCounter() } label: { Text("Counter").frame(maxWidth: .infinity) }.buttonStyle(OutlineButton())
                        }
                        .disabled(busy)
                        Button(busy ? "Trading…" : "Accept trade") { answer("accept") }.buttonStyle(GoldButton()).disabled(busy)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 16)
            }
        }
    }

    // Fixed-height title row and always 3 card slots, so every trade screen lines up the same.
    private func show(_ title: String, _ ids: [String], gold: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).sectionTitle()
                Spacer()
                if gold > 0 { Label("\(gold)", systemImage: "circle.hexagongrid.fill").font(.chakra(15)).foregroundColor(Theme.fg) }
            }
            .frame(height: 22)
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    if i < ids.count, let c = TradeItem.card(ids[i]) {
                        CardView(card: c, fusion: TradeItem.fusedId(ids[i]).flatMap { trade.fusions?[$0]?.fusion })
                    }
                    else { Color.clear.aspectRatio(5.0 / 7.0, contentMode: .fit) }
                }
            }
            .overlay {
                if ids.isEmpty { Text(gold > 0 ? "Just gold" : "Nothing").font(.barlow(14)).foregroundColor(Theme.muted) }
            }
        }
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    // Same layout as the other reward screens: title, art, line, button.
    private func complete(_ d: TradeDone) -> some View {
        VStack(spacing: 18) {
            Spacer()
            Text("Trade complete!").font(.chakra(34)).textCase(.uppercase).foregroundColor(Color(hex: 0xFFD77A))
                .shadow(color: Color(hex: 0xFFD77A).opacity(0.6), radius: 12)
            HStack(spacing: 12) {
                ForEach(Array(d.received.enumerated()), id: \.offset) { _, id in
                    if let c = CardBook.card(id) { CardView(card: c).frame(maxWidth: 140) }
                }
            }
            .frame(height: 250).padding(.horizontal, 16)
            Text(d.gold > 0 ? "+ \(d.gold) gold · from \(d.from)" : "from \(d.from)").font(.barlow(15)).foregroundColor(Theme.muted)
            Button("Nice", action: onClose).buttonStyle(GoldButton()).frame(width: 240)
            Spacer()
        }
        .onAppear { Sound.rare.play() }
    }

    private func claim() {
        busy = true; error = nil
        Task {
            do {
                let d: TradeDone = try await API.call("trades/claim", token: store.token, body: ["id": trade.id])
                store.social = d.social; store.profile = d.profile
                done = d
            } catch {
                self.error = error.localizedDescription
                await store.loadSocial()
            }
            busy = false
        }
    }

    private func answer(_ action: String) {
        busy = true; error = nil
        Task {
            do {
                if action == "accept" {
                    let d: TradeDone = try await API.call("trades/accept", token: store.token, body: ["id": trade.id])
                    store.social = d.social; store.profile = d.profile
                    done = d
                } else {
                    _ = try await store.socialAction("trades/\(action)", ["id": trade.id])
                    onClose()
                }
            } catch {
                self.error = error.localizedDescription
                await store.loadSocial()
            }
            busy = false
        }
    }
}

struct TradeHeader: View {
    let title: String
    let avatar: String
    let onClose: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Avatar(id: avatar, size: 40)
            Text(title).font(.chakra(22)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
            Spacer(minLength: 4)
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.brass)
                    .frame(width: 40, height: 40).goldPanel(12)
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16).padding(.top, 12)
    }
}
