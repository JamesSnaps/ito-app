import Foundation
import Testing
@testable import GameNight

/// Wildwood's offline table: game.py's room on the phone, a nearby phone
/// playing it through the host, and the upload that brings it home.
@Suite struct WildwoodOfflineTests {
    private func table() -> WildwoodOfflineTable {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("wildwood-\(UUID().uuidString)")
        return WildwoodOfflineTable(shelf: WildwoodShelf(folder: folder), computerDelay: 0)
    }

    /// A legal move for whoever's to move, from what their seat can see.
    private func someMove(_ game: WildwoodGame) -> WildwoodMove {
        if game.stack > 0 && game.playable.isEmpty { return WildwoodMove(type: .take, seq: game.seq) }
        if game.deciding && game.playable.isEmpty { return WildwoodMove(type: .pass, seq: game.seq) }
        guard let card = game.playable.first else { return WildwoodMove(type: .draw, seq: game.seq) }
        return WildwoodMove(type: .play, card: card, colour: WildwoodCard.isWild(card) ? "g" : nil,
                            call: game.hand?.count == 2 ? true : nil, seq: game.seq)
    }

    @Test func aGameAgainstTheComputerPlaysToTheEndAndCanGoHome() async throws {
        let table = table()
        let made = try table.create(players: ["Ana"], computers: 2, level: .hard)
        #expect(made.players == ["Ana", "Hedgehog", "Rabbit"])
        #expect(made.computer == WildwoodComputer(seats: [1, 2], level: "hard"))
        #expect(made.seats.map(\.taken) == [false, true, true])
        let me = try #require(try await table.wildwoodClaim(code: made.code, seat: 0).seatToken)
        for _ in 0..<2000 {
            let seen = try await table.wildwoodState(code: made.code, token: me)
            if seen.game.isOver { break }
            if seen.game.myTurn { _ = try await table.wildwoodMove(code: made.code, someMove(seen.game), token: me) }
        }
        let game = try #require(table.saved(made.code))
        #expect(game.state.phase == "game_over" && game.finishedAt != nil)
        // The upload replays: the same deck, seed and moves end the same way.
        let body = WildwoodOfflineUploads.body(for: game)
        #expect(body.computer?.seats == [1, 2] && body.computer?.level == "hard")
        var replay = WildwoodEngine.newGame(players: 3, deck: body.deck, shuffleSeed: body.shuffleSeed, first: body.first)
        for step in body.moves { try WildwoodEngine.apply(&replay, seat: step.seat, move: step.move) }
        #expect(replay == game.state)
        #expect(WildwoodOfflineUploads.waiting(on: table.shelf).map(\.code) == [made.code])
        // WILDWOOD_UPLOAD_OUT=<file>: write the upload out, to post at a dev
        // server and see /wildwood/api/offline take a game this table made.
        if let out = ProcessInfo.processInfo.environment["WILDWOOD_UPLOAD_OUT"] {
            try JSONEncoder().encode(body).write(to: URL(fileURLWithPath: out))
        }
    }

    @Test func aNearbyGuestSitsDownAndSeesOnlyItsOwnHand() async throws {
        let table = table()
        let made = try table.create(players: ["Ana", "Ben", "Cy"])
        let responder = WildwoodNearbyResponder(table: table)
        let guest = WildwoodNearbyTransport { await responder.answer($0) }
        let sat = try await guest.wildwoodClaim(code: made.code, seat: 1)
        let token = try #require(sat.seatToken)
        #expect(sat.you.seat == 1 && sat.game.hand?.count == 7)
        let host = try #require(made.hostToken)
        let hostView = try await table.wildwoodState(code: made.code, token: host)
        #expect(hostView.game.hand == nil && hostView.seats[1].taken)
        // Someone else's seat is taken; a move out of turn is refused as the server would.
        await #expect(throws: GameNightClient.Failure.self) { _ = try await guest.wildwoodClaim(code: made.code, seat: 1) }
        await #expect(throws: GameNightClient.Failure.self) {
            _ = try await guest.wildwoodMove(code: made.code, WildwoodMove(type: .draw, seq: 0), token: token)
        }
    }

    @Test func aRematchKeepsTheSeatsAndMovesTheStartRound() async throws {
        let table = table()
        let made = try table.create(players: ["Ana", "Ben"])
        let host = try #require(made.hostToken)
        let a = try #require(try await table.wildwoodClaim(code: made.code, seat: 0).seatToken)
        let b = try #require(try await table.wildwoodClaim(code: made.code, seat: 1).seatToken)
        for _ in 0..<2000 {
            let state = try await table.wildwoodState(code: made.code, token: host).game
            if state.isOver { break }
            guard let turn = state.turn else { break }
            let token = turn == 0 ? a : b
            let seen = try await table.wildwoodState(code: made.code, token: token).game
            _ = try await table.wildwoodMove(code: made.code, someMove(seen), token: token)
        }
        let next = try await table.wildwoodRematch(code: made.code, token: host)
        #expect(try await table.wildwoodRematch(code: made.code, token: host) == next)
        let fresh = try await table.wildwoodState(code: next.code, token: b)
        #expect(fresh.you.seat == 1 && fresh.game.turn == 1)
    }
}
