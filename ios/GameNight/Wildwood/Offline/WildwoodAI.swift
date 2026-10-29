import Foundation

// games/wildwood/ai.py in Swift, for the computer at an offline table — a
// port line for line, as FugitiveAI.swift is of Fugitive's: the same checks
// in the same order, and every random choice the same integer pick from
// Mulberry32, so it makes exactly the move ai.py would from the same view and
// seed. Pinned by tests/test_wildwood_offline.py's computer games, which
// WildwoodAITests replays move for move. Change ai.py, rewrite the fixture,
// then make this agree.

nonisolated enum WildwoodAI {
    enum Level: String, Codable, CaseIterable, Identifiable {
        case easy, hard
        var id: String { rawValue }
        var title: String { self == .easy ? "Easy" : "Hard" }
    }

    static let defaultLevel = Level.easy
    static let easyForgetsIn2 = 1
    static let easyCatchesIn3 = 1
    static let closeToOut = 2

    /// The move to make, for the seat `seen` belongs to, on that seat's turn.
    static func choose(_ seen: WildwoodGame, level: Level, rng: inout Mulberry32) -> WildwoodMove? {
        guard let seat = seen.mySeat, seen.turn == seat else { return nil }
        let hard = level == .hard

        if let exposed = seen.exposed, exposed != seat, hard || rng.below(3) < easyCatchesIn3 {
            return WildwoodMove(type: .catch)
        }
        if seen.stack > 0 {
            if let stackable = seen.playable.first(where: { WildwoodEngine.symbolOf($0) == "D" }) {
                return play(seen, stackable, hard: hard, rng: &rng)
            }
            return WildwoodMove(type: .take)
        }
        if seen.deciding {
            if let drawn = seen.drawn, seen.playable.contains(drawn) {
                return play(seen, drawn, hard: hard, rng: &rng)
            }
            return WildwoodMove(type: .pass)
        }
        guard let first = seen.playable.first else { return WildwoodMove(type: .draw) }
        let card = hard ? pick(seen) : first
        return play(seen, card, hard: hard, rng: &rng)
    }

    /// A move that's always legal on this seat's turn (game.py's fallback).
    static func fallback(_ seen: WildwoodGame) -> WildwoodMove {
        if seen.stack > 0 { return WildwoodMove(type: .take) }
        if seen.deciding { return WildwoodMove(type: .pass) }
        return WildwoodMove(type: .draw)
    }

    private static func pick(_ seen: WildwoodGame) -> String {
        let options = seen.playable
        let coloured = options.filter { !WildwoodEngine.wilds.contains($0) }
        if coloured.isEmpty { return options.contains("W") ? "W" : options[0] }
        let me = seen.mySeat ?? 0
        let next = ((me + seen.direction) % seen.players + seen.players) % seen.players
        if seen.handCounts[next] <= closeToOut {
            for symbol in ["D", "S"] {
                if let card = coloured.first(where: { WildwoodEngine.symbolOf($0) == symbol }) { return card }
            }
            if options.contains("W4") { return "W4" }
        }
        let counts = colourCounts(seen.hand ?? [])
        // Most-held colour first; within it, the earliest in hand order —
        // Python's max() keeps the first of equal keys.
        var best = coloured[0]
        var bestKey = (counts[WildwoodEngine.colourOf(best) ?? ""] ?? 0, 0)
        for (i, card) in coloured.enumerated().dropFirst() {
            let key = (counts[WildwoodEngine.colourOf(card) ?? ""] ?? 0, -i)
            if key > bestKey { best = card; bestKey = key }
        }
        return best
    }

    private static func play(_ seen: WildwoodGame, _ card: String, hard: Bool, rng: inout Mulberry32) -> WildwoodMove {
        var move = WildwoodMove(type: .play, card: card)
        if WildwoodEngine.wilds.contains(card) { move.colour = colour(seen, hard: hard, rng: &rng) }
        if seen.hand?.count == 2 { move.call = hard || rng.below(2) >= easyForgetsIn2 }
        return move
    }

    private static func colour(_ seen: WildwoodGame, hard: Bool, rng: inout Mulberry32) -> String {
        guard hard else { return rng.pick(WildwoodEngine.colours) }
        let counts = colourCounts(seen.hand ?? [])
        var best = WildwoodEngine.colours[0]
        for colour in WildwoodEngine.colours.dropFirst() where (counts[colour] ?? 0) > (counts[best] ?? 0) {
            best = colour
        }
        return best
    }

    private static func colourCounts(_ hand: [String]) -> [String: Int] {
        var counts = Dictionary(uniqueKeysWithValues: WildwoodEngine.colours.map { ($0, 0) })
        for card in hand { if let colour = WildwoodEngine.colourOf(card) { counts[colour, default: 0] += 1 } }
        return counts
    }
}
