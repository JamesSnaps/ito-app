import Foundation
import Testing
@testable import GameNight

/// The offline table answers as games/fugitive/game.py would — seats,
/// tokens, refusals, rematches — and a finished game is ready to go home.
@MainActor @Suite struct OfflineTableTests {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("offline-\(UUID().uuidString)")
    var table: OfflineTable { OfflineTable(shelf: OfflineShelf(folder: folder)) }

    /// The first scripted game (a Marshal win) from the engine fixture.
    func scriptedGame() throws -> (decks: [[Int]], moves: [(FugitiveRole, FugitiveMove)]) {
        let root = try #require(try JSONSerialization.jsonObject(
            with: FugitiveEngineTests.fixture("fugitive_engine_games")) as? [String: Any])
        let game = try #require((root["games"] as? [[String: Any]])?.first)
        let decks = try #require(game["decks"] as? [[Int]])
        var moves: [(FugitiveRole, FugitiveMove)] = []
        for step in try #require(game["steps"] as? [[String: Any]]) where step["error"] == nil {
            let role = try #require(FugitiveRole(rawValue: step["role"] as? String ?? ""))
            let move = try JSONDecoder().decode(FugitiveEngineTests.ScriptMove.self,
                                                from: JSONSerialization.data(withJSONObject: step["move"] ?? [:])).move
            moves.append((role, move))
        }
        return (decks, moves)
    }

    @Test func aGameIsDealtSatAtAndPlayedToTheEnd() async throws {
        let table = table
        let script = try scriptedGame()
        let dealt = try table.create(fugitive: "Ana", marshal: "Ben", decks: script.decks)
        let host = try #require(dealt.hostToken)
        #expect(dealt.you.role == "host" && dealt.game.viewer == "table" && dealt.game.hand == nil)
        #expect(table.inviteURL(code: dealt.code) == nil)

        let fugitive = try #require(try await table.fugitiveClaim(code: dealt.code, role: .fugitive).seatToken)
        let marshal = try #require(try await table.fugitiveClaim(code: dealt.code, role: .marshal).seatToken)
        await #expect(throws: OfflineTable.refusal(409, "Someone's already sitting there.")) {
            try await table.fugitiveClaim(code: dealt.code, role: .marshal)
        }
        let seen = try await table.fugitiveState(code: dealt.code, token: fugitive)
        #expect(seen.you.seat == .fugitive && seen.game.hand?.count == 9)
        #expect(seen.taken(.fugitive) && seen.taken(.marshal))

        // The dealer can't move; nor can a move against an old table.
        let first = script.moves[0].1
        await #expect(throws: OfflineTable.refusal(403, "Only the two players can move — sit down first.")) {
            try await table.fugitiveMove(code: dealt.code, first, token: host)
        }
        var stale = first
        stale = FugitiveMove(type: stale.type, deck: stale.deck, card: stale.card, sprints: stale.sprints,
                             numbers: stale.numbers, seq: 5)
        await #expect(throws: OfflineTable.refusal(409, "The game had moved on — this is the latest.")) {
            try await table.fugitiveMove(code: dealt.code, stale, token: fugitive)
        }

        var latest = seen
        for (role, move) in script.moves {
            let token = role == .fugitive ? fugitive : marshal
            let sent = FugitiveMove(type: move.type, deck: move.deck, card: move.card, sprints: move.sprints,
                                    numbers: move.numbers, seq: latest.game.seq)
            latest = try await table.fugitiveMove(code: dealt.code, sent, token: token)
            if role == .marshal && !latest.game.isOver { #expect(latest.game.candidates != nil) }
        }
        #expect(latest.game.isOver && latest.game.winner == .marshal)

        // Finished, and waiting to go home: the decks before the deal and every move.
        let waiting = OfflineUploads.waiting(on: table.shelf)
        #expect(waiting.map(\.code) == [dealt.code])
        let body = OfflineUploads.body(for: try #require(waiting.first))
        #expect(body.decks == script.decks && body.moves.count == script.moves.count)
        #expect(body.playedAt != nil)
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        #expect(Set(json.keys) == ["id", "players", "decks", "moves", "played_at"])
        if let out = ProcessInfo.processInfo.environment["OFFLINE_UPLOAD_OUT"] {
            try JSONEncoder().encode(body).write(to: URL(fileURLWithPath: out))
        }
    }

    @Test func onlyTheDealerFreesSeatsAndStartsTheRematchWithRolesSwapped() async throws {
        let table = table
        let script = try scriptedGame()
        let dealt = try table.create(fugitive: "Ana", marshal: "Ben", decks: script.decks)
        let host = try #require(dealt.hostToken)
        let ana = try #require(try await table.fugitiveClaim(code: dealt.code, role: .fugitive).seatToken)
        let ben = try #require(try await table.fugitiveClaim(code: dealt.code, role: .marshal).seatToken)

        await #expect(throws: OfflineTable.refusal(403, "Only the device that dealt can free a seat.")) {
            try await table.fugitiveRelease(code: dealt.code, role: .marshal, token: ana)
        }
        await #expect(throws: OfflineTable.refusal(400, "This game isn't over yet.")) {
            try await table.fugitiveRematch(code: dealt.code, token: host)
        }

        // Ana gives up; the dealer deals again, and each token follows its player.
        _ = try await table.fugitiveMove(code: dealt.code, FugitiveMove(type: .resign, seq: 0), token: ana)
        await #expect(throws: OfflineTable.refusal(403, "Only the device that dealt can start a rematch.")) {
            try await table.fugitiveRematch(code: dealt.code, token: ben)
        }
        let rematch = try await table.fugitiveRematch(code: dealt.code, token: host)
        #expect(try await table.fugitiveRematch(code: dealt.code, token: host).code == rematch.code)
        #expect(try await table.fugitiveState(code: dealt.code, token: nil).next == rematch.code)
        let swapped = try await table.fugitiveState(code: rematch.code, token: ana)
        #expect(swapped.you.seat == .marshal && swapped.name(.marshal) == "Ana" && swapped.name(.fugitive) == "Ben")

        // Freed seats free up.
        let freed = try await table.fugitiveRelease(code: rematch.code, role: .fugitive, token: host)
        #expect(!freed.taken(.fugitive) && freed.taken(.marshal))
        await #expect(throws: OfflineTable.refusal(404, "That game has ended or expired.")) {
            try await table.fugitiveState(code: "ZZZZ", token: nil)
        }
    }

    @Test func gamesNobodyNeedsAreClearedButAnUnsentFinishIsKept() throws {
        let shelf = OfflineShelf(folder: folder)
        let table = OfflineTable(shelf: shelf)
        let old = Date(timeIntervalSinceNow: -40 * 86_400)
        for (upload, finished) in [(OfflineGame.Upload.done, true), (.notYet, true), (.notYet, false)] {
            let code = try table.create(fugitive: "Ana", marshal: "Ben").code
            var game = try #require(shelf.load(code))
            game.createdAt = old
            game.finishedAt = finished ? old : nil
            game.upload = upload
            try shelf.save(game)
        }
        OfflineUploads.prune(shelf)
        let left = shelf.all()
        #expect(left.count == 1 && left[0].upload == .notYet && left[0].finishedAt != nil)
    }
}
