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

    // MARK: - against the computer

    /// The AI fixture's games with the computer in one seat and a random
    /// player in the other: dealt here with the same decks and seed, the
    /// table must play the computer's moves exactly as ai.py did.
    @Test func theComputerPlaysOneMovePerLookExactlyAsTheFixtureDoes() async throws {
        let root = try FugitiveAITests.root()
        let games = try #require(root["games"] as? [[String: Any]]).filter { ($0["levels"] as? [String: String])?.count == 1 }
        #expect(games.count == 4)
        let table = OfflineTable(shelf: OfflineShelf(folder: folder), computerDelay: 0)

        for game in games {
            let levels = try #require(game["levels"] as? [String: String])
            let (seat, level) = try #require(levels.first)
            let computer = try #require(FugitiveRole(rawValue: seat))
            let dealt = try table.create(you: computer.other, name: "Ana",
                                         level: try #require(FugitiveAI.Level(rawValue: level)),
                                         decks: try #require(game["decks"] as? [[Int]]),
                                         seed: UInt32(try #require(game["seed"] as? Int)))
            let mine = try #require(try await table.fugitiveClaim(code: dealt.code, role: computer.other).seatToken)

            for (number, step) in try #require(game["steps"] as? [[String: Any]]).enumerated() {
                let label = "\(levels), step \(number)"
                let move = try JSONDecoder().decode(FugitiveEngineTests.ScriptMove.self,
                                                    from: JSONSerialization.data(withJSONObject: step["move"] ?? [:])).move
                let before = try #require(table.saved(dealt.code)).state.seq
                if step["computer"] as? Bool == true {
                    // A look at the table is what moves it — once.
                    let seen = try await table.fugitiveState(code: dealt.code, token: mine)
                    #expect(seen.game.seq == before + 1, "\(label)")
                    let played = try #require(table.saved(dealt.code)?.moves.last)
                    #expect(played.role == computer && FugitiveAITests.unsequenced(played.move) == move, "\(label)")
                } else {
                    let sent = FugitiveMove(type: move.type, deck: move.deck, card: move.card, sprints: move.sprints,
                                            numbers: move.numbers, seq: before)
                    _ = try await table.fugitiveMove(code: dealt.code, sent, token: mine)
                }
            }
            let finished = try #require(table.saved(dealt.code))
            #expect(finished.state.reason == game["reason"] as? String && finished.finishedAt != nil)
        }
        // Every one goes home with the computer's seed, for the server to
        // check its moves against ai.py's.
        let waiting = OfflineUploads.waiting(on: table.shelf)
        #expect(!waiting.isEmpty && waiting.allSatisfy { OfflineUploads.body(for: $0).computer?.seed == $0.computer?.seed })
        if let out = ProcessInfo.processInfo.environment["AI_UPLOADS_OUT"] {
            try JSONEncoder().encode(waiting.map(OfflineUploads.body(for:))).write(to: URL(fileURLWithPath: out))
        }
    }

    @Test func theComputerKeepsItsSeatWaitsItsTurnAndSwapsInARematch() async throws {
        let table = OfflineTable(shelf: OfflineShelf(folder: folder), computerDelay: 3600)
        let dealt = try table.create(you: .marshal, name: "Ana", level: .easy)
        let host = try #require(dealt.hostToken)
        #expect(dealt.players == ["fugitive": "Computer", "marshal": "Ana"])
        #expect(dealt.computer == FugitiveComputer(role: .fugitive, level: "easy"))
        #expect(dealt.computer?.label == "Computer · Easy")
        #expect(dealt.taken(.fugitive) && !dealt.taken(.marshal))
        await #expect(throws: OfflineTable.refusal(409, "Someone's already sitting there.")) {
            try await table.fugitiveClaim(code: dealt.code, role: .fugitive)
        }
        await #expect(throws: OfflineTable.refusal(400, "The computer keeps its seat — start a new game instead.")) {
            try await table.fugitiveRelease(code: dealt.code, role: .fugitive, token: host)
        }
        let ana = try #require(try await table.fugitiveClaim(code: dealt.code, role: .marshal).seatToken)

        // Its first hideout waits until the deal has had time to play out.
        #expect(try await table.fugitiveState(code: dealt.code, token: ana).game.seq == 0)
        var game = try #require(table.saved(dealt.code))
        #expect(!table.computerMoves(&game, now: Date().addingTimeInterval(1)))
        #expect(table.computerMoves(&game, now: Date().addingTimeInterval(3601)))
        #expect(game.state.seq == 1 && game.moves.map(\.role) == [.fugitive])

        // A rematch: you swap, and so does the computer, with a new seed.
        _ = try await table.fugitiveMove(code: dealt.code, FugitiveMove(type: .resign, seq: 0), token: ana)
        let rematch = try await table.fugitiveRematch(code: dealt.code, token: host)
        let swapped = try await table.fugitiveState(code: rematch.code, token: ana)
        #expect(swapped.you.seat == .fugitive && swapped.computer == FugitiveComputer(role: .marshal, level: "easy"))
        #expect(swapped.players == ["fugitive": "Ana", "marshal": "Computer"])
        let before = try #require(table.saved(dealt.code)?.computer?.seed)
        #expect(table.saved(rematch.code)?.computer?.seed != before)
        // The finished one goes home with the computer's seed, so the server
        // can check its moves were the computer's.
        let waiting = OfflineUploads.waiting(on: table.shelf)
        #expect(waiting.map(\.code) == [dealt.code])
        let body = OfflineUploads.body(for: try #require(waiting.first))
        #expect(body.computer == .init(role: .fugitive, level: "easy", seed: before))
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        #expect((json["computer"] as? [String: Any])?["seed"] as? Int == Int(before))
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

    @Test func aComputerGameIsKeptLikeAnyOther() throws {
        let shelf = OfflineShelf(folder: folder)
        let table = OfflineTable(shelf: shelf)
        let tenDays = Date(timeIntervalSinceNow: -10 * 86_400)
        var kept: Set<String> = []
        for (upload, finished) in [(OfflineGame.Upload.done, true), (.notYet, true), (.notYet, false)] {
            let code = try table.create(you: .fugitive, name: "Ana", level: .easy).code
            var game = try #require(shelf.load(code))
            game.createdAt = tenDays
            game.finishedAt = finished ? tenDays : nil
            game.upload = upload
            try shelf.save(game)
            if upload == .notYet { kept.insert(code) }
        }
        OfflineUploads.prune(shelf)
        // Sent a week ago: gone. Finished and unsent: kept until it's sent.
        // Still going: a month, like any other.
        #expect(Set(shelf.all().map(\.code)) == kept)
    }
}
