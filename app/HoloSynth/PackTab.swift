import SwiftUI
import UIKit

// The Shop tab: daily cards and packs. Bought and won packs wait unopened; `onClose` set = "Your packs" (opened from the Play tab):
// swipe between them, Open one, drag a finger across the top to tear it, watch the cards rise out, then reveal them
// one at a time: swipe the top card of the stack to turn it over, swipe again (or wait) for the next.
struct PackTab: View {
    @EnvironmentObject var store: GameStore
    var onClose: (() -> Void)? = nil
    var recruit: RecruitIntro? = nil                // a Recruit Pack (a starter inside) instead of your packs / the shop
    @State private var page = 0                   // which of your packs the carousel shows
    @State private var drag: CGFloat = 0          // finger offset while swiping the carousel
    @State private var added: String?             // pack type just bought, for the "added" toast
    @State private var pulled: [String] = []     // cards in the pack being opened
    @State private var buying = false
    @State private var tearProgress: CGFloat = 0
    @State private var lastTick: CGFloat = 0
    @State private var torn = false               // top strip ripped off
    @State private var rising = false             // cards poking out of the pack
    @State private var dealt = false              // pack gone, cards laid out face down
    @State private var flipped: Set<Int> = []
    @State private var current = 0               // card on top of the stack; == count once all are revealed
    @State private var dragX: CGFloat = 0
    @State private var throwDir: [Int: CGFloat] = [:]
    @State private var sparking = false
    @State private var sparkOut = false
    @State private var shakes: CGFloat = 0
    @State private var burst: Color?
    @State private var pulledHolo: Set<Int> = []   // which of the pulled cards came out holo
    @State private var zoomed: Card?              // shop card tapped for a closer look
    @State private var openType = "cyber"         // wrapper of the pack being opened

    private let tearLine: CGFloat = 0.05          // just under the crimped top of the pack art
    private typealias PackInfo = (type: String, name: String, contents: String, glow: UInt32, cards: Int, price: Int)
    private static let packs: [PackInfo] = [   // prices match the server
        ("power", "Power Pack", "3 power cards", 0xB46BFF, 3, 3000),
        ("cyber", "Cyber Pack", "Fighter, Beast and Mech cards", 0x3FF0FF, 3, 5000),
        ("magic", "Magic Pack", "Arcanist, Spirit and Mystic cards", 0xB46BFF, 3, 5000),
        ("omni", "Omni Pack", "Any card from both sets", 0xE8B85A, 3, 5000),
        ("overload", "Overload Pack", "A guaranteed Rare or better + 7 more", 0xFFD77A, 8, 12000),
        ("legends", "Legends Pack", "A guaranteed Legendary + 4 more cards", 0xFFF3C4, 5, 25000),
    ]

    var body: some View {
        VStack(spacing: 0) {
            if onClose == nil { PlayerBar() }
            ZStack(alignment: .bottom) {
                ScreenBackground()
                if let recruit {
                    if !pulled.isEmpty { opening } else { recruitScreen(recruit) }
                } else if onClose != nil { yourPacks } else { shop }
                if let added { toast(added) }
            }
        }
        // Opening takes over the whole screen so the tabs can't be seen or tapped mid-rip.
        .fullScreenCover(isPresented: Binding(get: { recruit == nil && !pulled.isEmpty }, set: { if !$0 { pulled = [] } })) {
            ZStack {
                ScreenBackground()
                opening
                if let burst {
                    burst.opacity(0.45).ignoresSafeArea().allowsHitTesting(false).transition(.opacity)
                }
            }
        }
        .onAppear {
            if onClose != nil { store.error = nil }   // don't carry another screen's message in here
            if let next = store.profile?.shop?.next, SpinClock.ready(next) { Task { await store.refresh() } }   // a new day's shop
        }
    }

    // MARK: your packs

    private var owned: [UnopenedPack] { store.profile?.unopened ?? [] }

