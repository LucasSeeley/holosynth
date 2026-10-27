import SwiftUI
import UIKit

// MARK: - Card data (bundled cards.json, same file the server uses)

struct Card: Decodable, Identifiable, Hashable {
    struct Attack: Decodable, Hashable { let name: String; let dmg: Int }
    struct Special: Decodable, Hashable {
        let name: String; let dmg: Int; let cd: Int
        let heal: Bool?          // Mystics: heals a teammate by `dmg` instead of hitting an enemy
        var heals: Bool { heal == true }
    }
    let id: String
    let num: Int
    let name: String
    let rarity: String
    let cls: String
    let hp: Int
    let basic: Attack
    let special: Special
    let special2: Special?      // Epic & Legendary: a stronger second special, unlocked by fusion
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

extension Profile {
    // The copy your battles use: your most-fused copy of that card.
    func fusion(_ id: String) -> Fusion? { fused?.filter { $0.card == id }.max { $0.fusion.total < $1.fusion.total }?.fusion }
    var xpInto: Int { levelXp ?? xp % 100 }
    var xpNeed: Int { max(levelNeed ?? 100, 1) }
}

struct Profile: Decodable, Equatable {
    let username: String
    let gold: Int
    let xp: Int
    let levelXp: Int?           // XP into the current level
    let levelNeed: Int?         // XP the current level takes (doubles every level)
    let level: Int
    let team: [String]
    let collection: [String: Int]
    let needsStarter: Bool
    let wins: Int
    let packs: Int
    let avatar: String          // card shown as your picture
    let since: Double           // account created, ms since 1970
    let friends: Int
    let nextSpin: Double        // when the daily spin is ready again, ms since 1970; 0 = ready now
    let spinPack: String?       // which pack the wheel's pack slot gives today
    let packsOpen: [String]?    // packs on sale (server decides); the rest say "Coming soon"
    let shop: Shop?             // today's shop cards
    let hunt: HuntInfo?         // today's Legend Hunt
    let quests: Quests?         // today's daily quests
    let fused: [FusedCopy]?     // fused copies you own
    let gauntlet: GauntletStats
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
        let packType: String?
    }
    let level: Int
    let title: String
    let boss: Bool
    let state: BattleState
    let result: Result?
    let profile: Profile?
}

struct AuthReply: Decodable { let token: String; let profile: Profile }

// The Social tab: friends, requests waiting for your answer, and battles friends sent you.
struct Social: Decodable, Equatable {
    struct Person: Decodable, Equatable, Identifiable {
        let name: String
        let level: Int
        let avatar: String
        let online: Bool
        let seen: Double?       // ms since 1970, nil if never
        var id: String { name }
    }
    struct Challenge: Decodable, Equatable, Identifiable {
        let id: Int             // the match
        let code: String
        let name: String
        let avatar: String
    }
    let friends: [Person]
    let requests: [Person]
    let challenges: [Challenge]
    let trades: [Trade]?
}

// An open trade, always seen from my side: `give` is what I hand over, `get` what I receive. `mine` = I sent it.
struct Trade: Decodable, Equatable, Identifiable {
    let id: Int
    let mine: Bool
    let status: String?         // open | accepted (mine, waiting for me to claim)
    let name: String            // the other player
    let avatar: String
    let give: [String]          // card ids; a repeat is another copy
    let get: [String]
    let giveGold: Int
    let getGold: Int
    let fusions: [String: FusedCopy]?   // fused copies in this trade, by copy id
}
// Trade items are card ids, or "card#12" for fused copy 12 (it keeps its fusion).
enum TradeItem {
    static func card(_ token: String) -> Card? { CardBook.card(String(token.split(separator: "#").first ?? "")) }
    static func fusedId(_ token: String) -> String? { token.contains("#") ? String(token.split(separator: "#").last ?? "") : nil }
    static func token(_ copy: FusedCopy) -> String { "\(copy.card)#\(copy.id)" }
}
// Plain spare copies each side can trade, plus their fused copies.
struct TradeCards: Decodable {
    let mine: [String: Int]; let theirs: [String: Int]; let gold: Int
    let mineFused: [FusedCopy]?; let theirsFused: [FusedCopy]?
}
struct TradeDone: Decodable { let received: [String]; let gold: Int; let from: String; let social: Social; let profile: Profile }

