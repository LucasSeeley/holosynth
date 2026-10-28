import SwiftUI
import UIKit

// Daily quests, full screen: today's three quests with progress and Claim buttons, and the free pack for finishing all three.
// Progress is counted by the server; this screen only shows it.
struct QuestsView: View {
    @EnvironmentObject var store: GameStore
    let onClose: (_ pack: [String]?, _ type: String) -> Void

    @State private var busy = false
    @State private var error: String?
    static let green = Color(hex: 0x3DFF8A)

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Button { onClose(nil, "") } label: {
                        Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.brass)
                            .frame(width: 44, height: 44).goldPanel(12)
                    }
                    .accessibilityLabel("Back")
                    Text("Daily quests").font(.chakra(24)).foregroundColor(Theme.fg)
                }
                if let q = store.profile?.quests {
                    HStack {
                        Text("Today · \(q.finished) of \(q.list.count) done").sectionTitle()
                        Spacer()
                        TimelineView(.periodic(from: .now, by: 30)) { _ in
                            (Text("New quests in ") + Text(HuntView.left(q.next)).font(.chakra(13)).foregroundColor(Theme.fg))
                                .font(.barlow(13)).foregroundColor(Color(hex: 0xA9A5C2))
                        }
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(q.list.enumerated()), id: \.offset) { i, quest in row(quest, i: i, last: i == q.list.count - 1) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 2)
                    .goldPanel(18)
                    bonus(q)
                    Text("Three new quests every day. Progress counts automatically.")
                        .font(.barlow(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity)
                }
                if let error { Text(error).font(.barlow(14, semibold: true)).foregroundColor(Theme.pink).frame(maxWidth: .infinity) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
        }
        .disabled(busy)
        .task { await store.refresh() }   // pick up progress made since the profile was last loaded
    }

    private func row(_ q: Quests.Quest, i: Int, last: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(q.name).font(.chakra(16)).foregroundColor(Theme.fg).lineLimit(1).minimumScaleFactor(0.7)
                    Spacer(minLength: 6)
                    Text("\(q.n)/\(q.goal)").font(.chakra(13)).foregroundColor(Color(hex: 0xA9A5C2)).monospacedDigit()
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.1))
                        Capsule().fill(q.done ? Self.green : Theme.brass).frame(width: g.size.width * CGFloat(q.n) / CGFloat(max(q.goal, 1)))
                    }
                }
                .frame(height: 6)
                Text([q.hint, q.done ? "+\(q.gold.formatted()) gold · +\(q.xp.formatted()) XP" : "+\(q.xp.formatted()) XP"]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.barlow(12)).foregroundColor(Theme.muted)
            }
            Group {
                if q.claimed {
                    Label("Done", systemImage: "checkmark").font(.chakra(12)).tracking(1.4).textCase(.uppercase).foregroundColor(Self.green)
                        .frame(width: 92, height: 38)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Self.green.opacity(0.4), lineWidth: 1))
                } else if q.done {
                    Button("Claim") { claim(i) }.buttonStyle(GoldButton(height: 38)).frame(width: 92)
                } else {
                    Label(q.gold.formatted(), systemImage: "circle.hexagongrid.fill").font(.chakra(15)).foregroundColor(HuntView.gold)
                        .frame(width: 92, alignment: .trailing)
                }
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Theme.brass.opacity(0.1)).frame(height: 1) } }
        .accessibilityElement(children: .combine)
    }

    private func bonus(_ q: Quests) -> some View {
        let ready = q.bonus == "ready", taken = q.bonus == "claimed"
        let claimed = q.list.filter(\.claimed).count
        return HStack(spacing: 14) {
            if let img = Art.pack(q.bonusPack) {
                Image(uiImage: img).resizable().scaledToFit().frame(height: 74)
                    .saturation(ready ? 1 : 0.5).opacity(ready || taken ? 1 : 0.55)
                    .shadow(color: ready ? HuntView.gold.opacity(0.6) : .clear, radius: 10)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(taken ? "Claimed today" : "Finish all 3").font(.chakra(11, semibold: true)).tracking(2).textCase(.uppercase).foregroundColor(Theme.brass)
                Text("Free \(q.bonusPack.capitalized) Pack").font(.chakra(17)).foregroundColor(Theme.fg)
                if ready {
                    Button("Claim") { claim(nil) }.buttonStyle(GoldButton(height: 38))
                } else {
                    HStack(spacing: 5) {
                        ForEach(0..<3, id: \.self) { i in Capsule().fill(i < claimed ? Self.green : Color.white.opacity(0.1)).frame(height: 6) }
                    }
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RadialGradient(colors: [Theme.brass.opacity(0.22), .clear], center: .leading, startRadius: 0, endRadius: 240),
                    in: RoundedRectangle(cornerRadius: 18))
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.brass.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: ready ? [] : [5])))
    }

    // `i` nil = the bonus pack.
    private func claim(_ i: Int?) {
        busy = true
        Task { @MainActor in
            do {
                let quest: Any
                if let i { quest = i } else { quest = "bonus" }
                let r: QuestReply = try await API.call("quests/claim", token: store.token, body: ["quest": quest])
                store.profile = r.profile
                error = nil
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Sound.rare.play()
                if let cards = r.cards { onClose(cards, r.type ?? "omni") }
            } catch {
                self.error = error.localizedDescription
                await store.refresh()
            }
            busy = false
        }
    }
}

