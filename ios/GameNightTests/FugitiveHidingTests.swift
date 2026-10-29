import Foundation
import Testing
@testable import GameNight

/// Choosing a hideout and sprint cards: what each card in hand shows it
/// would cost, and what a tap does in each step.
@MainActor @Suite struct FugitiveHidingTests {
    /// A first turn with the hand 1, 2, 3, 4, 8, 11, 17, 18, 42 — 17 has two
    /// footprints, 42 none, the rest one each.
    func firstTurn() async throws -> FugitiveGame {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("hiding-\(UUID().uuidString)")
        let table = OfflineTable(shelf: OfflineShelf(folder: folder))
        // Top card last: deck 1 deals 4, 8, 11 and deck 2 deals 17, 18.
        let decks = [[5, 6, 7, 9, 10, 12, 13, 14, 11, 8, 4],
                     [15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 18, 17],
                     Array(29...41)]
        let code = try table.create(fugitive: "Ana", marshal: "Ben", decks: decks).code
        let token = try #require(try await table.fugitiveClaim(code: code, role: .fugitive).seatToken)
        let game = try await table.fugitiveState(code: code, token: token).game
        #expect(game.hand == [1, 2, 3, 4, 8, 11, 17, 18, 42])
        return game
    }

    @Test func everyCardShowsWhatItWouldCostAsAHideout() async throws {
        let game = try await firstTurn()
        let costs = Dictionary(uniqueKeysWithValues: (game.hand ?? []).map { ($0, FugitiveHiding.cost($0, in: game)) })
        // From 0 the free reach is 3.
        #expect(costs[1] == .inReach && costs[2] == .inReach && costs[3] == .inReach)
        #expect(costs[4] == .needs(1) && costs[8] == .needs(5))
        // 11 needs 8, and the other cards hold exactly 8 footprints.
        #expect(costs[11] == .needs(8))
        #expect(costs[17] == .outOfReach && costs[18] == .outOfReach && costs[42] == .outOfReach)
        #expect(FugitiveHiding.heading(game) == "First turn · hideout 1 of 2")
        // The first hideout has to go down: no way out yet.
        #expect(FugitiveHiding.passLabel(game) == nil)
    }

    @Test func aSecondCardMovesTheHideoutInsteadOfBecomingASprint() async throws {
        let game = try await firstTurn()
        var hiding = FugitiveHiding()
        hiding.tap(2, in: game)
        #expect(hiding.pick == 2 && hiding.mode == .hideout && hiding.canHide(game))
        // What was tapped next at the table: 11. It's the new hideout, out of
        // reach, so the hand goes over to sprinting.
        hiding.tap(11, in: game)
        #expect(hiding.pick == 11 && hiding.sprints.isEmpty && hiding.mode == .sprint)
        #expect(!hiding.canHide(game))
        #expect(hiding.hint(game) == "11 needs 8 more footprints · reach 3. Tap cards to sprint with them.")

        // Sprinting: 17 is worth two, 42 can't sprint at all.
        hiding.tap(17, in: game)
        hiding.tap(42, in: game)
        #expect(hiding.sprints == [17] && hiding.reach(game) == 5)
        #expect(!hiding.canTap(42, in: game))
        for card in [1, 2, 3, 4, 8, 18] { hiding.tap(card, in: game) }
        #expect(hiding.canHide(game))
        #expect(hiding.hint(game) == "Hide at 11 · reach 3 + 8 from 1, 2, 3, 4, 8, 17, 18 = 11. Tap cards to add or take them off.")

        // The hideout again starts over.
        hiding.tap(11, in: game)
        #expect(hiding == FugitiveHiding())
    }

