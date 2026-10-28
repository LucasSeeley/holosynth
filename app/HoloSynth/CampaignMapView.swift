import SwiftUI

// The campaign map: each chapter is a winding path of its 30 levels, bottom to top. Cleared levels are gold,
// your next level glows (the only one you can tap), later levels are dim. The arrows by the title step between
// chapters you've reached; locked chapters aren't sent by the server, so there's no arrow to them.
struct CampaignMap: Decodable, Equatable {
    struct Level: Decodable, Equatable { let num: Int; let title: String; let enemies: [String]; let lv: Int; let boss: Bool; let pack: String? }
    struct Chapter: Decodable, Equatable { let num: Int; let title: String; let gold: Int; let xp: Int; let levels: [Level] }
    let cleared: Int
    let chapters: [Chapter]
}

struct CampaignMapView: View {
    @EnvironmentObject var store: GameStore
    let onClose: () -> Void
    let onBattle: () -> Void

    @State private var map: CampaignMap?
    @State private var ch = 0                // chapter on screen (0-based)
    @State private var error: String?
    @State private var pulse = false

    private static let violet = Color(hex: 0xB98CFF)
    private let gap: CGFloat = 84            // between levels
    private let topPad: CGFloat = 70
    private let bottomPad: CGFloat = 420     // room under level 1 for the panel

