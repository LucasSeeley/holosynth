import SwiftUI

// Your picture, level, stats, how much of the set you own, sound switches and log out.
struct ProfileTab: View {
    @EnvironmentObject var store: GameStore
    @State private var music = AudioPrefs.music
    @State private var effects = AudioPrefs.effects
    @State private var picking = false
    @State private var confirmLogout = false

    var body: some View {
        ZStack {
            ScreenBackground()
            if let p = store.profile {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        header(p)
                        HStack(spacing: 8) {
                            stat("\(p.wins)", "Wins")
                            stat(p.campaign.next.map { "Ch \(p.campaign.chapterNum) · \($0.num)" } ?? "Done", "Campaign")
                            stat("\(p.friends)", "Friends")
                        }
                        collection(p)
                        settings
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
                }
            } else {
                ProgressView().tint(Theme.brass)
            }
        }
        .sheet(isPresented: $picking) { AvatarPicker() }
    }

    private func header(_ p: Profile) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().stroke(Theme.brass.opacity(0.15), lineWidth: 6)
                Circle().trim(from: 0, to: CGFloat(p.xp % 100) / 100)
                    .stroke(Theme.brass, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90))
                Avatar(id: p.avatar, size: 94)
                Text("LV \(p.level)").font(.chakra(13)).foregroundColor(Theme.brass)
                    .padding(.horizontal, 10).padding(.vertical, 2)
                    .background(Theme.ink, in: Capsule()).overlay(Capsule().stroke(Theme.brass, lineWidth: 1))
                    .offset(y: 56)
                Button { picking = true } label: {
                    Image(systemName: "pencil").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.brass)
                        .frame(width: 30, height: 30).background(Theme.panel, in: Circle())
                        .overlay(Circle().stroke(Theme.brass.opacity(0.5), lineWidth: 1))
                }
                .accessibilityLabel("Change picture")
                .offset(x: 40, y: -40)
            }
            .frame(width: 108, height: 108)
            .shadow(color: Theme.brass.opacity(0.2), radius: 15)
            Text(p.username).font(.chakra(26)).foregroundColor(Theme.fg).padding(.top, 12)
            Text("\(100 - p.xp % 100) XP to level \(p.level + 1) · Playing since \(since(p.since))")
                .font(.barlow(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
        }
        .padding(.top, 4)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.chakra(20)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.barlow(12)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12).padding(.horizontal, 6)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    private func collection(_ p: Profile) -> some View {
        VStack(spacing: 10) {
            HStack {
                Text("Collection").font(.chakra(12, semibold: true)).tracking(2.5).textCase(.uppercase).foregroundColor(Theme.brass)
                Spacer()
                Text("\(p.collection.count)/\(CardBook.all.count)").font(.chakra(13)).foregroundColor(Theme.fg)
            }
            ForEach(["Common", "Rare", "Epic", "Legendary"], id: \.self) { r in
                let all = CardBook.all.filter { $0.rarity == r }
                let have = all.filter { p.collection[$0.id] != nil }.count
                HStack(spacing: 10) {
                    Text(r).font(.barlow(14)).foregroundColor(Theme.fg).frame(width: 84, alignment: .leading)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.fg.opacity(0.08))
                            Capsule().fill(Theme.rarityColor(r))
                                .frame(width: max(4, g.size.width * CGFloat(have) / CGFloat(max(all.count, 1))))
                        }
                    }
                    .frame(height: 8)
                    Text("\(have)/\(all.count)").font(.chakra(13)).foregroundColor(Theme.muted).frame(width: 50, alignment: .trailing)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(r): \(have) of \(all.count)")
            }
        }
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
    }

    private var settings: some View {
        VStack(spacing: 0) {
            Toggle("Music", isOn: $music)
                .onChange(of: music) { Music.setEnabled($0) }
            Divider().overlay(Theme.brass.opacity(0.1)).padding(.vertical, 10)
            Toggle("Sound effects", isOn: $effects)
                .onChange(of: effects) { UserDefaults.standard.set($0, forKey: "effects") }
            Divider().overlay(Theme.brass.opacity(0.1)).padding(.vertical, 10)
            Button("Log out") { confirmLogout = true }
                .font(.barlow(15, semibold: true)).foregroundColor(Theme.pink)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
        }
        .font(.barlow(15)).foregroundColor(Theme.fg).tint(Theme.brass)
        .padding(14)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.2), lineWidth: 1))
        .confirmationDialog("Log out of HoloSynth?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Log out", role: .destructive) { Music.stop(); store.logout() }
        }
    }

    private func since(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.month(.abbreviated).year())
    }
}

// Pick any card you own as your picture.
struct AvatarPicker: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Choose your picture").font(.chakra(22)).foregroundColor(Theme.fg)
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(CardBook.all.filter { store.profile?.collection[$0.id] != nil }) { card in
                            Button {
                                Task { await store.setAvatar(card.id); dismiss() }
                            } label: {
                                VStack(spacing: 5) {
                                    Avatar(id: card.id, size: 66)
                                        .overlay(Circle().stroke(Theme.brass, lineWidth: store.profile?.avatar == card.id ? 3 : 0).padding(-4))
                                    Text(card.name).font(.chakra(12)).foregroundColor(Theme.fg).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(20)
            }
        }
        .presentationDetents([.medium, .large])
    }
}
