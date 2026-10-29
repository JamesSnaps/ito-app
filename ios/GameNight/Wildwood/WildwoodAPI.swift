import Foundation

// Wildwood's endpoints on the Game Night server (games/wildwood/game.py),
// and the transport the table talks to — the server now, a phone with no
// signal later, as Fugitive's FugitiveTransport.

/// Where a Wildwood game is kept. The table screens and WildwoodStore only
/// ever talk to this. Failures are `GameNightClient.Failure`s: a 404 is a
/// game that's gone, anything else a sentence to show.
protocol WildwoodTransport {
    func wildwoodState(code: String, token: String?) async throws -> WildwoodPayload
    func wildwoodMove(code: String, _ move: WildwoodMove, token: String) async throws -> WildwoodPayload
    func wildwoodClaim(code: String, seat: Int) async throws -> WildwoodPayload
    func wildwoodRelease(code: String, seat: Int, token: String) async throws -> WildwoodPayload
    func wildwoodRematch(code: String, token: String) async throws -> WildwoodRematch
    /// What the invite QR opens, or nil where there's nothing to scan.
    func wildwoodInviteURL(code: String) -> URL?
    var wildwoodTokens: WildwoodTokens { get }
}

/// A new table: the people's names in seat order, and how many computer
/// players sit after them, at what level.
nonisolated struct WildwoodCreateBody: Encodable {
    let players: [String]
    let computers: Int
    let level: String
}

extension GameNightClient: WildwoodTransport {
    static let wildwoodHeader = "X-Wildwood-Token"

    func wildwoodCreate(players: [String], computers: Int, level: String) async throws -> WildwoodPayload {
        try await send("POST", "wildwood/api/play",
                       body: WildwoodCreateBody(players: players, computers: computers, level: level))
    }

    func wildwoodState(code: String, token: String?) async throws -> WildwoodPayload {
        try await send("GET", "wildwood/api/play/\(code)", token: token, tokenHeader: Self.wildwoodHeader)
    }

    func wildwoodMove(code: String, _ move: WildwoodMove, token: String) async throws -> WildwoodPayload {
        try await send("POST", "wildwood/api/play/\(code)/move", body: move, token: token, tokenHeader: Self.wildwoodHeader)
    }

    func wildwoodClaim(code: String, seat: Int) async throws -> WildwoodPayload {
        try await send("POST", "wildwood/api/play/\(code)/seats/\(seat)/claim")
    }

    func wildwoodRelease(code: String, seat: Int, token: String) async throws -> WildwoodPayload {
        try await send("POST", "wildwood/api/play/\(code)/seats/\(seat)/release", token: token, tokenHeader: Self.wildwoodHeader)
    }

    func wildwoodRematch(code: String, token: String) async throws -> WildwoodRematch {
        try await send("POST", "wildwood/api/play/\(code)/rematch", token: token, tokenHeader: Self.wildwoodHeader)
    }

    func wildwoodStats() async throws -> WildwoodStats {
        try await send("GET", "wildwood/api/stats")
    }

    /// The table's web address — what the invite QR points at, so a phone
    /// without the app can still sit down.
    func wildwoodInviteURL(code: String) -> URL? {
        baseURL.appendingPathComponent("wildwood/play/\(code)")
    }

    var wildwoodTokens: WildwoodTokens { WildwoodTokens() }
}
