import Foundation

// Fugitive's endpoints on the Game Night server (games/fugitive/game.py).
// Kept apart from the models so they, and the offline engine, build without
// the network layer — the engine's tests run on Linux too.

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

    enum CodingKeys: String, CodingKey {
        case id, players, decks, moves
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
