import SwiftUI
import UIKit

// Expeditions and the Collector (web: screens/expeditions.js). Send spare cards on timed missions, and turn in spare
// copies for today's requests. Both pay gold and Pass XP; the server fixes the rewards.

// "◉ 9,750  +1,170 Pass XP  + pack"
struct XRewardLine: View {
    let gold: Int
    let xp: Int
    var pack: Bool = false
    var body: some View {
        HStack(spacing: 12) {
            Label(gold.formatted(), systemImage: "circle.hexagongrid.fill").foregroundColor(Theme.fg)
            Text("+\(xp.formatted()) Pass XP").foregroundColor(Theme.cyan)
            if pack { Text("+ pack").font(.chakra(12)).foregroundColor(HuntView.gold) }
        }
        .font(.chakra(14)).lineLimit(1).minimumScaleFactor(0.7)
    }
}

// The reward card shown over the screen after a claim or turn-in.
struct XRewardPop: View {
    let title: String
    let r: XReward
    let onClose: () -> Void
    var body: some View {
        ZStack {
            Color.black.opacity(0.72).ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(spacing: 18) {
                Text(title).sectionTitle().multilineTextAlignment(.center)
                HStack(alignment: .bottom, spacing: 26) {
                    column(Image(systemName: "circle.hexagongrid.fill").font(.system(size: 36)).foregroundColor(Theme.brass), r.gold.formatted(), Theme.fg)
                    column(Text("XP").font(.chakra(28)).foregroundColor(Theme.cyan), "+\(r.xp.formatted())", Theme.cyan)
                    if let pk = r.pack, let img = Art.pack(pk) {
                        VStack(spacing: 6) {
                            Image(uiImage: img).resizable().scaledToFit().frame(height: 64)
                            Text("\(pk.capitalized) Pack").font(.barlow(13, semibold: true)).foregroundColor(Theme.fg)
                        }
                    }
                }
                Button("Nice", action: onClose).buttonStyle(GoldButton())
            }
            .padding(22)
            .frame(maxWidth: 340)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(HuntView.gold.opacity(0.8), lineWidth: 1))
            .shadow(color: Theme.gold.opacity(0.35), radius: 24)
            .padding(24)
        }
    }
    private func column<V: View>(_ icon: V, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 6) {
            icon.frame(height: 40)
            Text(value).font(.chakra(24)).foregroundColor(color).monospacedDigit()
        }
    }
}

// Back button + title, like the other full screens.
struct XHeader: View {
    let title: String
    let back: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Button(action: back) {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                    .frame(width: 44, height: 44).goldPanel(12)
            }
            .accessibilityLabel("Back")
            Text(title).font(.chakra(24)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// A card you can pick: gold ring and a check (or ×2) when picked; `count` shows as the usual ×N pill.
struct XPickCell: View {
    let card: Card
    let count: Int
    let picked: Int
    let tap: () -> Void
    var body: some View {
        CardView(card: card)
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("×\(count)").font(.chakra(9)).monospacedDigit()
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Theme.brass, in: Capsule()).foregroundColor(Color(hex: 0x1A0D05))
                        .offset(x: 3, y: -3)
                }
            }
            .overlay {
                if picked > 0 { RoundedRectangle(cornerRadius: 8).stroke(HuntView.gold, lineWidth: 3).shadow(color: Theme.gold.opacity(0.6), radius: 8) }
            }
            .overlay(alignment: .topLeading) {
                if picked > 0 {
                    Group {
                        if picked > 1 { Text("×\(picked)").font(.chakra(12)) } else { Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)) }
                    }
                    .foregroundColor(Color(hex: 0x1A0D05)).frame(minWidth: 24, minHeight: 24).padding(.horizontal, picked > 1 ? 4 : 0)
                    .background(HuntView.gold, in: Capsule())
                    .offset(x: -6, y: -8)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: tap)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(card.name), \(card.rarity) \(card.cls)\(picked > 0 ? ", picked" : "")")
            .accessibilityAddTraits(.isButton)
    }
}

private let xGrid = [GridItem(.adaptive(minimum: 100), spacing: 12)]
private let xSoft = Color(hex: 0xA9A5C2)

// MARK: Expeditions