    private var yourPacks: some View {
        let list = owned
        let i = min(page, max(list.count - 1, 0))
        return VStack(spacing: 14) {
            HStack(spacing: 12) {
                Button { onClose?() } label: {
                    Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                        .frame(width: 44, height: 44).goldPanel(12)
                }
                .accessibilityLabel("Back")
                Text("Your packs").font(.chakra(24)).foregroundColor(Theme.fg)
                Spacer()
                Text("\(list.reduce(0) { $0 + $1.n }) to open").font(.barlow(13)).foregroundColor(Theme.muted)
            }
            .padding(.horizontal, 16)
            if list.isEmpty {
                Spacer()
            } else {
                Spacer(minLength: 0)
                // Swipe between your packs; the ones either side peek in, dimmed (like the old Packs tab).
                GeometryReader { g in
                    let slot: CGFloat = 270, w: CGFloat = 240
                    HStack(spacing: slot - w) {
                        ForEach(list.indices, id: \.self) { j in
                            let info = Self.info(list[j].type), on = j == i
                            packImage(list[j].type).frame(width: w)
                                .shadow(color: Color(hex: info.glow).opacity(on ? 0.55 : 0), radius: 26)
                                .overlay(alignment: .topTrailing) {
                                    if list[j].n > 1 && on {
                                        Text("×\(list[j].n)").font(.chakra(16)).foregroundColor(Color(hex: info.glow))
                                            .padding(.horizontal, 10).frame(minWidth: 44, minHeight: 32)
                                            .background(Theme.ink, in: Capsule())
                                            .overlay(Capsule().stroke(Color(hex: info.glow), lineWidth: 1))
                                            .offset(x: 8, y: 6)
                                    }
                                }
                                .scaleEffect(on ? 1 : 0.62)
                                .opacity(on ? 1 : 0.45).saturation(on ? 1 : 0.7)
                                .onTapGesture { withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { page = j } }
                        }
                    }
                    .offset(x: (g.size.width - w) / 2 - CGFloat(i) * slot + drag)
                    .frame(height: g.size.height)
                    .contentShape(Rectangle())
                    .gesture(DragGesture()
                        .onChanged { drag = $0.translation.width }
                        .onEnded { v in
                            let t = v.predictedEndTranslation.width
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                                if t < -slot / 3 { page = min(i + 1, list.count - 1) } else if t > slot / 3 { page = max(i - 1, 0) }
                                drag = 0
                            }
                        })
                }
                .frame(maxHeight: 420)
                HStack(spacing: 6) {
                    ForEach(list.indices, id: \.self) { j in
                        Capsule().fill(j == i ? Theme.brass : Theme.fg.opacity(0.3)).frame(width: j == i ? 22 : 7, height: 7)
                    }
                }
                let info = Self.info(list[i].type)
                VStack(spacing: 4) {
                    Text(info.name).font(.chakra(22)).tracking(1.5).textCase(.uppercase).foregroundColor(Color(hex: info.glow))
                    Text(list[i].type == "power" ? info.contents : "\(info.cards) cards · \(info.contents)").font(.barlow(14)).foregroundColor(Theme.muted)
                }
                if let error = store.error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
                Button("Open") {
                    // the pack only opens on the server once it's torn, so closing the app before that keeps it
                    let type = list[i].type
                    store.error = nil
                    start(Array(repeating: Self.unknown, count: Self.info(type).cards), type: type)
                }
                .buttonStyle(GoldButton(height: 52)).frame(width: 240)
                .disabled(buying)
                .padding(.top, 6)
                Spacer(minLength: 0).frame(maxHeight: 40)   // the pack, its name and Open sit together, low on the screen
            }
        }
        .padding(.top, 8).padding(.bottom, 24)
        .onChange(of: owned.count) { c in if page >= c { page = max(c - 1, 0) } }
    }

    // A Recruit Pack: heading near the top, the pack centred in the space left, Open at the bottom; Open tears it like any pack.
    @ViewBuilder private func recruitScreen(_ r: RecruitIntro) -> some View {
        if r.straightIn && store.error == nil {
            Color.clear.onAppear { start([Self.unknown], type: "recruit") }   // straight to tearing it: you need the card to play
        } else {
            recruitPick(r)
        }
    }

    private func recruitPick(_ r: RecruitIntro) -> some View {
        VStack(spacing: 14) {
            VStack(spacing: 8) {
                Text(r.eyebrow).sectionTitle()
                Text(r.title).font(.chakra(28)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                if let sub = r.subtitle { Text(sub).font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center) }
            }
            .padding(.top, 40)
            Spacer(minLength: 0)
            // the same pack, name and Open as Your packs
            packImage("recruit").frame(width: 240).shadow(color: Theme.cyan.opacity(0.55), radius: 26)
            VStack(spacing: 4) {
                Text("Recruit Pack").font(.chakra(22)).tracking(1.5).textCase(.uppercase).foregroundColor(Theme.cyan)
                Text("1 card · one of the three starters").font(.barlow(14)).foregroundColor(Theme.muted)
            }
            if let error = store.error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center) }
            Button("Open") { Task { await openRecruit() } }
                .buttonStyle(GoldButton(height: 52)).frame(width: 240)
                .disabled(buying)
                .padding(.top, 6)
            Spacer(minLength: 0).frame(maxHeight: 40)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
    }

    private func openRecruit() async { start([Self.unknown], type: "recruit") }

    // A pack's cards are only given out once it's torn, so closing the app before that keeps it unopened.
    private static let unknown = "?"
    private func fetchPack(_ type: String) {
        Task {
            if let r = await store.openPack(type) { pulled = r.cards; pulledHolo = Set(r.holo ?? []) }
            else { pulled = [] }   // back to Your packs, which shows the error
        }
    }
    private func fetchRecruit() {
        Task {
            if let id = await store.openRecruit() { pulled = pulled.map { $0 == Self.unknown ? id : $0 } }
            else { pulled = [] }   // back to the pack screen, which shows the error
        }
    }

    private static func info(_ type: String) -> PackInfo { packs.first { $0.type == type } ?? packs[0] }

    // "Overload Pack added": a bought pack goes to your packs on the Play tab.
    private func toast(_ type: String) -> some View {
        HStack(spacing: 12) {
            packImage(type).frame(height: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Self.info(type).name) added").font(.chakra(15)).foregroundColor(Theme.fg)
                Text("Open it from the Play tab").font(.barlow(12)).foregroundColor(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Theme.ink.opacity(0.96), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.brass.opacity(0.7), lineWidth: 1))
        .shadow(color: .black.opacity(0.6), radius: 15, y: 8)
        .padding(.horizontal, 16).padding(.bottom, 12)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }

    private func start(_ cards: [String], type: String, holo: [Int] = []) {
        openType = type
        pulledHolo = Set(holo)
        tearProgress = 0; lastTick = 0
        torn = false; rising = false; dealt = false
        flipped = []; sparking = false; sparkOut = false
        current = 0; dragX = 0; throwDir = [:]
        pulled = cards
    }

    // The shop: today's Rare up top, three Commons under it, then a row of packs you can scroll sideways.
    private var shop: some View {
        let gold = store.profile?.gold ?? 0
        let open = store.profile?.packsOpen ?? ["cyber"]
        return ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                if let s = store.profile?.shop, let rare = s.cards.first, let rc = CardBook.card(rare.id) {
                    HStack {
                        Text("Today in the shop").sectionTitle()
                        Spacer()
                        TimelineView(.periodic(from: .now, by: 30)) { _ in
                            (Text(Image(systemName: "clock")) + Text(" New in ") + Text(Self.left(s.next)).font(.chakra(13)).foregroundColor(Theme.fg))
                                .font(.barlow(12)).foregroundColor(Theme.muted)
                        }
                    }
                    featured(rc, rare, gold: gold)
                    HStack(spacing: 10) {
                        ForEach(1..<s.cards.count, id: \.self) { i in
                            if let c = CardBook.card(s.cards[i].id) { commonTile(c, s.cards[i], slot: i, gold: gold) }
                        }
                    }
                }
                Text("Packs").sectionTitle().padding(.top, 6)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(Self.packs.indices, id: \.self) { packTile(Self.packs[$0], open: open.contains(Self.packs[$0].type), gold: gold) }
                    }
                    .padding(.vertical, 6)
                }
                if let error = store.error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
            }
            .padding(16)
        }
        .sheet(item: $zoomed) { card in
            ZStack { ScreenBackground(); CardView(card: card).padding(40) }
        }
    }

    // "4h 12m" until the shop changes.
    private static func left(_ ms: Double) -> String {
        let m = max(0, Int(ms / 1000 - Date().timeIntervalSince1970)) / 60
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    private func featured(_ c: Card, _ item: Shop.Item, gold: Int) -> some View {
        let tint = Theme.rarityColor(c.rarity)
        return HStack(spacing: 14) {
            CardView(card: c).frame(width: 132).opacity(item.sold ? 0.5 : 1)
                .brightness(cardLock(c) == nil ? 0 : -0.3)
                .overlay { if let t = cardLock(c) { lockBand(t, width: 144) } }
                .onTapGesture { zoomed = c }
            VStack(alignment: .leading, spacing: 8) {
                Text("Featured \(c.rarity)").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(tint)
                Text(c.name).font(.chakra(24)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
                Text("\(c.hp) HP · \(c.basic.name) \(c.basic.dmg) · \(c.special.name) \(c.special.dmg)")
                    .font(.barlow(13)).foregroundColor(Theme.muted)
                Spacer(minLength: 0)   // pushes the button down so its bottom lines up with the card's bottom
                if cardLock(c) != nil { lockedButton(height: 42) } else { buyButton(item, slot: 0, gold: gold, height: 42) }
            }
            .padding(.top, 6).frame(maxHeight: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(12)
        .background(RadialGradient(colors: [tint.opacity(0.22), Theme.field], center: UnitPoint(x: 0.2, y: 0.3), startRadius: 0, endRadius: 260),
                    in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(tint.opacity(0.6), lineWidth: 1))
        .shadow(color: tint.opacity(0.18), radius: 24)
    }

    private func commonTile(_ c: Card, _ item: Shop.Item, slot: Int, gold: Int) -> some View {
        VStack(spacing: 6) {
            Color.clear.frame(height: 92)
                .overlay { if let img = Art.image(c.id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel } }
                .overlay(alignment: .bottomLeading) {
                    Text(c.name).font(.chakra(12)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.horizontal, 6).padding(.top, 14).padding(.bottom, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(LinearGradient(colors: [.clear, Theme.ink.opacity(0.95)], startPoint: .top, endPoint: .bottom))
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.rarityColor(c.rarity), lineWidth: 1))
                .opacity(item.sold ? 0.5 : 1)
                .brightness(cardLock(c) == nil ? 0 : -0.3)
                .overlay { if let t = cardLock(c) { lockBand(t, width: 120) } }
                .contentShape(Rectangle())
                .onTapGesture { zoomed = c }
                .accessibilityLabel("\(c.name), \(c.rarity)")
            if cardLock(c) != nil { lockedButton(height: 32) } else { buyButton(item, slot: slot, gold: gold, height: 32) }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func buyButton(_ item: Shop.Item, slot: Int, gold: Int, height: CGFloat) -> some View {
        if item.sold {
            Label("Bought", systemImage: "checkmark").font(.chakra(12)).tracking(1.5).textCase(.uppercase).foregroundColor(Theme.muted)
                .frame(maxWidth: .infinity).frame(height: height)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.fg.opacity(0.2), lineWidth: 1))
        } else {
            Button {
                buying = true
                Task {
                    if await store.buyShopCard(slot, item.id) {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        Sound.rare.play()
                    }
                    buying = false
                }
            } label: {
                Label(item.price.formatted(), systemImage: "circle.hexagongrid.fill").lineLimit(1).minimumScaleFactor(0.7)
            }
            .buttonStyle(GoldButton(height: height))
            .disabled(buying || gold < item.price)
        }
    }

    private func packTile(_ pack: PackInfo, open: Bool, gold: Int) -> some View {
        // Magic and Omni wait for chapter 1, Overload for chapter 2, Legends for chapter 3: dimmed, a band saying so
        let lockText = ["cyber", "power"].contains(pack.type) ? nil : store.profile?.locked?[["overload", "legends"].contains(pack.type) ? pack.type : "packs"]
        return VStack(spacing: 6) {
            packImage(pack.type).frame(height: 150).brightness(lockText == nil ? 0 : -0.3)
                .shadow(color: Color(hex: pack.glow).opacity(lockText == nil ? 0.35 : 0), radius: 10)
                .overlay { if let lockText { lockBand(lockText, width: 120) } }
            Text(pack.name).font(.chakra(13)).foregroundColor(Color(hex: pack.glow)).lineLimit(1).minimumScaleFactor(0.7)
            Text("\(pack.cards) cards").font(.barlow(12)).foregroundColor(Theme.muted)
            if lockText != nil {
                lockedButton(height: 32)
            } else {
            Button {
                buying = true
                Task {
                    if await store.buyPack(pack.type) != nil {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        withAnimation { added = pack.type }
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        withAnimation { if added == pack.type { added = nil } }
                    }
                    buying = false
                }
            } label: {
                if open { Label(pack.price.formatted(), systemImage: "circle.hexagongrid.fill").lineLimit(1).minimumScaleFactor(0.7) }
                else { Text("Soon") }
            }
            .buttonStyle(GoldButton(height: 32))
            .disabled(!open || buying || gold < pack.price)
            }
        }
        .frame(width: 108)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(pack.name), \(pack.cards) cards, \(pack.contents)")
    }

    // Shop things you can't buy yet: a dark band across the art saying what opens them, and a dimmed Locked button.
    private func lockBand(_ text: String, width: CGFloat) -> some View {
        VStack(spacing: 2) {
            Image(systemName: "lock.fill").font(.system(size: 12)).foregroundColor(Theme.brass)
            Text(text).font(.chakra(10)).tracking(1.6).textCase(.uppercase).foregroundColor(Theme.brass).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(width: width).padding(.vertical, 6)
        .background(Theme.ink.opacity(0.88))
        .overlay(alignment: .top) { Rectangle().fill(Theme.brass.opacity(0.6)).frame(height: 1) }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.brass.opacity(0.6)).frame(height: 1) }
    }

    private func lockedButton(height: CGFloat) -> some View {
        Label("Locked", systemImage: "lock.fill").font(.chakra(12)).tracking(1.4).textCase(.uppercase).foregroundColor(Theme.brass)
            .frame(maxWidth: .infinity).frame(height: height)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.brass.opacity(0.5), lineWidth: 1))
            .opacity(0.55)
    }

    // Magic-class shop cards wait for chapter 1, like the magic packs.
    private func cardLock(_ c: Card) -> String? {
        ["Arcanist", "Spirit", "Mystic"].contains(c.cls) ? store.profile?.locked?["packs"] : nil
    }

    private func packImage(_ type: String) -> some View {
        Group {
            if let img = Art.pack(type) { Image(uiImage: img).resizable().scaledToFit() }
            else { RoundedRectangle(cornerRadius: 12).fill(Theme.backRed).aspectRatio(631 / 1050, contentMode: .fit) }
        }
    }

    private var packArt: some View { packImage(openType) }

    // Same light for every pack, so the tear never gives away what's inside.
    private let leakColor = Color(hex: 0xFFE7A8)

    private var opening: some View {
        GeometryReader { geo in
            let packW = min(geo.size.width * 0.7, 300)
            let packH = packW * 1050 / 631
            let smallW = min((geo.size.width - 48) / 3, 130)    // in the pack and in the final row
            let bigW = min(geo.size.width * 0.7, 320)           // revealing one at a time
            let finished = dealt && current >= pulled.count
            let tearY = -packH / 2 + packH * tearLine          // tear line, relative to the pack centre
            ZStack {
                // light from inside the pack, behind everything
                Ellipse().fill(leakColor)
                    .frame(width: packW * 0.9, height: packH * 0.35)
                    .blur(radius: 40)
                    .offset(y: tearY)
                    .opacity(dealt ? 0 : (torn ? 0.9 : tearProgress * 0.5))
                    .scaleEffect(torn ? 1.3 : 1)

                // cards: hidden in the pack, rise out of the opening, then stack up big to reveal one by one
                ForEach(Array(pulled.enumerated()), id: \.offset) { i, id in
                    let slot = cardSlot(i, finished: finished, width: geo.size.width, tearY: tearY, smallW: smallW)
                    FlipCard(card: CardBook.card(id), power: Power.of(id), flipped: flipped.contains(i), holo: pulledHolo.contains(i))
                        .frame(width: bigW, height: bigW * 7 / 5)
                        .scaleEffect(slot.small ? smallW / bigW : 1 - CGFloat(max(0, i - current)) * 0.05)
                        .rotationEffect(.degrees(slot.angle))
                        .offset(slot.offset)
                        .zIndex(-Double(i))
                        .animation(.spring(response: 0.6, dampingFraction: 0.7), value: rising)
                        .animation(.spring(response: 0.55, dampingFraction: 0.75), value: dealt)
                        .gesture(DragGesture(minimumDistance: 10)
                            .onChanged { dragX = $0.translation.width }
                            .onEnded { v in
                                if abs(v.translation.width) > 60 { swipe(i, id, dir: v.translation.width > 0 ? 1 : -1) }
                                withAnimation(.spring()) { dragX = 0 }
                            })
                        .onTapGesture { swipe(i, id, dir: 1) }
                        .allowsHitTesting(dealt && i == current)
                }

                // pack body
                packArt.clipShape(TearEdge(top: false, at: tearLine))
                    .frame(width: packW, height: packH)
                    .shadow(color: Theme.backRed.opacity(0.7), radius: 24)
                    .modifier(Shake(animatableData: shakes))
                    .offset(y: dealt ? geo.size.height : 0)
                    .opacity(dealt ? 0 : 1)

                // glowing seam following the finger
                if !torn && tearProgress > 0 {
                    Capsule().fill(LinearGradient(colors: [leakColor, .white], startPoint: .leading, endPoint: .trailing))
                        .frame(width: packW * tearProgress, height: 4)
                        .shadow(color: leakColor, radius: 8)
                        .frame(width: packW, alignment: .leading)
                        .offset(y: tearY)
                    Circle().fill(.white).frame(width: 14, height: 14).blur(radius: 3)
                        .shadow(color: leakColor, radius: 12)
                        .offset(x: -packW / 2 + packW * tearProgress, y: tearY)
                }

                // the top strip: peels up from the left as you drag, then flies off
                packArt.clipShape(TearEdge(top: true, at: tearLine))
                    .frame(width: packW, height: packH)
                    .rotationEffect(.degrees(torn ? 50 : Double(tearProgress) * 14),
                                    anchor: UnitPoint(x: 1, y: tearLine))
                    .offset(x: torn ? packW * 0.7 : 0, y: torn ? -packH * 0.7 : -tearProgress * 6)
                    .opacity(torn ? 0 : 1)
                    .modifier(Shake(animatableData: shakes))

                // sparks when it rips
                if sparking { sparks(at: tearY) }

                hint.offset(y: hintY(finished: finished, smallW: smallW, bigW: bigW, packH: packH))

                // HOLO! over the card while a holo one is showing
                if dealt, current < pulled.count, flipped.contains(current), pulledHolo.contains(current) {
                    Text("HOLO!").font(.chakra(40)).tracking(4)
                        .foregroundStyle(LinearGradient(colors: HoloFoil.rainbow, startPoint: .leading, endPoint: .trailing))
                        .shadow(color: .white.opacity(0.5), radius: 10)
                        .offset(y: -(bigW * 0.7) - 48)
                        .transition(.scale.combined(with: .opacity))
                        .allowsHitTesting(false)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 4)
                .onChanged { drag in
                    guard !torn else { return }
                    // only a swipe that starts across the top of the pack tears it
                    guard abs(drag.startLocation.y - (geo.size.height / 2 + tearY)) < 80 else { return }
                    let p = min(1, abs(drag.translation.width) / (packW * 0.85))
                    guard p > tearProgress else { return }
                    Rip.scratch(speed: Double(p - tearProgress) * 40)
                    tearProgress = p
                    if p - lastTick > 0.08 {
                        lastTick = p
                        UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.4 + p * 0.6)
                    }
                    if p >= 1 { tearOpen() }
                }
                .onEnded { _ in
                    guard !torn else { return }
                    Rip.end()
                    if tearProgress > 0.7 { tearOpen() }
                    else { withAnimation(.spring()) { tearProgress = 0 }; lastTick = 0 }
                })
        }
    }

    // The hint / Done button sits just under the cards.
    private func hintY(finished: Bool, smallW: CGFloat, bigW: CGFloat, packH: CGFloat) -> CGFloat {
        if finished {
            let rows = CGFloat((pulled.count + 2) / 3)
            return rows * (smallW * 7 / 5 + 10) / 2 + 40
        }
        return dealt ? bigW * 0.7 + 60 : packH / 2 + 36
    }

    // Where card i sits: in the pack, stacked (top card follows your finger), thrown aside, or in the final row.
    private func cardSlot(_ i: Int, finished: Bool, width: CGFloat, tearY: CGFloat, smallW: CGFloat)
        -> (offset: CGSize, angle: Double, small: Bool) {
        let side = CGFloat(i - 1)
        if !dealt { return (CGSize(width: side * 8, height: rising ? tearY - smallW * 0.25 : 0), Double(side) * 5, true) }
        if finished {   // rows of 3 (more than one pack, e.g. from the Gauntlet, wraps onto more rows), centred
            let n = pulled.count, rows = (n + 2) / 3, row = i / 3, inRow = min(3, n - row * 3)
            let x = (CGFloat(i % 3) - CGFloat(inRow - 1) / 2) * (smallW + 10)
            let y = (CGFloat(row) - CGFloat(rows - 1) / 2) * (smallW * 7 / 5 + 10)
            return (CGSize(width: x, height: y), 0, true)
        }
        if i < current {
            let dir = throwDir[i] ?? 1
            return (CGSize(width: dir * width * 1.3, height: -40), Double(dir) * 25, false)
        }
        if i == current { return (CGSize(width: dragX, height: 0), Double(dragX) / 18, false) }
        let depth = CGFloat(i - current)
        return (CGSize(width: 0, height: depth * 16), i.isMultiple(of: 2) ? 3 : -3, false)
    }

    // First swipe turns the top card over; the next swipe (or a short wait) throws it aside.
    private func swipe(_ i: Int, _ id: String, dir: CGFloat) {
        guard dealt, i == current, id != Self.unknown else { return }   // a Recruit card still on its way
        throwDir[i] = dir
        guard flipped.contains(i) else {
            flip(i, id)
            let rarity = packRarity(id)
            let wait = ["Epic": 2.6, "Legendary": 3.4][rarity] ?? 1.6
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                if current == i { advance() }
            }
            return
        }
        advance()
    }

    private func advance() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { current += 1 }
    }

    private func sparks(at y: CGFloat) -> some View {
        ZStack {
            ForEach(0..<16, id: \.self) { i in
                let angle = Double(i) / 16 * 2 * .pi
                let dist = CGFloat(90 + (i * 37) % 70)
                Circle().fill(i.isMultiple(of: 3) ? Color.white : leakColor).frame(width: 5, height: 5)
                    .offset(x: sparkOut ? CGFloat(cos(angle)) * dist : 0,
                            y: y + (sparkOut ? CGFloat(sin(angle)) * dist * 0.6 : 0))
                    .opacity(sparkOut ? 0 : 1)
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder private var hint: some View {
        if !torn {
            Text("Swipe across the top to tear it open").font(.barlow(15)).foregroundColor(Theme.muted)
                .opacity(tearProgress > 0 ? 0 : 1)
        } else if dealt && current < pulled.count {
            Text(flipped.contains(current) ? "Swipe for the next card" : "Swipe to reveal \(current + 1) of \(pulled.count)")
                .font(.barlow(15)).foregroundColor(Theme.muted)
        } else if dealt {
            VStack(spacing: 14) {
                Text("Added to your collection").font(.barlow(15)).foregroundColor(Theme.muted)
                Button("Done") {
                    if recruit != nil { onClose?(); return }   // its own page: just close
                    pulled = []
                    if let onClose, owned.isEmpty { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { onClose() } }   // after the cover slides away
                }
                .buttonStyle(GoldButton(height: 50)).frame(width: 200)
            }
        }
    }

    private func tearOpen() {
        guard !torn else { return }
        if pulled.contains(Self.unknown) { if recruit != nil { fetchRecruit() } else { fetchPack(openType) } }
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        Rip.end()
        Sound.tear.play()
        sparking = true; sparkOut = false
        withAnimation(.easeIn(duration: 0.45)) { torn = true }
        withAnimation(.linear(duration: 0.4)) { shakes += 1 }
        DispatchQueue.main.async { withAnimation(.easeOut(duration: 0.8)) { sparkOut = true } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            rising = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            withAnimation(.easeIn(duration: 0.5)) { dealt = true }
            sparking = false
        }
    }

    private func flip(_ i: Int, _ id: String) {
        guard !flipped.contains(i) else { return }
        withAnimation(.easeInOut(duration: 0.45)) { _ = flipped.insert(i) }
        Sound.flip.play()
        let rarity = packRarity(id)
        if pulledHolo.contains(i) {   // holo beats any rarity: rainbow flash, the big sound
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            DispatchQueue.main.asyncAfter(deadline: .now() + Sound.flip.duration) {
                Sound.legendary.play()
                withAnimation(.easeOut(duration: 0.15)) { burst = Color(hex: 0x8CC8FF) }
                withAnimation(.easeIn(duration: 1.2).delay(0.15)) { burst = nil }
            }
            return
        }
        guard rarity != "Common" else {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        let color = Theme.rarityColor(rarity)
        DispatchQueue.main.asyncAfter(deadline: .now() + Sound.flip.duration) {
            (rarity == "Legendary" ? Sound.legendary : Sound.rare).play()
            withAnimation(.easeOut(duration: 0.15)) { burst = color }
            withAnimation(.easeIn(duration: rarity == "Legendary" ? 1.2 : 0.5).delay(0.15)) { burst = nil }
        }
    }
}

// A pack card's rarity: a character card or a power card ("pw:<id>").
func packRarity(_ id: String) -> String { CardBook.card(id)?.rarity ?? Power.of(id)?.rarity ?? "Common" }

// Card back that turns over to its face. Epic and Legendary cards glow and shake when revealed.
struct FlipCard: View {
    let card: Card?
    var power: Power? = nil      // a power card ("pw:<id>") pulled from the pack
    let flipped: Bool
    var holo = false
    @State private var shake: CGFloat = 0

    var body: some View {
        ZStack {
            CardBack().opacity(flipped ? 0 : 1)
            Group {
                if let card { CardView(card: card, fusion: holo ? .holoCopy : nil) } else if let power { PowerCardView(power: power) } else { CardBack() }
            }
            .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
            .opacity(flipped ? 1 : 0)
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .shadow(color: glow.opacity(flipped ? 0.9 : 0), radius: 16)
        .offset(x: shake)
        .onChange(of: flipped) { isFlipped in
            guard isFlipped, let r = card?.rarity ?? power?.rarity, r == "Epic" || r == "Legendary" else { return }
            withAnimation(.default.repeatCount(4, autoreverses: true).delay(0.35)) { shake = 6 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { shake = 0 }
        }
    }

    private var glow: Color {
        guard let r = card?.rarity ?? power?.rarity, r != "Common" else { return .clear }
        return Theme.rarityColor(r)
    }
}

// Top strip or body of the pack, split along a zigzag tear.
struct TearEdge: Shape {
    let top: Bool
    let at: CGFloat

    func path(in r: CGRect) -> Path {
        let y = r.height * at, teeth = 18, amp = r.height * 0.008
        let edge = (0...teeth).map { i in
            CGPoint(x: r.width * CGFloat(i) / CGFloat(teeth), y: y + (i.isMultiple(of: 2) ? -amp : amp))
        }
        var p = Path()
        if top {
            p.move(to: .zero)
            p.addLine(to: CGPoint(x: r.width, y: 0))
            edge.reversed().forEach { p.addLine(to: $0) }
        } else {
            p.move(to: edge[0])
            edge.dropFirst().forEach { p.addLine(to: $0) }
            p.addLine(to: CGPoint(x: r.width, y: r.height))
            p.addLine(to: CGPoint(x: 0, y: r.height))
        }
        p.closeSubpath()
        return p
    }
}

// Side-to-side jolt; animate animatableData up by 1 for one shake.
struct Shake: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 7 * sin(animatableData * .pi * 6), y: 0))
    }
}

// The Shop tab: locked (what opens it and your XP toward it) until the server says it's open.
struct ShopGate: View {
    @EnvironmentObject var store: GameStore

    var body: some View {
        if let p = store.profile, let need = p.locked?["shop"] {
            ZStack {
                ScreenBackground()
                VStack(spacing: 16) {
                    Image(systemName: "lock.fill").font(.system(size: 34)).foregroundColor(Theme.muted)
                        .frame(width: 84, height: 84).goldPanel(42)
                    Text("Shop").sectionTitle()
                    Text(need.replacingOccurrences(of: "Reach player", with: "Opens at player"))
                        .font(.chakra(26)).foregroundColor(Theme.fg).multilineTextAlignment(.center)
                    Text("Daily cards and packs. Clear campaign levels and daily quests to level up.")
                        .font(.barlow(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    VStack(spacing: 6) {
                        HStack {
                            Text("LV \(p.level)").font(.chakra(13)).foregroundColor(Theme.fg)
                            Spacer()
                            Text("\(p.xpInto) / \(p.xpNeed) XP").font(.barlow(13)).foregroundColor(Theme.muted).monospacedDigit()
                        }
                        GeometryReader { g in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.fg.opacity(0.12))
                                Capsule().fill(LinearGradient(colors: [Color(hex: 0xE0A12A), Color(hex: 0xFFD77A)], startPoint: .leading, endPoint: .trailing))
                                    .frame(width: g.size.width * CGFloat(p.xpInto) / CGFloat(p.xpNeed))
                            }
                        }
                        .frame(height: 8)
                    }
                    .padding(.top, 6)
                }
                .padding(.horizontal, 28)
            }
        } else {
            PackTab()
        }
    }
}

// What the Recruit Pack screen says if it can't go straight to the tear (straightIn; e.g. the open failed: try again).
struct RecruitIntro {
    var eyebrow = "Recruit Pack"
    var title = "Open your Recruit Pack"
    var subtitle: String? = nil
    var straightIn = true
}