// Collection order, shared by the Cards tab and the trade picker: 0 Synth #, 1 HP (highest first), 2 Rarity (best first).
enum CardSort {
    static let names = ["Synth #", "HP", "Rarity", "Dups"]
    private static let rank = ["Legendary": 0, "Epic": 1, "Rare": 2, "Common": 3]
    // `cards` must already be in number order so ties keep it. `counts` (copies per card) is only used by Dups.
    static func apply(_ cards: [Card], _ mode: Int, counts: [String: Int] = [:]) -> [Card] {
        switch mode % names.count {
        case 3: return cards.enumerated().sorted { (counts[$1.element.id] ?? 0, $0.offset) < (counts[$0.element.id] ?? 0, $1.offset) }.map(\.element)
        case 1: return cards.enumerated().sorted { ($1.element.hp, $0.offset) < ($0.element.hp, $1.offset) }.map(\.element)
        case 2: return cards.enumerated().sorted { (rank[$0.element.rarity] ?? 9, $0.offset) < (rank[$1.element.rarity] ?? 9, $1.offset) }.map(\.element)
        default: return cards
        }
    }
}
// MARK: Daily quests

// Three a day (new at `next`, ms since 1970). bonus: locked | ready | claimed (the free pack for finishing all three).
struct Quests: Decodable, Equatable {
    struct Quest: Decodable, Equatable, Identifiable {
        let id: String; let name: String; let hint: String?
        let n: Int; let goal: Int; let gold: Int; let xp: Int; let claimed: Bool
        var done: Bool { n >= goal }
    }
    let list: [Quest]
    let bonus: String
    let bonusPack: String
    let next: Double
    var finished: Int { list.filter(\.done).count }
    var claimable: Int { list.filter { $0.done && !$0.claimed }.count + (bonus == "ready" ? 1 : 0) }
}
struct QuestReply: Decodable { let cards: [String]?; let type: String?; let profile: Profile }

// MARK: Legend Hunt

// status: ready | playing | won | lost. next = when a new legend appears (ms since 1970).
struct HuntInfo: Decodable, Equatable { let legend: String; let status: String; let next: Double }
struct HuntHome: Decodable { let legend: String; let status: String; let state: BattleState?; let next: Double }
struct HuntResult: Decodable, Equatable { let won: Bool; let pack: [String]?; let packType: String?; let gold: Int?; let xp: Int? }
struct HuntReply: Decodable { let legend: String; let state: BattleState; let result: HuntResult?; let profile: Profile? }
struct ProfileReply: Decodable { let profile: Profile }

// MARK: Gauntlet

struct GauntletStats: Decodable, Equatable { let best: Int; let rank: Int }   // rank among you and your friends

// An endless run: `fight` is the one in progress or up next; `state` is nil between fights.
struct GauntletRun: Decodable, Equatable {
    let team: [String]
    let hp: [Int]               // your cards' HP going into the next fight (0 = knocked out for the run)
    let fight: Int
    let wins: Int
    let gold: Int
    let packs: Int
    let enemies: [String]
    let state: BattleState?
    let nextGold: Int
    let nextPack: Int
}
struct GauntletResult: Decodable, Equatable {
    let won: Bool
    let gold: Int?              // won a fight: gold for it
    let pack: [String]?         // …and a pack every 10th win
    let packType: String?
    let streak: Int?            // run over: final streak and totals
    let newBest: Bool?
    let packs: Int?
    let rank: Int?
}
struct GauntletReply: Decodable { let run: GauntletRun?; let result: GauntletResult?; let profile: Profile? }
struct GauntletHome: Decodable { let best: Int; let run: GauntletRun?; let top: [LeaderRow] }
struct LeaderRow: Decodable, Equatable, Identifiable {
    let rank: Int
    let name: String
    let avatar: String
    let best: Int
    let me: Bool
    var id: String { name }
}

