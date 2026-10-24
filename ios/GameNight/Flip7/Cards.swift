import Foundation

/// A card id as the server sends it: "n7", "+4", "x2", "freeze", "flip3",
/// "chance". Naming and ordering mirror the web table (play.html), so the
/// two read the same.
nonisolated enum Card: Equatable {
    case number(Int)
    case flat(Int)
    case times2
    case freeze
    case flipThree
    case secondChance

    init?(_ id: String) {
        switch id {
        case "x2": self = .times2
        case "freeze": self = .freeze
        case "flip3": self = .flipThree
        case "chance": self = .secondChance
        default:
            if id.hasPrefix("n"), let n = Int(id.dropFirst()) { self = .number(n) }
            else if id.hasPrefix("+"), let n = Int(id.dropFirst()) { self = .flat(n) }
            else { return nil }
        }
    }

    var id: String {
        switch self {
        case .number(let n): "n\(n)"
        case .flat(let n): "+\(n)"
        case .times2: "x2"
        case .freeze: "freeze"
        case .flipThree: "flip3"
        case .secondChance: "chance"
        }
    }

    var isAction: Bool {
        switch self {
        case .freeze, .flipThree, .secondChance: true
        default: false
        }
    }

    /// What's printed on the face.
    var face: String {
        switch self {
        case .number(let n): "\(n)"
        case .flat(let n): "+\(n)"
        case .times2: "×2"
        case .freeze: "Freeze"
        case .flipThree: "Flip 3"
        case .secondChance: "2nd Chance"
        }
    }

    var name: String {
        switch self {
        case .number(let n): "\(n)"
        case .flat(let n): "+\(n)"
        case .times2: "×2"
        case .freeze: "Freeze"
        case .flipThree: "Flip Three"
        case .secondChance: "Second Chance"
        }
    }

    var withArticle: String {
        switch self {
        case .number(let n): (n == 8 || n == 11 ? "an " : "a ") + "\(n)"
        case .times2: "the ×2"
        default: "a " + name
        }
    }

    /// What the card does to whoever is handed it.
    var giveExplanation: String {
        switch self {
        case .freeze: "Whoever gets it banks what they have and is out for the round."
        case .flipThree: "Whoever gets it has to take the next three cards."
        case .secondChance: "You can only hold one, so it goes to someone who doesn’t have one."
        default: ""
        }
    }
}

/// One card on a player's mat, with a stable identity so SwiftUI can animate
/// the new ones in. Two 7s are "n7#0" and "n7#1".
nonisolated struct TableCard: Identifiable, Equatable {
    enum Role { case normal, bust, played, held }
    let id: String
    let card: Card
    let role: Role
}

extension Hand {
    /// The mat's layout, as on the web table: numbers low to high (so a
    /// duplicate is easy to spot), the one that busted them, modifiers, then
    /// action cards.
    var tableCards: [TableCard] {
        var out: [TableCard] = []
        var seen: [String: Int] = [:]
        func add(_ card: Card, _ role: TableCard.Role = .normal) {
            let n = seen[card.id, default: 0]
            seen[card.id] = n + 1
            out.append(TableCard(id: "\(card.id)#\(n)", card: card, role: role))
        }
        numbers.sorted().forEach { add(.number($0)) }
        if let bustCard { add(.number(bustCard), .bust) }
        mods.sorted().forEach { add(.flat($0)) }
        if x2 { add(.times2) }
        if chance { add(.secondChance) }
        actions.compactMap(Card.init).forEach { add($0, .played) }
        held.compactMap(Card.init).forEach { add($0, .held) }
        return out
    }
}

extension LogEvent {
    /// The table's running commentary, worded as on the web page.
    func describe(names: [String]) -> String? {
        func name(_ i: Int?) -> String { i.flatMap { names.indices.contains($0) ? names[$0] : nil } ?? "Someone" }
        let who = name(player)
        let card = self.card.flatMap(Card.init)
        switch kind {
        case "round":
            return "Round \(round ?? 0) — \(name(dealer)) deals"
        case "draw":
            guard let card else { return nil }
            switch context {
            case "deal": return "\(who) was dealt \(card.withArticle)"
            case "flip3": return "\(who) flipped \(card.withArticle)"
            default: return "\(who) drew \(card.withArticle)"
            }
        case "bust":
            return "\(who) busted on \(card?.face ?? "a duplicate")"
        case "saved":
            return "Second Chance saved \(who) from a second \(card?.face ?? "card")"
        case "flip7":
            return "\(who) flipped 7!"
        case "stay":
            return "\(who) stayed"
        case "discarded":
            return "\(who)’s spare \(card?.name ?? "card") was discarded"
        case "reshuffle":
            return "Discards shuffled back into the deck"
        case "round_end":
            return "Round \(round ?? 0) is over"
        case "give":
            let to = target == player ? "themself" : name(target)
            switch card {
            case .freeze: return "\(who) froze \(to)"
            case .flipThree: return "\(who) gave \(to) Flip Three"
            default: return "\(who) gave \(to) a Second Chance"
            }
        default:
            return nil
        }
    }
}
