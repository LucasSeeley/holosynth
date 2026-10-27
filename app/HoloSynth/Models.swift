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
    let passive: String?    // passive kind (see Passives), switched on by fusion
}

// Power cards: one-use battle cards (same table as the server's POWERS). Playing one is a move by one of your cards.
// target: ally = one of your standing cards, ko = a knocked-out one, acted = another of yours that already acted, none.
struct Power: Identifiable, Hashable {
    let id: String, name: String, rarity: String, target: String, effect: String, short: String, symbol: String
    static let all: [Power] = [
        Power(id: "repair", name: "Repair Kit", rarity: "Common", target: "ally", effect: "Heal one of your cards 25 HP", short: "+25 HP", symbol: "wrench.and.screwdriver.fill"),
        Power(id: "overclock", name: "Overclock", rarity: "Common", target: "ally", effect: "One card's next attack +40%", short: "Next attack +40%", symbol: "bolt.fill"),
        Power(id: "shield", name: "Shield", rarity: "Common", target: "ally", effect: "One card takes no damage from the next hit", short: "Blocks a hit", symbol: "shield.fill"),
        Power(id: "recharge", name: "Recharge", rarity: "Rare", target: "ally", effect: "One card's specials are ready right now", short: "Special ready", symbol: "arrow.clockwise.circle.fill"),
        Power(id: "emp", name: "EMP", rarity: "Rare", target: "none", effect: "Every enemy special +1 turn of cooldown", short: "Enemy specials +1", symbol: "dot.radiowaves.left.and.right"),
        Power(id: "nanoswarm", name: "Nanoswarm", rarity: "Rare", target: "none", effect: "20 damage to every enemy", short: "20 to all enemies", symbol: "aqi.medium"),
        Power(id: "revive", name: "Revive Chip", rarity: "Epic", target: "ko", effect: "Bring back a knocked-out card at 30% HP", short: "Back at 30% HP", symbol: "heart.circle.fill"),
        Power(id: "timeskip", name: "Time Skip", rarity: "Epic", target: "acted", effect: "One card can act again this round", short: "Act again", symbol: "clock.arrow.circlepath"),
        Power(id: "mirror", name: "Mirror", rarity: "Epic", target: "ally", effect: "The next hit on one card bounces back at the attacker", short: "Bounces a hit", symbol: "arrow.left.arrow.right"),
        Power(id: "overdrive", name: "Overdrive", rarity: "Legendary", target: "none", effect: "Every card's next attack +30%", short: "Team +30%", symbol: "flame.fill"),
        Power(id: "restore", name: "Full Restore", rarity: "Legendary", target: "ally", effect: "Fully heal one card", short: "Full HP", symbol: "cross.fill"),
        Power(id: "singularity", name: "Singularity", rarity: "Legendary", target: "none", effect: "Every enemy loses 25% of its max HP", short: "−25% to all", symbol: "circle.circle.fill"),
    ]
    static func of(_ id: String) -> Power? { all.first { $0.id == id || "pw:" + $0.id == id } }
    static let violet = Color(hex: 0xB46BFF)
}

// Same table as the server's PASSIVES: name, what it does ("{}" = the value), values by rarity (Common, Rare, Epic, Legendary).
enum Passives {
    static let all: [String: (name: String, text: String, values: [Int])] = [
        "momentum": ("Momentum", "Each basic hit adds +{}% to its next basic (stacks 3 times)", [5, 7, 9, 12]),
        "firststrike": ("First Strike", "Its first attack of the battle deals +{}% damage", [25, 35, 45, 60]),
        "lifesteal": ("Lifesteal", "Heals {}% of the damage it deals", [15, 20, 25, 30]),
        "executioner": ("Executioner", "+{}% damage to targets under 30% HP", [20, 30, 40, 50]),
        "armor": ("Armor", "Takes {}% less damage", [8, 10, 12, 15]),
        "thorns": ("Thorns", "Reflects {}% of damage taken back at the attacker", [10, 15, 20, 25]),
        "quickcharge": ("Quick Charge", "Special cooldown 1 turn shorter", [1, 1, 1, 1]),
        "laststand": ("Last Stand", "+{}% damage while under 30% HP", [20, 30, 40, 50]),
        "phaseshift": ("Phase Shift", "The first hit it takes deals {}% less", [40, 50, 60, 75]),
        "rebirth": ("Rebirth", "Once per battle, survives a knockout with {}% HP", [10, 15, 20, 25]),
        "regen": ("Regen", "Heals {}% of its max HP each time it acts", [4, 5, 6, 8]),
        "blessing": ("Blessing", "Its heals are {}% stronger", [15, 20, 25, 30]),
    ]

