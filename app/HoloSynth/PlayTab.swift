import SwiftUI

// The Play tab dashboard: level and gold, the next campaign fight, battle a friend, open a pack, your team, stats.
struct PlayTab: View {
    @EnvironmentObject var store: GameStore
    @Binding var tab: Int

    enum Screen: Identifiable { case campaign, friend, reward, spin, gauntlet, hunt, quests, ranked; var id: Self { self } }
    @State var screen: Screen?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        header(p)
                        campaignTile(p)
                        daily(p)
                        modes(p)
                        teamPanel(p)
                        stats(p)
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
                }
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .fullScreenCover(item: $screen) { s in
            switch s {
            case .campaign:
                CampaignBattleView { next in
                    switch next {
                    case .none: screen = nil
                    case .chooseCard: screen = .reward
                    case .pack(let cards): screen = nil; store.pendingPack = cards; tab = 1
                    }
                }
            case .friend:
                FriendBattleView { screen = nil }
            case .gauntlet:
                GauntletView { packs in
                    screen = nil
                    if let packs { store.pendingPack = packs; tab = 1 }
                }
            case .ranked:
                RankedView { pack in
                    screen = nil
                    Task { await store.refresh() }
                    if let pack { store.pendingPack = pack; tab = 1 }
                }
            case .quests:
                QuestsView { pack, type in
                    screen = nil
                    if let pack { store.pendingPackType = type; store.pendingPack = pack; tab = 1 }
                }
            case .hunt:
                HuntView { pack in
                    screen = nil
                    if let pack { store.pendingPackType = "overload"; store.pendingPack = pack; tab = 1 }
                }
            case .spin:
                DailySpinView { pack in
                    screen = nil
                    if let pack { store.pendingPack = pack; tab = 1 }
                }
            case .reward:
                CardPicker(eyebrow: "Level 3 cleared", title: "A new card joins you",
                           subtitle: "The other one joins after level 6.",
                           ids: store.profile?.campaign.choose ?? [], cta: "Take") { id in
                    await store.pickReward(id)
                    screen = nil
                }
            }
        }
        .task {
            // A friend match left open (app closed mid-battle) reopens straight away.
            if let m: MatchView = try? await API.call("matches/current", token: store.token), m.status == "active" {
                screen = .friend
            }
        }
    }

    // MARK: pieces

    private func header(_ p: Profile) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().stroke(Theme.brass.opacity(0.15), lineWidth: 5)
                Circle().trim(from: 0, to: CGFloat(p.xpInto) / CGFloat(p.xpNeed))
                    .stroke(Theme.brass, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("LV").font(.chakra(9, semibold: true)).tracking(1.5).foregroundColor(Theme.brass)
                    Text("\(p.level)").font(.chakra(20)).foregroundColor(Theme.fg)
                }
            }
            .frame(width: 60, height: 60)
            .accessibilityElement(children: .combine)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.username).font(.chakra(24)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
                Text("\(p.xpNeed - p.xpInto) XP to level \(p.level + 1)").font(.barlow(13)).foregroundColor(Theme.muted)
            }
            Spacer(minLength: 4)
            HStack(spacing: 6) {
                Image(systemName: "circle.hexagongrid.fill").foregroundColor(Theme.brass)
                Text("\(p.gold)").font(.chakra(17)).monospacedDigit().foregroundColor(Theme.fg)
            }
            .padding(.horizontal, 12).frame(height: 36)
            .goldPanel(18)
        }
    }

    private func campaignTile(_ p: Profile) -> some View {
        let c = p.campaign
        return ZStack(alignment: .bottomLeading) {
            Color(hex: 0x02060F)
                .overlay(alignment: .top) {
                    if let img = Art.image(c.next?.enemies.first ?? "card_bg") {   // chapter done: the shared card background
                        Image(uiImage: img).resizable().aspectRatio(1.3, contentMode: .fill)
                    }
                }
                .clipped()
            LinearGradient(stops: [.init(color: Theme.ink.opacity(0.1), location: 0.3),
                                   .init(color: Theme.ink.opacity(0.92), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            Text("Campaign · Chapter \(c.chapterNum)").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase)
                .foregroundColor(Theme.brass)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Theme.ink.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    if c.choose != nil {
                        Text("Level 3 cleared").font(.chakra(13, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                        Text("A new card is waiting").font(.chakra(22)).foregroundColor(Theme.fg)
                    } else if let next = c.next {
                        Text(next.boss ? "Boss · Level \(next.num)" : "Level \(next.num)").font(.chakra(13, semibold: true))
                            .tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                        Text(next.title).font(.chakra(26)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
                    } else {
                        Text(c.chapter).font(.chakra(13, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                        Text("Chapter complete!").font(.chakra(26)).foregroundColor(Theme.fg)
                        Text("More chapters are on the way.").font(.barlow(13)).foregroundColor(Theme.muted)
                    }
                }
                Spacer(minLength: 0)
                if c.choose != nil {
                    Button("Pick") { screen = .reward }.buttonStyle(GoldButton(height: 46)).frame(width: 110)
                } else if c.next != nil {
                    Button(c.cleared == 0 ? "Start" : "Continue") { screen = .campaign }.buttonStyle(GoldButton(height: 46)).frame(width: 140)
                }
            }
            .padding(14)
        }
        .frame(height: 170)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
        .shadow(color: Theme.brass.opacity(0.15), radius: 12)
    }

    // MARK: daily + modes

    private func daily(_ p: Profile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Daily").sectionTitle()
            HStack(spacing: 10) {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    let ready = SpinClock.ready(p.nextSpin)
                    PlayChip(title: "Spin", sub: ready ? "Ready!" : SpinClock.left(until: p.nextSpin), accent: 0xFF4D5E, alert: ready) {
                        MiniWheel(lit: ready).frame(width: 36, height: 36)
                    } action: { if ready { screen = .spin } }
                }
                if let q = p.quests {
                    PlayChip(title: "Quests", sub: q.bonus == "claimed" ? "All done" : "\(q.finished) of \(q.list.count)", accent: 0x3DFF8A,
                             alert: q.claimable > 0) {
                        Image(systemName: "scroll").font(.system(size: 26, weight: .medium)).foregroundColor(Theme.brass)
                    } action: { screen = .quests }
                }
                PlayChip(title: "Shop", sub: "New cards", accent: 0xB46BFF, alert: false) {
                    if let img = Art.pack("omni") { Image(uiImage: img).resizable().scaledToFit().frame(height: 40) }
                } action: { tab = 1 }
            }
        }
    }

    private func modes(_ p: Profile) -> some View {
        let open = p.team.count >= 3
        return VStack(alignment: .leading, spacing: 8) {
            Text("Modes").sectionTitle()
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                if let r = p.ranked {
                    ModeTile(title: "Ranked", sub: "\(r.name) · #\(r.place) this week", accent: RankedView.color(r.rank), locked: !open, alert: r.alert) {
                        RankEmblem(rank: r.rank, size: 70).padding(.top, 12)
                    } action: { screen = .ranked }
                }
                ModeTile(title: "Gauntlet", sub: "Best streak \(p.gauntlet.best)", accent: Theme.backRed, locked: !p.campaign.friendsUnlocked, alert: false) {
                    Swords().fill(Theme.brass).frame(width: 60, height: 60).padding(.top, 18)
                } action: { screen = .gauntlet }
                if let h = p.hunt {
                    ModeTile(title: "Legend Hunt", sub: huntLine(h), accent: HuntView.gold, locked: !open, alert: false, fill: true) {
                        if let img = Art.image(h.legend) { Image(uiImage: img).resizable().scaledToFill() }
                    } action: { screen = .hunt }
                }
                ModeTile(title: "Friends", sub: "Battle a friend", accent: Color(hex: 0x3FF0FF), locked: !p.campaign.friendsUnlocked, alert: false) {
                    Image(systemName: "bolt.fill").font(.system(size: 48)).foregroundColor(Theme.brass).padding(.top, 22)
                } action: { screen = .friend }
            }
        }
    }

    private func huntLine(_ h: HuntInfo) -> String {
        let name = CardBook.card(h.legend)?.name ?? h.legend
        return h.status == "ready" || h.status == "playing" ? "\(name) · 1 try" : "Back in \(HuntView.left(h.next))"
    }

    private func teamPanel(_ p: Profile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your team").sectionTitle()
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { i in
                    VStack(alignment: .leading, spacing: 5) {
                        if i < p.team.count, let card = CardBook.card(p.team[i]) {
                            Group {
                                if let img = Art.image(card.id) { Image(uiImage: img).resizable().scaledToFill() }
                                else { Theme.panel }
                            }
                            .frame(maxWidth: .infinity).aspectRatio(1.3, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.classColor(card.cls).opacity(0.5), lineWidth: 1))
                            Text(card.name).font(.chakra(13)).foregroundColor(Theme.fg)
                        } else {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Theme.brass.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4]))
                                .aspectRatio(1.3, contentMode: .fit)
                                .overlay(Image(systemName: "lock").foregroundColor(Theme.muted))
                            Text(i == 1 ? "Level 3" : "Level 6").font(.barlow(13)).foregroundColor(Theme.muted)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(14)
        .goldPanel(18)
    }

    private func stats(_ p: Profile) -> some View {
        HStack(spacing: 8) {
            stat("\(p.wins)", "Wins")
            stat("\(p.collection.count)/\(CardBook.all.count)", "Cards")
            stat("\(p.packs)", "Packs opened")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.chakra(20)).foregroundColor(Theme.fg)
            Text(label).font(.barlow(12)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }
}

// A small square on the Play tab's Daily row: icon, name, one line of status, a dot when something's waiting.
struct PlayChip<Icon: View>: View {
    let title: String
    let sub: String
    let accent: UInt32
    let alert: Bool
    @ViewBuilder let icon: () -> Icon
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                icon().frame(height: 40)
                Text(title).font(.chakra(13)).foregroundColor(Theme.fg)
                Text(sub).font(.barlow(11)).foregroundColor(Color(hex: 0xA9A5C2)).lineLimit(1).minimumScaleFactor(0.7).monospacedDigit()
            }
            .frame(maxWidth: .infinity).frame(height: 104)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: accent).opacity(alert ? 0.7 : 0.35), lineWidth: 1))
            .overlay(alignment: .topTrailing) { if alert { Circle().fill(Theme.pink).frame(width: 10, height: 10).padding(9) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(sub)")
    }
}

