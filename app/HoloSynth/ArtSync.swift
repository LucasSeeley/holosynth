import SwiftUI

// Card art lives on the server (art/<id>.webp, listed with a hash in art/manifest.json) so the app stays small.
// On launch this fetches whatever is new or changed; after the first time it's usually nothing.
@MainActor
final class ArtSync: ObservableObject {
    static let shared = ArtSync()
    @Published var ready = false
    @Published var done = 0
    @Published var total = 0
    @Published var failed = false

    private let savedKey = "artHashes"   // id -> hash of the copy on the phone

    func run() async {
        failed = false
        guard let (data, _) = try? await URLSession.shared.data(from: API.base.appendingPathComponent("art/manifest.json")),
              let manifest = try? JSONDecoder().decode([String: String].self, from: data) else {
            // offline: fine if we already have every card's art from before
            let have = Set((UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]).keys)
            if CardBook.all.allSatisfy({ have.contains($0.id) }) { ready = true } else { failed = true }
            return
        }
        var have = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
        let todo = manifest.filter { id, hash in
            have[id] != hash || !FileManager.default.fileExists(atPath: Art.folder.appendingPathComponent(id + ".webp").path)
        }
        total = todo.count
        done = 0
        // a few at a time so the first download is quick without flooding the connection
        let items = Array(todo)
        for start in stride(from: 0, to: items.count, by: 6) {
            let batch = items[start..<min(start + 6, items.count)]
            let got = await withTaskGroup(of: (String, String, Data?).self) { group in
                for (id, hash) in batch {
                    group.addTask {
                        var url = URLComponents(url: API.base.appendingPathComponent("art/\(id).webp"), resolvingAgainstBaseURL: false)!
                        url.queryItems = [URLQueryItem(name: "v", value: hash)]
                        let data = try? await URLSession.shared.data(from: url.url!).0
                        return (id, hash, data)
                    }
                }
                var out: [(String, String, Data?)] = []
                for await r in group { out.append(r) }
                return out
            }
            for (id, hash, data) in got {
                guard let data, UIImage(data: data) != nil else { continue }
                try? data.write(to: Art.folder.appendingPathComponent(id + ".webp"), options: .atomic)
                Art.forget(id)
                have[id] = hash
                done += 1
            }
            UserDefaults.standard.set(have, forKey: savedKey)
        }
        if done < total { failed = true } else { ready = true }
    }
}

// Shown on launch while card art downloads (only takes a moment after the first time).
struct ArtLoadingView: View {
    @ObservedObject var sync = ArtSync.shared

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 18) {
                if let logo = Art.image("logo") {
                    Image(uiImage: logo).resizable().scaledToFit().frame(maxWidth: 300)
                }
                if sync.failed {
                    Text("Couldn't download the cards. Check your connection.")
                        .font(.barlow(15, semibold: true)).foregroundColor(Theme.pink).multilineTextAlignment(.center)
                    Button("Try again") { Task { await sync.run() } }.buttonStyle(GoldButton(height: 50)).frame(width: 200)
                } else if sync.total > 0 {
                    Text("Downloading cards").font(.chakra(13, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
                    ProgressView(value: Double(sync.done), total: Double(max(sync.total, 1))).tint(Theme.brass).frame(width: 220)
                    Text("\(sync.done) of \(sync.total)").font(.barlow(13)).foregroundColor(Theme.muted).monospacedDigit()
                } else {
                    ProgressView().tint(Theme.brass)
                }
            }
            .padding(24)
        }
    }
}