    // This card's passive: name, description, and the short value shown on the card ("30%", "−1").
    static func of(_ card: Card) -> (name: String, text: String, short: String)? {
        guard let k = card.passive, let p = all[k] else { return nil }
        let v = p.values[["Common", "Rare", "Epic", "Legendary"].firstIndex(of: card.rarity) ?? 0]
        return (p.name, p.text.replacingOccurrences(of: "{}", with: "\(v)"), k == "quickcharge" ? "−1" : "\(v)%")
    }
    static func value(_ card: Card) -> Double {
        guard let k = card.passive, let p = all[k] else { return 0 }
        return Double(p.values[["Common", "Rare", "Epic", "Legendary"].firstIndex(of: card.rarity) ?? 0])
    }
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
    // Your best normal (non-holo) fused copy of a card, and your best holo copy.
    func fusion(_ id: String) -> Fusion? { best(id, holo: false) }
    func holo(_ id: String) -> Fusion? { best(id, holo: true) }
    func holoCount(_ id: String) -> Int { fused?.filter { $0.card == id && $0.o == true }.count ?? 0 }
    private func best(_ id: String, holo: Bool) -> Fusion? {
        fused?.filter { $0.card == id && ($0.o == true) == holo }.max { $0.fusion.total < $1.fusion.total }?.fusion
    }
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
    let unopened: [UnopenedPack]?   // packs waiting to be opened, oldest first
    let powers: [String: Int]?      // power cards you own: id → copies
    let powerTeam: [String]?        // the (up to) 2 you take into battle
    let avatar: String          // card shown as your picture
    let since: Double           // account created, ms since 1970
    let friends: Int
    let nextSpin: Double        // when the daily spin is ready again, ms since 1970; 0 = ready now
    let spinPack: String?       // which pack the wheel's pack slot gives today
    let packsOpen: [String]?    // packs on sale (server decides); the rest say "Coming soon"
    let shop: Shop?             // today's shop cards
    let hunt: HuntInfo?         // today's Legend Hunt
    let quests: Quests?         // today's daily quests
    let ranked: RankedTileInfo? // your ranked rank and place this week
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
        let holo: [Int]?            // which of the pack's cards came out holo
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
    static let names = ["Synth #", "HP", "Rarity", "Dups", "Holo"]
    private static let rank = ["Legendary": 0, "Epic": 1, "Rare": 2, "Common": 3]
    // `cards` must already be in number order so ties keep it. `counts` (copies per card) is only used by Dups,
    // `holos` (cards you have a holo copy of) by Holo.
    static func apply(_ cards: [Card], _ mode: Int, counts: [String: Int] = [:], holos: Set<String> = []) -> [Card] {
        switch mode % names.count {
        case 4: return cards.enumerated().sorted { (holos.contains($0.element.id) ? 0 : 1, $0.offset) < (holos.contains($1.element.id) ? 0 : 1, $1.offset) }.map(\.element)
        case 3: return cards.enumerated().sorted { (counts[$1.element.id] ?? 0, $0.offset) < (counts[$0.element.id] ?? 0, $1.offset) }.map(\.element)
        case 1: return cards.enumerated().sorted { ($1.element.hp, $0.offset) < ($0.element.hp, $1.offset) }.map(\.element)
        case 2: return cards.enumerated().sorted { (rank[$0.element.rarity] ?? 9, $0.offset) < (rank[$1.element.rarity] ?? 9, $1.offset) }.map(\.element)
        default: return cards
        }
    }
}
// MARK: Ranked

// Eight ranks; each week you're in your rank's table of 30 (computer players fill it out), moved up or down by your place.
struct Ranked: Decodable, Equatable {
    struct Row: Decodable, Equatable { let place: Int; let name: String; let points: Int; let me: Bool; let bot: Bool }
    struct Reward: Decodable, Equatable { let gold: Int; let pack: String? }
    struct Opp: Decodable, Equatable { let name: String; let rank: Int; let team: [String]; let avatar: String?; let bot: Bool? }
    struct Run: Decodable, Equatable { let opp: Opp; let state: BattleState }
    struct Moved: Decodable, Equatable { let place: Int; let from: Int; let to: Int; let points: Int }
    struct SeasonReward: Decodable, Equatable { let season: Int; let rank: Int; let gold: Int; let pack: String? }
    let rank: Int
    let ranks: [String]
    let rewards: [Reward]
    let points: Int
    let place: Int
    let table: [Row]
    let weekEnds: Double
    let season: Int
    let seasonEnds: Double
    let best: Int
    let run: Run?               // a fight against another player's team, played by the computer
    let liveMatch: Int?         // a live match against another player searching at the same time
    let moved: Moved?           // last week's result, shown once
    let reward: SeasonReward?   // last season's reward, waiting to be claimed
}
struct RankedSearchReply: Decodable { let view: Ranked; let searching: Bool? }
struct RankedResult: Decodable, Equatable { let won: Bool; let delta: Int; let points: Int; let from: Int; let place: Int; let gold: Int; let xp: Int }
struct RankedMoveReply: Decodable { let state: BattleState?; let result: RankedResult?; let view: Ranked?; let profile: Profile? }
struct RankedClaimReply: Decodable { let cards: [String]?; let holo: [Int]?; let type: String?; let gold: Int; let profile: Profile }
struct RankedTileInfo: Decodable, Equatable { let rank: Int; let name: String; let place: Int; let points: Int; let weekEnds: Double; let alert: Bool }

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
struct QuestReply: Decodable { let cards: [String]?; let holo: [Int]?; let type: String?; let profile: Profile }