// A big tile in the Play tab's Modes grid: art on top (or filling it), name and status over a dark fade at the bottom.
struct ModeTile<Art: View>: View {
    let title: String
    let sub: String
    let accent: Color
    let locked: Bool
    let alert: Bool
    var fill = false            // the art fills the whole tile (a card picture)
    @ViewBuilder let art: () -> Art
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                RadialGradient(colors: [accent.opacity(0.3), Theme.field], center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 120)
                Color.clear.overlay(alignment: fill ? .center : .top) { art() }.clipped()
                LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: Theme.ink.opacity(0.92), location: 1)],
                               startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.chakra(17)).foregroundColor(Theme.fg)
                    if locked { Label("Unlocks at level 6", systemImage: "lock.fill").font(.barlow(12)).foregroundColor(Theme.muted) }
                    else { Text(sub).font(.barlow(12)).foregroundColor(Color(hex: 0xA9A5C2)).lineLimit(1).minimumScaleFactor(0.7) }
                }
                .padding(12)
            }
            .frame(height: 128)
            .saturation(locked ? 0 : 1)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(locked ? 0.2 : 0.55), lineWidth: 1))
            .overlay(alignment: .topTrailing) { if alert && !locked { Circle().fill(Theme.pink).frame(width: 12, height: 12).padding(10) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(locked)
        .accessibilityLabel("\(title), \(locked ? "unlocks at level 6" : sub)")
    }
}