    @Test func aHandThatCantReachOnSaysSo() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("hiding-\(UUID().uuidString)")
        let table = OfflineTable(shelf: OfflineShelf(folder: folder))
        let decks = [[5, 6, 7, 9, 10, 12, 13, 14, 11, 8, 4],
                     [15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 18, 17],
                     Array(29...41)]
        let code = try table.create(fugitive: "Ana", marshal: "Ben", decks: decks).code
        let token = try #require(try await table.fugitiveClaim(code: code, role: .fugitive).seatToken)
        // 11 first, which takes every footprint in hand: only 42 is left, and it's out of reach.
        let first = try await table.fugitiveMove(code: code, FugitiveMove(type: .hide, card: 11, sprints: [1, 2, 3, 4, 8, 17, 18], seq: 0),
                                                 token: token).game
        #expect(first.hand == [42])
        #expect(FugitiveHiding.heading(first) == "First turn · hideout 2 of 2, or stop at one")
        #expect(FugitiveHiding().hint(first) == "Nothing in your hand reaches on from 11 — stop at one.")
        #expect(FugitiveHiding.passLabel(first) == "Done — one is enough")

        // Round to the Fugitive's next turn: lying low there draws from the
        // lowest deck with cards — 4–14, and says so.
        var game = try await table.fugitiveMove(code: code, FugitiveMove(type: .pass, seq: first.seq), token: token).game
        let marshal = try #require(try await table.fugitiveClaim(code: code, role: .marshal).seatToken)
        for _ in 0..<2 {
            game = try await table.fugitiveMove(code: code, FugitiveMove(type: .draw, deck: 2, seq: game.seq), token: marshal).game
        }
        game = try await table.fugitiveMove(code: code, FugitiveMove(type: .guess, numbers: [5], seq: game.seq), token: marshal).game
        game = try await table.fugitiveMove(code: code, FugitiveMove(type: .draw, deck: 1, seq: game.seq), token: token).game
        #expect(game.phase == .fugitiveHide && !game.firstTurn)
        #expect(FugitiveHiding.heading(game) == nil)
        #expect(FugitiveHiding.passLabel(game) == "Lie low · draw from 4–14")
    }

    @Test func aHideoutInReachCanStillHaveABluffTuckedUnderIt() async throws {
        let game = try await firstTurn()
        var hiding = FugitiveHiding()
        // No hideout yet, so nothing to sprint to.
        hiding.switchTo(.sprint)
        #expect(hiding.mode == .hideout)
        #expect(!hiding.canTap(17, in: game))

        hiding.tap(3, in: game)
        #expect(hiding.mode == .hideout)
        #expect(hiding.hint(game) == "Hide at 3. Switch to Sprint to tuck cards under it as a bluff.")
        hiding.switchTo(.sprint)
        hiding.tap(4, in: game)
        #expect(hiding.pick == 3 && hiding.sprints == [4] && hiding.canHide(game))
        // Back to choosing: another card moves the hideout and keeps the sprint.
        hiding.switchTo(.hideout)
        hiding.tap(2, in: game)
        #expect(hiding.pick == 2 && hiding.sprints == [4])
    }

    /// Without hints: any card on from the trail can be the hideout, nothing
    /// switches to Sprint for you, and the hint names only what's chosen.
    @Test func withoutHintsTheHandOnlySaysWhatsChosen() async throws {
        let game = try await firstTurn()
        var hiding = FugitiveHiding(hints: false)
        // 17 is out of reach, and with hints it couldn't be tapped.
        #expect(hiding.canTap(17, in: game) && !FugitiveHiding().canTap(17, in: game))
        hiding.tap(11, in: game)
        // Out of free reach, but it stays on Hideout: switching would say so.
        #expect(hiding.pick == 11 && hiding.mode == .hideout)
        #expect(hiding.canHide(game))
        #expect(hiding.hint(game) == "Hide at 11.")
        hiding.switchTo(.sprint)
        hiding.tap(1, in: game)
        #expect(hiding.hint(game) == "Hide at 11 with 1 sprint card.")
        hiding.tap(11, in: game)
        #expect(hiding == FugitiveHiding(hints: false))
    }
}