struct ExpeditionsView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void
    @State private var busy = false
    @State private var error: String?
    @State private var won: XReward?
    @State private var sending = false

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 12) {
                XHeader(title: "Expeditions", back: onClose)
                if let e = store.profile?.expeditions {
                    ScrollView(showsIndicators: false) {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in list(e, now: ctx.date.timeIntervalSince1970 * 1000) }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8)
            if let won { XRewardPop(title: "\(won.name) · back", r: won) { self.won = nil } }
        }
        .disabled(busy)
        .fullScreenCover(isPresented: $sending) { ExpSendView { sending = false } }
        .task { await store.refresh() }
    }

    private func list(_ e: ExpeditionsInfo, now: Double) -> some View {
        let open = e.missions.filter { !$0.sent }.count
        let free = max(0, min(open, 3 - e.away.count))
        return VStack(spacing: 12) {
            ForEach(e.away) { x in slot(x, now: now) }
            ForEach(0..<free, id: \.self) { _ in freeSlot }
            if open == 0 {
                Text("New missions in \(HuntView.left(e.next))").font(.barlow(13)).foregroundColor(Theme.muted).padding(.top, 4)
            }
            if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink) }
        }
        .padding(.bottom, 24)
    }

    private func slot(_ x: ExpeditionsInfo.Away, now: Double) -> some View {
        let back = x.ends <= now
        let frac = CGFloat(min(1, max(0, (now - x.start) / max(1, x.ends - x.start))))
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(x.name).font(.chakra(17)).foregroundColor(Theme.fg)
                Spacer()
                Text(back ? "Back!" : "\(HuntView.left(x.ends)) left").font(.barlow(13, semibold: back))
                    .foregroundColor(back ? HuntView.gold : xSoft).monospacedDigit()
            }
            HStack(spacing: 6) {
                ForEach(x.cards, id: \.self) { Avatar(id: $0, size: 46) }
                Spacer()
                if back { Button("Claim") { claim(x) }.buttonStyle(GoldButton(height: 40)).frame(width: 110) }
            }
            if !back {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.1))
                        Capsule().fill(LinearGradient(colors: [Color(hex: 0xE0A12A), Color(hex: 0xFFD77A)], startPoint: .leading, endPoint: .trailing))
                            .frame(width: g.size.width * frac)
                    }
                }
                .frame(height: 8)
            }
            XRewardLine(gold: x.gold, xp: x.xp, pack: x.pack != nil)
        }
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(back ? HuntView.gold : Theme.brass.opacity(0.28), lineWidth: 1))
        .shadow(color: back ? Theme.gold.opacity(0.35) : .clear, radius: 12)
    }

    private var freeSlot: some View {
        HStack {
            Text("Free slot").font(.barlow(13)).foregroundColor(Theme.muted)
            Spacer()
            Button("Send a team") { sending = true }.buttonStyle(GoldButton(height: 40)).frame(width: 170)
        }
        .padding(14)
        .goldPanel(16)
    }

    private func claim(_ x: ExpeditionsInfo.Away) {
        busy = true
        Task { @MainActor in
            do {
                let r: XReward = try await API.call("expeditions/claim", token: store.token, body: ["id": x.id])
                store.profile = r.profile
                error = nil
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Sound.rare.play()
                won = r
            } catch {
                self.error = error.localizedDescription
                await store.refresh()
            }
            busy = false
        }
    }
}

