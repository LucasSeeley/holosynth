import SwiftUI

// The Play tab dashboard: level and gold, the next campaign fight, battle a friend, open a pack, your team, stats.
struct PlayTab: View {
    @EnvironmentObject var store: GameStore
    @Binding var tab: Int

    enum Screen: Identifiable { case campaign, friend, reward, spin, gauntlet; var id: Self { self } }
    @State var screen: Screen?

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        header(p)
                        campaignTile(p)
                        SpinTile(nextSpin: p.nextSpin) { screen = .spin }
                        GauntletTile(stats: p.gauntlet, unlocked: p.campaign.friendsUnlocked) { screen = .gauntlet }
                        HStack(spacing: 12) { friendTile(p); packTile }
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
                        Image(uiImage: img).resizable().aspectRatio(1.3, contentMode: .fill).padding(.top, 22)
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
        .frame(height: 210)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.45), lineWidth: 1))
        .shadow(color: Theme.brass.opacity(0.15), radius: 12)
    }

    private func friendTile(_ p: Profile) -> some View {
        let open = p.campaign.friendsUnlocked
        return Button { screen = .friend } label: {
            VStack(alignment: .leading) {
                Image(systemName: "bolt.fill").font(.system(size: 24)).foregroundColor(open ? Theme.brass : Theme.muted)
                Spacer()
                Text("Battle a friend").font(.chakra(16)).foregroundColor(Theme.fg)
                HStack(spacing: 5) {
                    if !open { Image(systemName: "lock.fill").font(.system(size: 10)) }
                    Text(open ? "Create or join a match" : "Unlocks at level 6")
                }
                .font(.barlow(13)).foregroundColor(open ? Theme.brass : Theme.muted)
            }
            .padding(14).frame(maxWidth: .infinity, minHeight: 120, maxHeight: 120, alignment: .leading)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(open ? 0.5 : 0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!open)
    }

    private var packTile: some View {
        Button { tab = 1 } label: {
            ZStack(alignment: .bottomLeading) {
                // all three packs fanned out: Cyber and Magic behind, Omni in front
                ZStack {
                    fanned("cyber", angle: -16, x: -30, height: 88)
                    fanned("magic", angle: 16, x: 28, height: 88)
                    fanned("omni", angle: 0, x: 0, height: 96)
                }
                .frame(width: 120, height: 120)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Open a pack").font(.chakra(16)).foregroundColor(Theme.fg)
                    Text("1,000 gold").font(.barlow(13)).foregroundColor(Theme.brass)
                }
                .padding(14)
            }
            .frame(maxWidth: .infinity, minHeight: 120, maxHeight: 120)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.28), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func fanned(_ type: String, angle: Double, x: CGFloat, height: CGFloat) -> some View {
        if let img = Art.pack(type) {
            Image(uiImage: img).resizable().scaledToFit().frame(height: height)
                .shadow(color: .black.opacity(0.6), radius: 6, y: 5)
                .rotationEffect(.degrees(angle)).offset(x: x, y: -6)
        }
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
