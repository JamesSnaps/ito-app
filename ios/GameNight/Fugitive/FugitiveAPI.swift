import Foundation

// Fugitive's endpoints on the Game Night server (games/fugitive/game.py).
// Kept apart from the models so they, and the offline engine, build without
// the network layer — the engine's tests run on Linux too.

extension GameNightClient {
    static let fugitiveHeader = "X-Fugitive-Token"

    func fugitiveCreate(fugitive: String, marshal: String, hints: Bool = true) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play", body: FugitivePairBody(fugitive: fugitive, marshal: marshal, hints: hints))
    }

    /// A game against the computer: your name in your seat, and the computer
    /// in the other at `level`. The server names it and plays it.
    func fugitiveCreate(you: FugitiveRole, name: String, level: FugitiveAI.Level, hints: Bool = true) async throws -> FugitivePayload {
        try await send("POST", "fugitive/api/play",
                       body: FugitiveSoloBody(you: you, name: name, computer: .init(role: you.other, level: level.rawValue),
                                              hints: hints))
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

/// `{"<your role>": name, "computer": {role, level}}`.
/// A game between two people: their names, and whether it's played with hints.
nonisolated struct FugitivePairBody: Encodable {
    let fugitive: String
    let marshal: String
    let hints: Bool
}

nonisolated struct FugitiveSoloBody: Encodable {
    let you: FugitiveRole
    let name: String
    let computer: FugitiveComputer
    var hints = true

    struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(name, forKey: Key(you.rawValue))
        try container.encode(computer, forKey: Key("computer"))
        try container.encode(hints, forKey: Key("hints"))
    }
}

/// An offline game, as `POST /fugitive/api/offline` takes it: the decks
/// before the deal and every move, for the server to replay through
/// engine.py before it records anything.
nonisolated struct OfflineUploadBody: Encodable {
    nonisolated struct Step: Encodable {
        let role: FugitiveRole
        let move: FugitiveMove
    }
    let id: String
    let players: [String: String]
    let decks: [[Int]]
    let moves: [Step]
    let playedAt: String?
    /// A game against the computer: its seat, level and seed. Left out for two people.
    var computer: Computer? = nil
    /// False for a game played without hints, so the records say so.
    var hints: Bool? = nil

    nonisolated struct Computer: Encodable, Equatable {
        let role: FugitiveRole
        let level: String
        let seed: UInt32
    }

    enum CodingKeys: String, CodingKey {
        case id, players, decks, moves, computer, hints
        case playedAt = "played_at"
    }
}

nonisolated struct OfflineUploadResult: Decodable, Equatable {
    /// False for a game already recorded (a retried upload) or one nobody played.
    let recorded: Bool
}

extension GameNightClient {
    func fugitiveUploadOffline(_ body: OfflineUploadBody) async throws -> OfflineUploadResult {
        try await send("POST", "fugitive/api/offline", body: body)
    }
}
