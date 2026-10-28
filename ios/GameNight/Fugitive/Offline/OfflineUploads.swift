import Foundation

/// Offline games coming home. A finished game sits on the phone until
/// there's signal; then it's sent to the server, which replays it through
/// engine.py and records it. Tried whenever the hub or the records appear
/// and when a game ends — quietly, because no signal just means later.
enum OfflineUploads {
    private static var sending = false

    /// Finished games the server hasn't had yet, oldest first. Games against
    /// the computer go too, into the records kept apart for them.
    static func waiting(on shelf: OfflineShelf = .standard) -> [OfflineGame] {
        shelf.all().filter { $0.finishedAt != nil && $0.upload == .notYet }.reversed()
    }

    /// Sends what's waiting. Returns how many the server took.
    @discardableResult
    static func sendWaiting(client: GameNightClient = AppSettings.client,
                            table: OfflineTable = .shared) async -> Int {
        let shelf = table.shelf
        guard !sending else { return 0 }
        sending = true
        defer { sending = false }
        var sent = 0
        var takesComputerGames: Bool?
        for game in waiting(on: shelf) {
            if game.computer != nil {
                // A server from before v1.12.0 ignores `computer` and would put
                // the game on the leaderboard against a player called Computer.
                // Only one whose records keep them apart gets them; until then
                // they wait here.
                if takesComputerGames == nil {
                    takesComputerGames = (try? await client.fugitiveStats())?.computerLeaderboard != nil
                }
                guard takesComputerGames == true else { continue }
            }
            let outcome: OfflineGame.Upload
            do {
                _ = try await client.fugitiveUploadOffline(body(for: game))
                outcome = .done
                sent += 1
            } catch let failure as GameNightClient.Failure {
                switch failure {
                case .server(let status, let message, _) where (400..<500).contains(status):
                    // The server read it and said no — sending it again won't change that.
                    outcome = .refused(message)
                default:
                    // No signal, or the server's having a bad moment: next time.
                    return sent
                }
            } catch {
                return sent
            }
            table.update(game.code) { $0.upload = outcome }
        }
        prune(shelf)
        return sent
    }

    static func body(for game: OfflineGame) -> OfflineUploadBody {
        OfflineUploadBody(
            id: game.id, players: game.players, decks: game.decks,
            moves: game.moves.map { .init(role: $0.role, move: $0.move) },
            playedAt: game.finishedAt.map { $0.formatted(.iso8601) },
            // The seed lets the server check every one of the computer's
            // moves is the one ai.py makes from it.
            computer: game.computer.map { .init(role: $0.role, level: $0.level.rawValue, seed: $0.seed) })
    }

    /// Games that are done with: sent (or refused) a week ago, or abandoned
    /// for a month. A finished game is never thrown away unsent.
    static func prune(_ shelf: OfflineShelf, now: Date = Date()) {
        for game in shelf.all() {
            let age = now.timeIntervalSince(game.finishedAt ?? game.createdAt)
            let sent = game.upload != .notYet
            if (sent && age > 7 * 86_400) || (game.finishedAt == nil && age > 30 * 86_400) {
                shelf.delete(game.code)
            }
        }
    }
}
