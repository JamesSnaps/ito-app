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