struct SpinReply: Decodable {
    let slot: Int               // which of the wheel's 8 slots it landed on (clockwise from the top)
    let kind: String            // gold | xp | pack
    let amount: Int
    let cards: [String]?        // the pack, when it's a pack
    let packType: String?
    let profile: Profile
}
struct SocialReply: Decodable { let message: String?; let social: Social }
struct PackReply: Decodable { let cards: [String]; let profile: Profile }
struct ShopReply: Decodable { let card: String; let profile: Profile }

// The daily shop: one Rare (first) and three Commons, the same for everyone, new at `next` (ms since 1970).
struct Shop: Decodable, Equatable {
    struct Item: Decodable, Equatable { let id: String; let price: Int; let sold: Bool }
    let cards: [Item]
    let next: Double
}

// A card in battle. Fused cards also carry their max HP, fusion levels and the second special's cooldown.
struct Unit: Decodable, Equatable {
    let id: String
    var hp: Int
    var cd: Int
    let max: Int?
    let f: Fusion?
    var cd2: Int?
}

// Fusion levels: h/b/s = HP, basic, special (0-3 each); x = second special unlocked.
struct Fusion: Decodable, Equatable, Hashable {
    var h = 0, b = 0, s = 0
    var x = false
    var total: Int { h + b + s + (x ? 1 : 0) }
}
// One fused copy a player owns (each counts as one of their copies of that card).
struct FusedCopy: Decodable, Equatable, Identifiable, Hashable {
    let id: Int
    let card: String
    let h: Int, b: Int, s: Int
    let x: Bool
    var fusion: Fusion { Fusion(h: h, b: b, s: s, x: x) }
}

// Same sums as the server: HP +10%, basic +20%, special (and second special) +10% per level.
extension Card {
    func maxHP(_ f: Fusion?) -> Int { Int((Double(hp) * (1 + 0.1 * Double(f?.h ?? 0))).rounded()) }
    func dmg(_ move: String, _ f: Fusion?) -> Int {
        switch move {
        case "basic": return Int((Double(basic.dmg) * (1 + 0.2 * Double(f?.b ?? 0))).rounded())
        case "special2": return Int((Double(special2?.dmg ?? 0) * (1 + 0.1 * Double(f?.s ?? 0))).rounded())
        default: return Int((Double(special.dmg) * (1 + 0.1 * Double(f?.s ?? 0))).rounded())
        }
    }
}

struct LogEntry: Decodable, Equatable {
    let p: Int, from: Int, to: Int
    let move: String
    let dmg: Int
    let heal: Int?              // a Mystic's heal: `to` is on the mover's own side
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
    let invitee: String?        // a challenge sent straight to this friend
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
        switch cls {
        case "Fighter": return cyan
        case "Beast": return pink
        case "Arcanist": return Color(hex: 0x9B6BFF)
        case "Spirit": return Color(hex: 0x2FE3C4)
        case "Mystic": return Color(hex: 0xFFC53D)
        default: return orange
        }
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
// Images: the few UI pictures ship in the app (Resources/Art); card art is downloaded by ArtSync and kept on the phone.
enum Art {
    private static let cache = NSCache<NSString, UIImage>()
    static let folder: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CardArt")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    static func image(_ name: String) -> UIImage? {
        if let hit = cache.object(forKey: name as NSString) { return hit }
        let bundled = ["webp", "png"].lazy.compactMap { Bundle.main.path(forResource: name, ofType: $0, inDirectory: "Art") }.first
        let path = bundled ?? folder.appendingPathComponent(name + ".webp").path
        guard let img = UIImage(contentsOfFile: path) else { return nil }
        cache.setObject(img, forKey: name as NSString)
        return img
    }
    static func forget(_ name: String) { cache.removeObject(forKey: name as NSString) }
    static func classIcon(_ cls: String) -> UIImage? { image("class_" + cls.lowercased()) }
    // cyber | magic | omni; the Cyber Pack is the plain "pack" image used everywhere else
    static func pack(_ type: String) -> UIImage? { image(type == "cyber" ? "pack" : "pack_" + type) }
}
