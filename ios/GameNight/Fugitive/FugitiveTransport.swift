import Foundation

/// Where a Fugitive game is kept: the Game Night server, this phone (an
/// offline game), or a nearby phone that's hosting one. The table screens
/// and FugitiveStore only ever talk to this, so they work the same for all
/// three — an offline game answers with exactly what the server would.
///
/// Failures are `GameNightClient.Failure`s whichever it is: a 404 is a game
/// that's gone, anything else a sentence to show.
protocol FugitiveTransport {
    func fugitiveState(code: String, token: String?) async throws -> FugitivePayload
    func fugitiveMove(code: String, _ move: FugitiveMove, token: String) async throws -> FugitivePayload
    func fugitiveClaim(code: String, role: FugitiveRole) async throws -> FugitivePayload
    func fugitiveRelease(code: String, role: FugitiveRole, token: String) async throws -> FugitivePayload
    func fugitiveRematch(code: String, token: String) async throws -> FugitiveRematch
    /// What the invite QR opens, or nil where there's nothing to scan.
    func inviteURL(code: String) -> URL?
    /// Which tokens this kind of game keeps on the device: online games and
    /// offline ones each have their own, so their codes can't collide.
    var tokens: FugitiveTokens { get }
}

extension GameNightClient: FugitiveTransport {
    func inviteURL(code: String) -> URL? { fugitiveTableURL(code: code) }
    var tokens: FugitiveTokens { FugitiveTokens() }
}
