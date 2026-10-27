import Foundation

// Fugitive's JSON, mirrored from the server: `payload` in
// games/fugitive/game.py and `view` in games/fugitive/engine.py. Unlike
// Flip 7 the game is different for each viewer — a seat sees its own hand,
// the table sees what both players could see across a real table — so
// everything a viewer may not see arrives as nil, never as a value to hide.
// The fixtures in GameNightTests/Fixtures are real responses, checked
// against the server's keys by the Flask suite.

nonisolated enum FugitiveRole: String, Codable, CaseIterable, Identifiable {
    case fugitive, marshal
    var id: String { rawValue }
    var other: FugitiveRole { self == .fugitive ? .marshal : .fugitive }
    var title: String { self == .fugitive ? "Fugitive" : "Marshal" }
}

nonisolated struct FugitivePayload: Decodable, Equatable {
    let code: String
    let players: [String: String]
    let seats: [String: FugitiveSeat]
    let you: FugitiveYou
    let game: FugitiveGame
    /// Set once a rematch has started: the new game's code.
    let next: String?
    /// Only on the response that dealt the game.
    let hostToken: String?
    let inviteUrl: String?
    /// Only on the response that claimed a seat.
    let seatToken: String?
    /// On a refused move, alongside the current game.
    let error: String?

    func name(_ role: FugitiveRole) -> String { players[role.rawValue] ?? role.title }
    func taken(_ role: FugitiveRole) -> Bool { seats[role.rawValue]?.taken ?? false }
}

nonisolated struct FugitiveSeat: Decodable, Equatable {
    let taken: Bool
}

nonisolated struct FugitiveYou: Decodable, Equatable {
    /// "host", "seat", or nil for a token that's nobody's.
    let role: String?
    let seat: FugitiveRole?
}

nonisolated struct FugitiveGame: Decodable, Equatable {
    enum Phase: String, Decodable {
        case fugitiveDraw = "fugitive_draw"
        case fugitiveHide = "fugitive_hide"
        case marshalDraw = "marshal_draw"
        case marshalGuess = "marshal_guess"
        case manhunt
        case gameOver = "game_over"
    }

    /// "fugitive", "marshal" or "table".
    let viewer: String
    let phase: Phase
    let turn: FugitiveRole?
    let hidesLeft: Int
    let firstTurn: Bool
    let drawsLeft: Int
    let hideouts: [Hideout]
    let deckCounts: [Int]
    /// Each deck's range, e.g. [4, 14].
    let decks: [[Int]]
    /// The viewer's own hand; nil for the table.
    let hand: [Int]?
    let handCounts: [String: Int]
    /// Sprint value of each card, keyed by its number as a string.
    let footprints: [String: Int]
    let maxStep: Int
    let winner: FugitiveRole?
    /// caught | escaped | manhunt_failed | let_go | resigned
    let reason: String?
    let log: [FugitiveEvent]
    let seq: Int
    /// The Marshal's notepad help: what each hideout could still be.
    let candidates: [[Int]]?

    var viewerRole: FugitiveRole? { FugitiveRole(rawValue: viewer) }
    var isOver: Bool { phase == .gameOver }
    var lastHideout: Int { hideouts.last?.card ?? 0 }
    func steps(_ card: Int) -> Int { footprints[String(card)] ?? 0 }
    func handCount(_ role: FugitiveRole) -> Int { handCounts[role.rawValue] ?? 0 }
    var myTurn: Bool { turn != nil && turn == viewerRole }
}

nonisolated struct Hideout: Decodable, Equatable {
    /// Nil while face down to this viewer.
    let card: Int?
    /// Public: you can count the cards tucked beneath a hideout.
    let sprintCount: Int
    let sprints: [Int]?
    let revealed: Bool
}

nonisolated struct FugitiveEvent: Decodable, Equatable, Identifiable {
    let id: Int
    /// drew | hid | passed | guessed | manhunt | game_over
    let kind: String
    let role: FugitiveRole?
    let deck: Int?
    let card: Int?
    let index: Int?
    let sprints: [Int]?
    let numbers: [Int]?
    let hit: Bool?
    let revealed: [Int]?
    let winner: FugitiveRole?
    let reason: String?
}

/// A move, as `POST /fugitive/api/play/<code>/move` takes it. Fields that
/// don't apply are left out, not sent as null.
nonisolated struct FugitiveMove: Encodable, Equatable {
    enum Kind: String, Encodable {
        case draw, hide, pass, guess, resign
        case letGo = "let_go"
    }
    let type: Kind
    var deck: Int?
    var card: Int?
    var sprints: [Int]?
    var numbers: [Int]?
    let seq: Int
}

nonisolated struct FugitiveRematch: Decodable, Equatable {
    let code: String
    let hostToken: String
}

/// `GET /fugitive/api/stats`, leaderboard in the records page's order.
nonisolated struct FugitiveStats: Decodable, Equatable {
    nonisolated struct Row: Decodable, Equatable {
        let name: String
        let games: Int
        let wins: Int
        let fugitiveGames: Int
        let fugitiveWins: Int
        let marshalGames: Int
        let marshalWins: Int
        let manhuntCatches: Int
        let winRate: Int
    }
    nonisolated struct Recent: Decodable, Equatable {
        let at: String
        let fugitive: String
        let marshal: String
        let winner: FugitiveRole
        let reason: String
        let hideouts: Int
    }
    let gamesPlayed: Int
    let leaderboard: [Row]
    let recent: [Recent]
}

extension GameNightClient {
    static let fugitiveHeader = "X-Fugitive-Token"

    func fugitiveCreate(fugitive: String, marshal: String) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play", body: ["fugitive": fugitive, "marshal": marshal])
    }

    func fugitiveState(code: String, token: String?) async throws -> FugitivePayload {
        try await send("GET", "fugitive/api/play/\(code)", token: token, tokenHeader: Self.fugitiveHeader)
    }

    func fugitiveMove(code: String, _ move: FugitiveMove, token: String) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play/\(code)/move", body: move, token: token, tokenHeader: Self.fugitiveHeader)
    }

    func fugitiveClaim(code: String, role: FugitiveRole) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play/\(code)/seats/\(role.rawValue)/claim")
    }

    func fugitiveRelease(code: String, role: FugitiveRole, token: String) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play/\(code)/seats/\(role.rawValue)/release",
                       token: token, tokenHeader: Self.fugitiveHeader)
    }

    func fugitiveRematch(code: String, token: String) async throws -> FugitiveRematch {
        try await send("POST", "fugitive/api/play/\(code)/rematch", token: token, tokenHeader: Self.fugitiveHeader)
    }

    func fugitiveStats() async throws -> FugitiveStats {
        try await send("GET", "fugitive/api/stats")
    }

    /// The table's web address — what the invite QR points at, so a phone
    /// without the app can still sit down.
    func fugitiveTableURL(code: String) -> URL {
        baseURL.appendingPathComponent("fugitive/play/\(code)")
    }
}
