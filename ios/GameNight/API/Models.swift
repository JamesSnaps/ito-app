import Foundation

// The Flip 7 Play API's JSON, mirrored from the server: `play_payload` in
// games/flip7/game.py and `public_view` in games/flip7/engine.py. The wire
// format is snake_case; `GameNightClient` decodes with .convertFromSnakeCase.
//
// Plain values, so `nonisolated`: the app defaults to the main actor, and
// these are decoded and compared from anywhere.
//
// The fixtures in GameNightTests/Fixtures are real responses captured from
// the server code, and a Python test checks they still match the API's keys,
// so a server change that would break these shows up in the Flask suite.

nonisolated struct PlayPayload: Decodable, Equatable {
    let code: String
    let game: Game
    let seats: [Seat]
    let you: You
    /// Set once a rematch has started: the code of the new game.
    let next: String?
    /// Only on the response that created the game.
    let hostToken: String?
    /// Only on the response that claimed a seat.
    let seatToken: String?
    /// Present on 400/409 responses, which still carry the table.
    let error: String?
}

nonisolated struct Seat: Decodable, Equatable {
    let taken: Bool
}

nonisolated struct You: Decodable, Equatable {
    enum Role: String, Decodable { case host, seat }
    let role: Role?
    let seat: Int?
}

nonisolated struct Game: Decodable, Equatable {
    enum Phase: String, Decodable {
        case playing
        case roundOver = "round_over"
        case gameOver = "game_over"
    }

    let phase: Phase
    let round: Int
    let dealer: Int
    let players: [Player]
    let pending: Pending?
    let flip7By: Int?
    let exhausted: Bool
    let lastRound: LastRound?
    let winners: [Int]
    let log: [LogEvent]
    let seq: Int
    let recorded: Bool
    let deckCount: Int
    let discardCount: Int
    let target: Int
}

nonisolated struct Player: Decodable, Equatable {
    enum Status: String, Decodable { case active, stayed, frozen, busted }

    let name: String
    let total: Int
    let rounds: [RoundResult]
    let status: Status
    let hand: Hand
    /// What this round is worth if it were banked now; 0 once busted.
    let roundScore: Int

    var hasFlip7: Bool { hand.numbers.count >= 7 }
}

nonisolated struct RoundResult: Decodable, Equatable {
    let score: Int
    let bust: Bool
    let flip7: Bool
}

nonisolated struct Hand: Decodable, Equatable {
    /// In the order drawn.
    let numbers: [Int]
    let mods: [Int]
    let x2: Bool
    /// Holding a Second Chance.
    let chance: Bool
    /// Freeze / Flip Three played on this player, kept on show.
    let actions: [String]
    /// Drawn during a Flip Three and still to be handed out.
    let held: [String]
    /// The duplicate that busted them.
    let bustCard: Int?

    var isEmpty: Bool { numbers.isEmpty && mods.isEmpty && !x2 && !chance }
}

nonisolated struct Pending: Decodable, Equatable {
    enum Kind: String, Decodable { case turn, give }
    let kind: Kind
    let player: Int
    /// For `give`: the card being handed out.
    let card: String?
    /// For `give`: the seats it may go to.
    let options: [Int]?
}

nonisolated struct LastRound: Decodable, Equatable {
    let scores: [Int]
    let flip7By: Int?
    let exhausted: Bool
}

nonisolated struct LogEvent: Decodable, Equatable, Identifiable {
    let id: Int
    let kind: String
    let player: Int?
    let card: String?
    let context: String?
    let target: Int?
    let round: Int?
    let dealer: Int?
}

/// A move, as `POST /flip7/api/play/<code>/move` takes it. `seq` is the
/// table this device was looking at; anything stale is refused with 409.
nonisolated struct Move: Encodable, Equatable {
    enum Kind: String, Encodable {
        case hit, stay, give
        case nextRound = "next_round"
    }
    let type: Kind
    let player: Int?
    let target: Int?
    let seq: Int
}

nonisolated struct Rematch: Decodable, Equatable {
    let code: String
    let hostToken: String
}

/// `GET /api/join/<code>`: which game a code is for, and its web page.
nonisolated struct JoinTarget: Decodable, Equatable {
    let code: String
    let game: String
    let path: String
}

/// `GET /flip7/api/stats`, with the leaderboard already in the records
/// page's order (most wins, then best average round).
nonisolated struct Flip7Stats: Decodable, Equatable {
    nonisolated struct Row: Decodable, Equatable {
        let name: String
        let games: Int
        let wins: Int
        let points: Int
        let rounds: Int
        let bestGame: Int
        let bestRound: Int
        let flip7s: Int
        let busts: Int
        let average: Double
    }
    nonisolated struct BestRound: Decodable, Equatable {
        let score: Int
        let player: String?
    }
    nonisolated struct Recent: Decodable, Equatable {
        let at: String
        let winner: String
        let score: Int
        let players: Int
    }
    let gamesPlayed: Int
    let leaderboard: [Row]
    let bestRound: BestRound
    let recent: [Recent]
}

/// `GET /ito/api/<code>/state` — what the topic display shows.
nonisolated struct ItoState: Decodable, Equatable {
    let code: String
    let currentTopic: String?
    /// The drawn topic's own category, for the chip.
    let currentCategory: String?
    let currentLow: String?
    let currentHigh: String?
    let currentType: String?
    let roundNumber: Int
    /// Bumped by every deal, a swapped card included — what the display
    /// keys its flip off.
    let drawId: Int
}
