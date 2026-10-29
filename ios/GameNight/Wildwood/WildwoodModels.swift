import Foundation

// Wildwood's JSON, mirrored from the server: `payload` in
// games/wildwood/game.py and `view` in games/wildwood/engine.py. Like
// Fugitive the game is different for each viewer — a seat sees its own hand,
// the table only how many cards each seat holds — so anything a viewer may
// not see arrives as nil. The fixtures in GameNightTests/Fixtures are real
// responses, checked against the server's keys by the Flask suite.

/// Cards are strings on the wire, as in engine.py: a colour and a symbol
/// (`r7`, `gS` skip, `bR` reverse, `yD` draw two), or a wild (`W`, `W4`).
nonisolated enum WildwoodCard {
    static let colours = ["r", "g", "b", "y"]
    static let wilds = ["W", "W4"]
    static let colourNames = ["r": "red", "g": "green", "b": "blue", "y": "yellow"]
    static let animals = ["r": "Fox", "g": "Frog", "b": "Owl", "y": "Duckling", "W": "Badger", "W4": "Bear"]
    static let actionNames = ["S": "Skip", "R": "Reverse", "D": "Draw two"]

    static func isWild(_ card: String) -> Bool { wilds.contains(card) }
    static func colour(_ card: String) -> String? { isWild(card) ? nil : String(card.prefix(1)) }
    static func symbol(_ card: String) -> String { isWild(card) ? card : String(card.dropFirst()) }
    static func colourName(_ colour: String) -> String { colourNames[colour] ?? colour }

    /// What a card is called, for VoiceOver and the log: "red 7", "Bear wild +4".
    static func label(_ card: String) -> String {
        if card == "W" { return "Badger wild" }
        if card == "W4" { return "Bear wild +4" }
        let symbol = symbol(card)
        return "\(colourName(colour(card) ?? "")) \(actionNames[symbol] ?? symbol)"
    }

    /// The face in the asset catalogue (render_wildwood_cards.js).
    static func asset(_ card: String?) -> String { "wildwood-card-\(card ?? "back")" }
}

/// Who a view is for: a seat, or the table (no hand).
nonisolated enum WildwoodViewer: Codable, Equatable {
    case table
    case seat(Int)

    var seat: Int? { if case .seat(let n) = self { n } else { nil } }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let seat = try? container.decode(Int.self) { self = .seat(seat) } else { self = .table }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .table: try container.encode("table")
        case .seat(let n): try container.encode(n)
        }
    }
}

nonisolated struct WildwoodPayload: Codable, Equatable {
    let code: String
    let players: [String]
    let seats: [WildwoodSeat]
    let you: WildwoodYou
    let game: WildwoodGame
    /// Set once a rematch has started: the new game's code.
    let next: String?
    /// Only on the response that dealt the game.
    var hostToken: String? = nil
    var inviteUrl: String? = nil
    /// Only on the response that claimed a seat.
    var seatToken: String? = nil
    /// On a refused move, alongside the current game.
    var error: String? = nil
    /// The computer's seats and level, when it's at the table.
    var computer: WildwoodComputer? = nil

    func name(_ seat: Int) -> String { players.indices.contains(seat) ? players[seat] : "Seat \(seat + 1)" }
    func isComputer(_ seat: Int) -> Bool { computer?.seats.contains(seat) ?? false }
    func taken(_ seat: Int) -> Bool { seats.indices.contains(seat) && seats[seat].taken }
}

nonisolated struct WildwoodSeat: Codable, Equatable {
    let taken: Bool
    let computer: Bool
}

/// Who the token that asked belongs to: "host", "seat" (with `seat`) or nobody.
nonisolated struct WildwoodYou: Codable, Equatable {
    let role: String?
    let seat: Int?
}

nonisolated struct WildwoodComputer: Codable, Equatable {
    let seats: [Int]
    /// "easy" or "hard".
    let level: String

    var levelTitle: String { level.capitalized }
}

nonisolated struct WildwoodGame: Codable, Equatable {
    let viewer: WildwoodViewer
    /// "play" or "game_over".
    let phase: String
    let turn: Int?
    let players: Int
    /// This viewer's hand; nil for the table.
    let hand: [String]?
    let handCounts: [Int]
    /// Everyone's hand, once the game is over.
    let hands: [[String]]?
    let top: String
    /// The colour in play (a wild's chosen colour).
    let colour: String
    /// 1 or -1: round the table, or back.
    let direction: Int
    /// Cards waiting for the player to move, from Draw twos or a Bear.
    let stack: Int
    let drawCount: Int
    let discardCount: Int
    /// The player to move has drawn a card that fits and is deciding.
    let deciding: Bool
    /// That card — only to them.
    let drawn: String?
    /// Who went down to one card without saying so, while still catchable.
    let exposed: Int?
    /// The cards this viewer may play now, in hand order.
    let playable: [String]
    let winner: Int?
    let log: [WildwoodEvent]
    let seq: Int

    var isOver: Bool { phase == "game_over" }
    var mySeat: Int? { viewer.seat }
    var myTurn: Bool { !isOver && turn != nil && turn == mySeat }
}

/// One log entry. Each kind uses some of these; the Flask suite pins the
/// keys to this list (EVENT_KEYS in tests/test_wildwood_play_api.py).
nonisolated struct WildwoodEvent: Codable, Equatable, Identifiable {
    let id: Int
    /// deal, play, skip, reverse, draw, keep, call, catch, reshuffle, game_over.
    let kind: String
    var seat: Int? = nil
    var card: String? = nil
    var colour: String? = nil
    var called: Bool? = nil
    var count: Int? = nil
    /// The cards drawn — only to whoever drew them (and to all at the end).
    var cards: [String]? = nil
    /// Why cards were drawn: draw, take or caught.
    var reason: String? = nil
    var by: Int? = nil
    var first: Int? = nil
    var top: String? = nil
    var direction: Int? = nil
    var winner: Int? = nil
}

/// One move, as `POST /wildwood/api/play/<code>/move` takes it.
nonisolated struct WildwoodMove: Codable, Equatable {
    enum Kind: String, Codable { case play, draw, pass, take, call, `catch` }
    var type: Kind
    var card: String? = nil
    var colour: String? = nil
    var call: Bool? = nil
    var seq: Int? = nil
}

nonisolated struct WildwoodRematch: Codable, Equatable {
    let code: String
    let hostToken: String
}

nonisolated struct WildwoodStats: Codable, Equatable {
    nonisolated struct Row: Codable, Equatable, Identifiable {
        let name: String
        let games: Int
        let wins: Int
        let catches: Int
        var winRate: Int? = nil
        var easyGames: Int? = nil
        var easyWins: Int? = nil
        var hardGames: Int? = nil
        var hardWins: Int? = nil
        var id: String { name }
    }

    nonisolated struct Recent: Codable, Equatable {
        let at: String
        let players: [String]
        let winner: String
        var level: String? = nil
        var computerWon: Bool? = nil
    }

    nonisolated struct Computer: Codable, Equatable {
        let gamesPlayed: Int
        let recent: [Recent]
    }

    let gamesPlayed: Int
    let recent: [Recent]
    let leaderboard: [Row]
    let computerLeaderboard: [Row]
    let computer: Computer
}