// Pick one of today's missions, then up to 3 cards: copies at home (one copy of a team card stays), the same card more than once if you have them.
struct ExpSendView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void
    @State private var mission: Int?
    @State private var step = 1
    @State private var picked: [String] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile, let e = p.expeditions {
                if step == 1 || mission == nil { missions(e) } else { cards(p, e, e.missions[mission!]) }
            }
        }
        .disabled(busy)
    }

    private func missions(_ e: ExpeditionsInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            XHeader(title: "New expedition", back: onClose)
            Text("1 · Pick a mission").sectionTitle()
            ForEach(Array(e.missions.enumerated()), id: \.offset) { i, m in
                if !m.sent { missionRow(m, on: mission == i) { mission = i } }
            }
            Button("Next") { step = 2 }.buttonStyle(GoldButton()).disabled(mission == nil).padding(.top, 6)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.top, 8)
    }

    private func missionRow(_ m: ExpeditionsInfo.Mission, on: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 12) {
                if let icon = Art.classIcon(m.cls) { Image(uiImage: icon).resizable().scaledToFit().frame(width: 30, height: 30) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.name).font(.chakra(16)).foregroundColor(Theme.fg)
                    Text("\(m.hours == 1 ? "1 hour" : "\(m.hours) hours") · \(m.cls)s +5% each").font(.barlow(12)).foregroundColor(Theme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Label(m.gold.formatted(), systemImage: "circle.hexagongrid.fill").foregroundColor(Theme.fg)
                    Text("+\(m.xp)").foregroundColor(Theme.cyan)
                    if m.pack != nil { Text("+ pack").font(.barlow(11)).foregroundColor(HuntView.gold) }
                }
                .font(.chakra(13))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(on ? HuntView.gold : Theme.brass.opacity(0.28), lineWidth: 1))
            .shadow(color: on ? Theme.gold.opacity(0.3) : .clear, radius: 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func cards(_ p: Profile, _ e: ExpeditionsInfo, _ m: ExpeditionsInfo.Mission) -> some View {
        let owned = CardBook.all.filter { p.expFree($0.id) > 0 }
        let list = CardSort.apply(owned, 2)
        let match = picked.filter { CardBook.card($0)?.cls == m.cls }.count
        let matchNote: String = match > 0 ? " · \(match) \(m.cls)" + (match > 1 ? "s" : "") : ""
        let note: String = picked.isEmpty ? "Best: 3 \(m.cls)s" : "\(picked.count) of 3" + matchNote
        let reward: (gold: Int, xp: Int)? = picked.isEmpty ? nil : ExpeditionsInfo.reward(m, picked)
        return VStack(alignment: .leading, spacing: 10) {
            XHeader(title: "\(m.name) · \(m.hours == 1 ? "1 hour" : "\(m.hours) hours")") { step = 1 }
            Text("2 · Pick up to 3 cards").sectionTitle()
            ScrollView(showsIndicators: false) {
                if list.isEmpty {
                    Text("No free cards: your team stays home. Get more from packs.").font(.barlow(14)).foregroundColor(Theme.muted)
                } else {
                    LazyVGrid(columns: xGrid, spacing: 14) {
                        ForEach(list) { c in
                            XPickCell(card: c, count: p.expFree(c.id), picked: picked.filter { $0 == c.id }.count) { toggle(c.id, free: p.expFree(c.id)) }
                        }
                    }
                    .padding(.top, 8).padding(.horizontal, 4)
                }
            }
            summary(note, reward: reward, pack: m.pack != nil)
            if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).frame(maxWidth: .infinity) }
            Button("Send", action: send).buttonStyle(GoldButton()).disabled(picked.isEmpty || busy)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 8)
    }

    // A tap adds a copy (up to your free ones); once that card is maxed a tap takes them all back.
    private func toggle(_ id: String, free: Int) {
        if picked.filter({ $0 == id }).count < free && picked.count < 3 { picked.append(id) } else { picked.removeAll { $0 == id } }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func send() {
        guard let mission else { return }
        busy = true
        Task { @MainActor in
            do {
                let prof: Profile = try await API.call("expeditions/send", token: store.token, body: ["mission": mission, "cards": picked])
                store.profile = prof
                Sound.select.play()
                onClose()
            } catch {
                self.error = error.localizedDescription
                await store.refresh()
            }
            busy = false
        }
    }
}

// The line above a Send / Turn in button: what you've picked and what it pays.
private func summary(_ text: String, reward: (gold: Int, xp: Int)?, pack: Bool = false) -> some View {
    HStack {
        Text(text).font(.barlow(13)).foregroundColor(Theme.muted)
        Spacer(minLength: 8)
        if let reward { XRewardLine(gold: reward.gold, xp: reward.xp, pack: pack) } else { Text("Pick a card").font(.barlow(13)).foregroundColor(Theme.muted) }
    }
    .padding(.horizontal, 14).padding(.vertical, 10)
    .goldPanel(14)
}

// MARK: Collector