// MARK: Legend Hunt

// status: ready | playing | won | lost (this hunt). next = when a new legend appears (ms since 1970).
// A new hunt every 8 hours: the fully fused legend plus two medium fused Rare or Epic support cards.
struct HuntInfo: Decodable, Equatable { let legend: String; let support: String?; let status: String; let next: Double }
struct HuntHome: Decodable {
    let legend: String; let support: String?; let supportFusion: Fusion?; let support2: String?; let support2Fusion: Fusion?
    let status: String; let state: BattleState?; let next: Double
}
struct HuntResult: Decodable, Equatable { let won: Bool; let pack: [String]?; let holo: [Int]?; let packType: String?; let gold: Int?; let xp: Int? }
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
    let holo: [Int]?            // which of its cards came out holo
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
    let holo: [Int]?            // which of its cards came out holo
    let packType: String?
    let profile: Profile
}
struct SocialReply: Decodable { let message: String?; let social: Social }
struct UnopenedPack: Decodable, Equatable { let type: String; let n: Int }
struct PackReply: Decodable { let cards: [String]; let holo: [Int]?; let profile: Profile }
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
    let ps: String?             // its passive, when unlocked
    let hit: Bool?              // has attacked (First Strike)
    let mom: Int?               // Momentum stacks
    let ph: Bool?               // Phase Shift used
    let oc: Bool?, od: Bool?     // power cards: Overclock / Overdrive waiting on its next attack
    let sh: Bool?, mi: Bool?     // power cards: Shield / Mirror waiting for the next hit
}

// Fusion levels: h/b/s = HP, basic, special (0-3 each); x = second special unlocked.
struct Fusion: Decodable, Equatable, Hashable {
    var h = 0, b = 0, s = 0
    var x = false
    var o: Bool? = nil          // holo copy: rainbow foil, +20% to every stat
    var p: Bool? = nil          // passive unlocked
    var total: Int { h + b + s + (x ? 1 : 0) + (p == true ? 1 : 0) }
    var passive: Bool { p == true }
    var holo: Bool { o == true }
    static let holoCopy = Fusion(o: true)
}
// One fused copy a player owns (each counts as one of their copies of that card).
struct FusedCopy: Decodable, Equatable, Identifiable, Hashable {
    let id: Int
    let card: String
    let h: Int, b: Int, s: Int
    let x: Bool
    let o: Bool?
    let p: Bool?
    var fusion: Fusion { Fusion(h: h, b: b, s: s, x: x, o: o, p: p) }
}

// Same sums as the server: HP +10%, basic +20%, special (and second special) +10% per level.
extension Card {
    // Same maths as the server: fusion levels, then +20% for a holo copy.
    func maxHP(_ f: Fusion?) -> Int { Self.boost(hp, per: 0.1, levels: f?.h ?? 0, f) }
    func dmg(_ move: String, _ f: Fusion?) -> Int {
        switch move {
        case "basic": return Self.boost(basic.dmg, per: 0.2, levels: f?.b ?? 0, f)
        case "special2": return Self.boost(special2?.dmg ?? 0, per: 0.1, levels: f?.s ?? 0, f)
        default: return Self.boost(special.dmg, per: 0.1, levels: f?.s ?? 0, f)
        }
    }
    private static func boost(_ base: Int, per: Double, levels: Int, _ f: Fusion?) -> Int {
        let fused: Double = Double(base) * (1 + per * Double(levels))
        return Int((fused * holoX(f)).rounded())
    }
    private static func holoX(_ f: Fusion?) -> Double { f?.holo == true ? 1.2 : 1 }
}

struct LogEntry: Decodable, Equatable {
    let p: Int, from: Int, to: Int
    let move: String
    let dmg: Int
    let heal: Int?              // a Mystic's heal: `to` is on the mover's own side
    let adv: Bool
    let ko: Bool
    let pas: [PassiveHit]?      // passives that kicked in on this move
    let pw: String?             // a power card played (move is "pw:<id>")
    let fx: [PowerFX]?          // cards it touched, with their HP afterwards
}
struct PowerFX: Decodable, Equatable { let p: Int; let i: Int; let hp: Int }
// A passive kicking in: card `i` on side `p`; `v` = HP it gained (+) or lost (−), or for Rebirth the HP it came back with.
struct PassiveHit: Decodable, Equatable { let p: Int; let i: Int; let n: String; let v: Int }

struct BattleState: Decodable, Equatable {
    var teams: [[Unit]]
    var acted: [[Bool]]
    var turn: Int
    var winner: Int?
    var log: [LogEntry]
    var moves: Int?             // moves made so far (older matches don't have it)
    var pw: [[String]]?         // power cards each side still has to play
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
