import SwiftUI
import UIKit

// MARK: - Card data (bundled cards.json, same file the server uses)

struct Card: Decodable, Identifiable, Hashable {
    struct Attack: Decodable, Hashable { let name: String; let dmg: Int }
    struct Special: Decodable, Hashable { let name: String; let dmg: Int; let cd: Int }
    let id: String
    let num: Int
    let name: String
    let rarity: String
    let cls: String
    let hp: Int
    let basic: Attack
    let special: Special
    let look: String
    let color: String   // character's neon colour, "#rrggbb"; tints the card face
    let quip: String    // one-line joke printed small at the bottom of the card
}

enum CardBook {
    static let all: [Card] = {
        guard let url = Bundle.main.url(forResource: "cards", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cards = try? JSONDecoder().decode([Card].self, from: data) else { return [] }
        return cards.sorted { $0.num < $1.num }
    }()
    static let byId: [String: Card] = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    static func card(_ id: String) -> Card? { byId[id] }
}

// MARK: - Server replies

struct Profile: Decodable, Equatable {
    let username: String
    let gold: Int
    let xp: Int
    let level: Int
    let team: [String]
    let collection: [String: Int]
    let needsStarter: Bool
    let wins: Int
    let packs: Int
    let campaign: Campaign
}

struct Campaign: Decodable, Equatable {
    struct Level: Decodable, Equatable { let num: Int; let title: String; let enemies: [String]; let boss: Bool }
    let chapter: String
    let chapterNum: Int
    let cleared: Int
    let total: Int
    let next: Level?             // nil once every chapter is beaten
    let choose: [String]?        // starters on offer after level 3, until you pick one
    let friendsUnlocked: Bool
}

// A campaign battle against the computer; `result` and `profile` come back once it ends.
struct CampaignRun: Decodable, Equatable {
    struct Result: Decodable, Equatable {
        let won: Bool
        let gold: Int?
        let xp: Int?
        let chooseCard: Bool?
        let newCard: String?
        let pack: [String]?
    }
    let level: Int
    let title: String
    let boss: Bool
    let state: BattleState
    let result: Result?
    let profile: Profile?
}

struct AuthReply: Decodable { let token: String; let profile: Profile }
struct PackReply: Decodable { let cards: [String]; let profile: Profile }

struct Unit: Decodable, Equatable { let id: String; var hp: Int; var cd: Int }

struct LogEntry: Decodable, Equatable {
    let p: Int, from: Int, to: Int
    let move: String
    let dmg: Int
    let adv: Bool
    let ko: Bool
}

struct BattleState: Decodable, Equatable {
    var teams: [[Unit]]
    var acted: [[Bool]]
    var turn: Int
    var winner: Int?
    var log: [LogEntry]
    var moves: Int?             // moves made so far (older matches don't have it)
}

struct MatchView: Decodable, Equatable {
    let id: Int
    let code: String
    let status: String          // waiting | active | done
    let you: Int
    let players: [String?]
    let state: BattleState?
}

// MARK: - Look

enum Theme {
    static let bg = Color(hex: 0x0A0912)
    static let panel = Color(hex: 0x12111D)
    static let line = Color(hex: 0x262338)
    static let fg = Color(hex: 0xEBE9F7)
    static let muted = Color(hex: 0x8E8AA8)
    static let cyan = Color(hex: 0x3FF0FF)
    static let pink = Color(hex: 0xFF3FA4)
    static let orange = Color(hex: 0xFF8A3D)
    static let gold = Color(hex: 0xFFC53D)
    static let backRed = Color(hex: 0x9E1024)

    static func classColor(_ cls: String) -> Color {
        switch cls { case "Fighter": return cyan; case "Beast": return pink; default: return orange }
    }
    static func rarityColor(_ rarity: String) -> Color {
        switch rarity {
        case "Rare": return Color(hex: 0x4AA8FF)
        case "Epic": return Color(hex: 0xB46BFF)
        case "Legendary": return gold
        default: return Color(hex: 0x9A97AD)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

// Bundled pictures live in the "Art" folder: card art, class symbols, pack, card back.
enum Art {
    private static let cache = NSCache<NSString, UIImage>()
    static func image(_ name: String) -> UIImage? {
        if let hit = cache.object(forKey: name as NSString) { return hit }
        for ext in ["webp", "png"] {
            if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: "Art"),
               let img = UIImage(contentsOfFile: path) {
                cache.setObject(img, forKey: name as NSString)
                return img
            }
        }
        return nil
    }
    static func classIcon(_ cls: String) -> UIImage? { image("class_" + cls.lowercased()) }
}
