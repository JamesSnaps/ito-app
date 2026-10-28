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

nonisolated struct FugitivePayload: Codable, Equatable {
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
    /// Which seat the computer plays, in a game against it; nil otherwise.
    var computer: FugitiveComputer? = nil
    /// False for a game dealt without the app's hints; absent otherwise.
    var hints: Bool? = nil

    /// Reach badges, the running total and the automatic notepad.
    var hintsOn: Bool { hints != false }

    func name(_ role: FugitiveRole) -> String { players[role.rawValue] ?? role.title }
    func taken(_ role: FugitiveRole) -> Bool { seats[role.rawValue]?.taken ?? false }
}

/// The computer's seat and level, as a new game asks for it and the
/// payload says it back. Its seed stays with whoever keeps the game.
nonisolated struct FugitiveComputer: Codable, Equatable {
    /// Its name in its seat — game.py's COMPUTER_NAME.
    static let name = "Computer"

    let role: FugitiveRole
    /// "easy" or "hard".
    let level: String

    /// "Computer · Hard", for its seat.
    var label: String { "Computer · \(FugitiveAI.Level(rawValue: level)?.title ?? level.capitalized)" }
}

nonisolated struct FugitiveSeat: Codable, Equatable {
    let taken: Bool
}

nonisolated struct FugitiveYou: Codable, Equatable {
    /// "host", "seat", or nil for a token that's nobody's.
    let role: String?
    let seat: FugitiveRole?
}

nonisolated struct FugitiveGame: Codable, Equatable {
    enum Phase: String, Codable {
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

nonisolated struct Hideout: Codable, Equatable {
    /// Nil while face down to this viewer.
    let card: Int?
    /// Public: you can count the cards tucked beneath a hideout.
    let sprintCount: Int
    let sprints: [Int]?
    let revealed: Bool
}

extension Hideout {
    /// As it was before a guess turned it over: face down to the Marshal,
    /// still the Fugitive's own to the Fugitive.
    func unturned(for viewer: FugitiveRole?) -> Hideout {
        let mine = viewer == .fugitive
        return Hideout(card: mine ? card : nil, sprintCount: sprintCount, sprints: mine ? sprints : nil, revealed: false)
    }
}

nonisolated struct FugitiveEvent: Codable, Equatable, Identifiable {
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
nonisolated struct FugitiveMove: Codable, Equatable {
    enum Kind: String, Codable {
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

nonisolated struct FugitiveRematch: Codable, Equatable {
    let code: String
    let hostToken: String
}

/// `GET /fugitive/api/stats`, both leaderboards in the records page's order.
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
    /// One person against the computer: by level, and split by the seat played.
    nonisolated struct ComputerRow: Decodable, Equatable {
        let name: String
        let games: Int
        let wins: Int
        let winRate: Int
        let hardGames: Int
        let hardWins: Int
        let easyGames: Int
        let easyWins: Int
        let fugitiveHardGames: Int
        let fugitiveHardWins: Int
        let marshalHardGames: Int
        let marshalHardWins: Int
        let fugitiveEasyGames: Int
        let fugitiveEasyWins: Int
        let marshalEasyGames: Int
        let marshalEasyWins: Int
    }
    nonisolated struct ComputerRecent: Decodable, Equatable {
        let at: String
        let name: String
        let role: FugitiveRole
        let level: String
        let won: Bool
        let reason: String
        let hideouts: Int
    }
    nonisolated struct Computer: Decodable, Equatable {
        let gamesPlayed: Int
        let recent: [ComputerRecent]
    }
    let gamesPlayed: Int
    let leaderboard: [Row]
    let recent: [Recent]
    /// Games against the computer, kept off the leaderboard. Optional while a
    /// server from before v1.12.0 might be answering.
    var computer: Computer? = nil
    var computerLeaderboard: [ComputerRow]? = nil
}