struct CollectorView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void
    @State private var picking: Int?
    @State private var won: XReward?

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 12) {
                XHeader(title: "Collector", back: onClose)
                if let p = store.profile, let c = p.collector {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 12) {
                            ForEach(Array(c.requests.enumerated()), id: \.offset) { i, r in row(p, r, i: i) }
                            TimelineView(.periodic(from: .now, by: 30)) { _ in
                                Text("New requests in \(HuntView.left(c.next))").font(.barlow(13)).foregroundColor(Theme.muted).padding(.top, 4)
                            }
                        }
                        .padding(.bottom, 24)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8)
            if let won { XRewardPop(title: "Collector · \(won.name)", r: won) { self.won = nil } }
        }
        .fullScreenCover(item: Binding(get: { picking.map { XIndex(i: $0) } }, set: { picking = $0?.i })) { x in
            ColPickView(i: x.i) { r in picking = nil; if let r { won = r } }
        }
        .task { await store.refresh() }
    }

    private func row(_ p: Profile, _ r: CollectorInfo.Request, i: Int) -> some View {
        let have = CollectorView.spares(p, r).reduce(0) { $0 + $1.n }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(r.name).font(.chakra(17)).foregroundColor(Theme.fg)
                Spacer()
                Text(r.done ? "Done" : "\(have) spare").font(.barlow(13)).foregroundColor(r.done ? QuestsView.green : xSoft)
            }
            HStack {
                XRewardLine(gold: r.gold, xp: r.xp)
                Spacer(minLength: 8)
                if !r.done { Button("Turn in") { picking = i }.buttonStyle(GoldButton(height: 40)).frame(width: 130).disabled(have < r.n) }
            }
        }
        .padding(14)
        .goldPanel(16)
        .opacity(r.done ? 0.55 : 1)
    }

    // Your spare copies that fit a request, best rarity first.
    static func spares(_ p: Profile, _ r: CollectorInfo.Request) -> [XSpare] {
        CardBook.all.filter { $0.rarity == r.rarity && (r.cls == nil || $0.cls == r.cls) }
            .map { XSpare(card: $0, n: p.spare($0.id)) }.filter { $0.n > 0 }
    }
}
struct XSpare: Identifiable { let card: Card; let n: Int; var id: String { card.id } }
private struct XIndex: Identifiable { let i: Int; var id: Int { i } }

// Pick the copies to turn in: a tap adds a copy (up to your spares); once that card is maxed a tap takes them all back.
struct ColPickView: View {
    @EnvironmentObject var store: GameStore
    let i: Int
    let onClose: (XReward?) -> Void
    @State private var picked: [String] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile, let r = p.collector?.requests[i] { content(p, r) }
        }
        .disabled(busy)
    }

    private func content(_ p: Profile, _ r: CollectorInfo.Request) -> some View {
        let list = CollectorView.spares(p, r)
        return VStack(alignment: .leading, spacing: 10) {
            XHeader(title: r.name) { onClose(nil) }
            Text("Pick \(r.n) spare \(r.n > 1 ? "copies" : "copy")").sectionTitle()
            ScrollView(showsIndicators: false) {
                LazyVGrid(columns: xGrid, spacing: 14) {
                    ForEach(list) { x in
                        XPickCell(card: x.card, count: x.n, picked: picked.filter { $0 == x.card.id }.count) { tap(x.card.id, max: x.n, need: r.n) }
                    }
                }
                .padding(.top, 8).padding(.horizontal, 4)
            }
            Text("You keep at least one of each card.").font(.barlow(13)).foregroundColor(Theme.muted)
            summary("\(picked.count) of \(r.n)", reward: (gold: r.gold, xp: r.xp))
            if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).frame(maxWidth: .infinity) }
            Button("Turn in") { turnIn() }.buttonStyle(GoldButton()).disabled(picked.count != r.n || busy)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 8)
    }

    private func tap(_ id: String, max n: Int, need: Int) {
        if picked.filter({ $0 == id }).count < n && picked.count < need { picked.append(id) } else { picked.removeAll { $0 == id } }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func turnIn() {
        busy = true
        Task { @MainActor in
            do {
                let r: XReward = try await API.call("collector/turnin", token: store.token, body: ["request": i, "cards": picked])
                store.profile = r.profile
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Sound.rare.play()
                onClose(r)
            } catch {
                self.error = error.localizedDescription
                await store.refresh()
            }
            busy = false
        }
    }
}