    var body: some View {
        ZStack {
            Theme.ink.ignoresSafeArea()
            RadialGradient(colors: [Self.violet.opacity(0.22), .clear], center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: 380).ignoresSafeArea()
            if let map, map.chapters.indices.contains(ch) {
                let chapter = map.chapters[ch]
                VStack(spacing: 0) {
                    header(map, chapter)
                    ZStack(alignment: .bottom) {
                        path(map, chapter)
                        if let cur = current(map), cur.chapter == ch { levelPanel(chapter, chapter.levels[cur.index]) }
                        else if (ch + 1) * 30 <= map.cleared { donePanel(chapter) }
                    }
                }
            } else if let error {
                VStack(spacing: 16) {
                    Text(error).font(.barlow(15, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center)
                    Button("Back") { onClose() }.buttonStyle(OutlineButton())
                }
                .padding(24)
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .task {
            do {
                let m: CampaignMap = try await API.call("campaign/map", token: store.token)
                ch = current(m)?.chapter ?? max(0, m.chapters.count - 1)
                map = m
            } catch { self.error = error.localizedDescription }
        }
        .onAppear { withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulse = true } }
    }

    // Your next level: its chapter and index in that chapter (nil once every open level is cleared).
    private func current(_ m: CampaignMap) -> (chapter: Int, index: Int)? {
        let c = m.cleared / 30, i = m.cleared % 30
        return m.chapters.indices.contains(c) && m.chapters[c].levels.indices.contains(i) ? (c, i) : nil
    }

    // MARK: header

    private func header(_ m: CampaignMap, _ c: CampaignMap.Chapter) -> some View {
        let done = min(30, max(0, m.cleared - ch * 30))
        return VStack(spacing: 12) {
            HStack(spacing: 10) {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .bold)).foregroundColor(Theme.brass)
                        .frame(width: 44, height: 44)
                        .background(Theme.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.brass.opacity(0.35), lineWidth: 1))
                }
                .accessibilityLabel("Back to Play")
                arrow(-1, show: ch > 0)
                VStack(spacing: 2) {
                    Text("Chapter \(c.num)").font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Self.violet)
                    Text(c.title).font(.chakra(21)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                arrow(1, show: ch < m.chapters.count - 1)
                Color.clear.frame(width: 44, height: 44)
            }
            HStack(spacing: 10) {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.fg.opacity(0.12))
                        Capsule().fill(LinearGradient(colors: [Color(hex: 0xE0A12A), Color(hex: 0xFFD77A)], startPoint: .leading, endPoint: .trailing))
                            .frame(width: g.size.width * CGFloat(done) / 30)
                    }
                }
                .frame(height: 5)
                (Text("\(done)").foregroundColor(Theme.fg) + Text(" / 30").foregroundColor(Theme.muted)).font(.chakra(13))
            }
            .padding(.horizontal, 6)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
    }

    @ViewBuilder private func arrow(_ d: Int, show: Bool) -> some View {
        if show {
            Button { withAnimation(.easeInOut(duration: 0.25)) { ch += d } } label: {
                Image(systemName: d < 0 ? "chevron.left" : "chevron.right").font(.system(size: 16, weight: .bold)).foregroundColor(Self.violet)
                    .frame(width: 44, height: 44)
                    .background(Theme.field, in: Circle())
                    .overlay(Circle().stroke(Self.violet.opacity(0.45), lineWidth: 1))
            }
            .accessibilityLabel("Chapter \(ch + 1 + d)")
        } else {
            Color.clear.frame(width: 44, height: 44)
        }
    }

    // MARK: the path

    private func point(_ n: Int, width: CGFloat) -> CGPoint {   // level n (1...30), level 30 at the top
        CGPoint(x: width / 2 + width * 0.29 * sin(Double(n - 1) * 0.95), y: topPad + CGFloat(30 - n) * gap)
    }

    private func curve(_ pts: [CGPoint]) -> Path {
        Path { p in
            guard let first = pts.first else { return }
            p.move(to: first)
            for (a, b) in zip(pts, pts.dropFirst()) {
                let my = (a.y + b.y) / 2
                p.addCurve(to: b, control1: CGPoint(x: a.x, y: my), control2: CGPoint(x: b.x, y: my))
            }
        }
    }

    private func path(_ m: CampaignMap, _ c: CampaignMap.Chapter) -> some View {
        let done = m.cleared - ch * 30     // levels of this chapter cleared (can be <0 or >30)
        return GeometryReader { geo in
            let w = geo.size.width
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    ZStack(alignment: .topLeading) {
                        // scroll targets: one plain row per level (positioned nodes can't be scrolled to reliably)
                        VStack(spacing: 0) {
                            ForEach((1...30).reversed(), id: \.self) { n in Color.clear.frame(height: gap).id(n) }
                        }
                        .padding(.top, topPad - gap / 2)
                        let pts = (1...30).map { point($0, width: w) }
                        let split = min(29, max(0, done))   // index of the last node the gold line reaches
                        curve(Array(pts[split...])).stroke(Theme.muted.opacity(0.4), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [2, 10]))
                        if split > 0 {
                            curve(Array(pts[...split])).stroke(Color(hex: 0xFFD77A).opacity(0.12), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                            curve(Array(pts[...split])).stroke(Theme.brass.opacity(0.85), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        }
                        ForEach(c.levels, id: \.num) { l in
                            node(l, state: l.num - 1 < done ? .done : l.num - 1 == done ? .next : .locked)
                                .position(pts[l.num - 1])
                        }
                    }
                    .frame(width: w, height: topPad + 29 * gap + bottomPad)
                }
                .onAppear { scroll(proxy, done) }
                .onChange(of: ch) { _ in scroll(proxy, m.cleared - ch * 30) }
            }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, _ done: Int) {
        let target = min(30, max(1, done + 1))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { proxy.scrollTo(target, anchor: UnitPoint(x: 0.5, y: 0.35)) }   // after the first layout
    }

    // MARK: nodes

    private enum NodeState { case done, next, locked }

    @ViewBuilder private func node(_ l: CampaignMap.Level, state: NodeState) -> some View {
        if l.boss { bossNode(l, state: state) }
        else if state == .next {
            Button { UISelectionFeedbackGenerator().selectionChanged() } label: {
                ZStack {
                    Circle().stroke(Theme.cyan, lineWidth: 2).frame(width: 66, height: 66)
                        .scaleEffect(pulse ? 1.55 : 1).opacity(pulse ? 0 : 0.8)
                    art(l.enemies.first, size: 66, shape: Circle())
                        .overlay(Circle().stroke(Theme.cyan, lineWidth: 3))
                        .shadow(color: Theme.cyan.opacity(0.55), radius: 12)
                }
                .overlay(alignment: .bottom) { tag("Lv \(l.num) · Next", fg: Color(hex: 0x04161A), bg: Theme.cyan).offset(y: 22) }
            }
            .accessibilityLabel("Level \(l.num), next: \(l.title)")
        } else {
            Text("\(l.num)").font(.chakra(15)).foregroundColor(state == .done ? Theme.brass : Color(hex: 0x6E6A88))
                .frame(width: 44, height: 44)
                .background(Circle().fill(state == .done ? AnyShapeStyle(RadialGradient(colors: [Color(hex: 0x3A2A10), Color(hex: 0x14100A)], center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 26)) : AnyShapeStyle(Theme.field)))
                .overlay(Circle().stroke(state == .done ? Theme.brass : Theme.muted.opacity(0.25), lineWidth: 2))
                .shadow(color: state == .done ? Theme.brass.opacity(0.3) : .clear, radius: 6)
                .accessibilityLabel("Level \(l.num), \(state == .done ? "cleared" : "locked")")
        }
    }

    @ViewBuilder private func bossNode(_ l: CampaignMap.Level, state: NodeState) -> some View {
        let tile = art(l.enemies.first, size: 74, shape: RoundedRectangle(cornerRadius: 18))
            .saturation(state == .locked ? 0.35 : 1).brightness(state == .locked ? -0.15 : 0)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(state == .next ? Theme.cyan : Theme.brass.opacity(state == .done ? 1 : 0.55), lineWidth: 2.5))
            .shadow(color: (state == .next ? Theme.cyan : Theme.brass).opacity(0.35), radius: 10)
            .overlay(alignment: .top) { tag("Boss", fg: Color(hex: 0x1A0D05), bg: Theme.brass, crown: true).offset(y: -10) }
            .overlay(alignment: .bottomTrailing) {
                if state == .done {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .black)).foregroundColor(Color(hex: 0x1A0D05))
                        .frame(width: 22, height: 22).background(Theme.brass, in: Circle()).overlay(Circle().stroke(Theme.ink, lineWidth: 2))
                        .offset(x: 4, y: 4)
                } else if let pack = l.pack, let img = Art.pack(pack) {
                    Image(uiImage: img).resizable().scaledToFit().frame(height: 40).rotationEffect(.degrees(10))
                        .shadow(color: .black.opacity(0.6), radius: 4, y: 3).offset(x: 24, y: 6)
                }
            }
            .overlay(alignment: .bottom) {
                if state == .next { tag("Lv \(l.num) · Next", fg: Color(hex: 0x04161A), bg: Theme.cyan).offset(y: 24) }
                else { Text("LV \(l.num)").font(.chakra(11, semibold: true)).foregroundColor(state == .done ? Theme.brass : Theme.fg).offset(y: 20) }
            }
        if state == .next {
            Button { UISelectionFeedbackGenerator().selectionChanged() } label: { tile }
                .accessibilityLabel("Level \(l.num), boss, next: \(l.title)")
        } else {
            tile.accessibilityElement().accessibilityLabel("Level \(l.num), boss, \(state == .done ? "cleared" : "locked")")
        }
    }

    private func art<S: Shape>(_ id: String?, size: CGFloat, shape: S) -> some View {
        Group {
            if let id, let img = Art.image(id) { Image(uiImage: img).resizable().scaledToFill() } else { Theme.panel }
        }
        .frame(width: size, height: size).clipShape(shape)
        .background(shape.fill(Color(hex: 0x12101E)))
    }

    private func tag(_ text: String, fg: Color, bg: Color, crown: Bool = false) -> some View {
        HStack(spacing: 3) {
            if crown { Image(systemName: "crown.fill").font(.system(size: 9, weight: .bold)) }
            Text(text).font(.chakra(10)).tracking(1.2).textCase(.uppercase)
        }
        .foregroundColor(fg).padding(.horizontal, 8).frame(height: 20).background(bg, in: Capsule()).fixedSize()
    }

    // MARK: panels

    private func levelPanel(_ c: CampaignMap.Chapter, _ l: CampaignMap.Level) -> some View {
        VStack(spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.boss ? "Level \(l.num) · Boss" : "Level \(l.num) · Next").font(.chakra(11, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Self.violet)
                    Text(l.title).font(.chakra(21)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                }
                Spacer(minLength: 8)
                if l.lv > 0 {
                    Text("✦ Enemies fused ×\(l.lv)").font(.chakra(11, semibold: true)).foregroundColor(Theme.brass)
                        .padding(.horizontal, 8).frame(height: 22)
                        .background(Theme.brass.opacity(0.14), in: Capsule()).overlay(Capsule().stroke(Theme.brass.opacity(0.45), lineWidth: 1))
                }
            }
            HStack(spacing: 0) {
                ForEach(Array(l.enemies.enumerated()), id: \.offset) { _, id in
                    let card = CardBook.card(id)
                    VStack(spacing: 5) {
                        art(id, size: 56, shape: Circle()).overlay(Circle().stroke(Theme.classColor(card?.cls ?? ""), lineWidth: 2))
                        Text(card?.name ?? id).font(.barlow(12, semibold: true)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 18) {
                Text("+\(c.gold) gold").foregroundColor(Color(hex: 0xFFD77A))
                Text("+\(c.xp) XP").foregroundColor(Color(hex: 0x3DFF8A))
                if let pack = l.pack {
                    HStack(spacing: 6) {
                        if let img = Art.pack(pack) { Image(uiImage: img).resizable().scaledToFit().frame(height: 28) }
                        Text("\(pack.capitalized) Pack").foregroundColor(Theme.fg)
                    }
                }
            }
            .font(.chakra(14))
            Button("Battle", action: onBattle).buttonStyle(GoldButton(height: 54))
        }
        .padding(16)
        .background(Color(hex: 0x0E0C18).opacity(0.96), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Self.violet.opacity(0.35), lineWidth: 1))
        .shadow(color: .black.opacity(0.6), radius: 20, y: -6)
        .padding(.horizontal, 10).padding(.bottom, 8)
    }

    private func donePanel(_ c: CampaignMap.Chapter) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark").font(.system(size: 18, weight: .black)).foregroundColor(Color(hex: 0x1A0D05))
                .frame(width: 40, height: 40).background(Theme.brass, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Chapter \(c.num) complete").font(.chakra(16)).foregroundColor(Theme.fg)
                Text(ch == (map?.chapters.count ?? 0) - 1 ? "More chapters are on the way." : "All 30 levels cleared").font(.barlow(13)).foregroundColor(Theme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Color(hex: 0x0E0C18).opacity(0.96), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
        .padding(.horizontal, 10).padding(.bottom, 8)
    }
}
