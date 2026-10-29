import Foundation
import Testing
@testable import GameNight

/// The Wildwood fixtures are real responses from one scripted table
/// (`wildwood_fixtures` in tests/test_wildwood_play_api.py, which also checks
/// they still match the API). Each capture deals differently, so these check
/// how the payload hangs together, not which cards were dealt.
private func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
    let bundle = Bundle(for: FixtureToken.self)
    let url = try #require(bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
                           ?? bundle.url(forResource: name, withExtension: "json"))
    return try GameNightClient.decoder.decode(T.self, from: Data(contentsOf: url))
}

private final class FixtureToken {}

@MainActor @Suite struct WildwoodModelTests {
    @Test func aNewTableShowsTheDealerNoHand() throws {
        let payload = try load("wildwood_created", as: WildwoodPayload.self)
        #expect(payload.hostToken != nil && payload.inviteUrl != nil)
        #expect(payload.you.role == "host" && payload.you.seat == nil)
        #expect(payload.players == ["Ana", "Ben"])
        let game = payload.game
        #expect(game.viewer == .table && game.mySeat == nil && !game.myTurn)
        #expect(game.hand == nil && game.hands == nil && game.playable.isEmpty)
        #expect(game.handCounts == [7, 7])
        #expect(game.log.first?.kind == "deal")
        #expect(WildwoodCard.colours.contains(game.colour))
    }

    @Test func aSeatSeesItsOwnHandAndWhatItCanPlay() throws {
        let payload = try load("wildwood_seat", as: WildwoodPayload.self)
        let game = payload.game
        #expect(payload.you.seat == 0 && game.viewer == .seat(0) && game.myTurn)
        let hand = try #require(game.hand)
        #expect(hand.count == game.handCounts[0])
        #expect(game.playable.allSatisfy(hand.contains))
        // Someone else's draw says how many, not which.
        for event in game.log where event.kind == "draw" && event.seat != 0 {
            #expect(event.cards == nil)
        }
    }

    @Test func theEndTurnsEveryHandUp() throws {
        let game = try load("wildwood_game_over", as: WildwoodPayload.self).game
        #expect(game.isOver && game.turn == nil)
        let winner = try #require(game.winner)
        let hands = try #require(game.hands)
        #expect(hands[winner].isEmpty)
        #expect(game.log.last?.kind == "game_over" && game.log.last?.winner == winner)
    }

    @Test func theRecordsKeepTheComputerApart() throws {
        let stats = try load("wildwood_stats", as: WildwoodStats.self)
        #expect(stats.gamesPlayed == 1 && stats.leaderboard.count == 2)
        #expect(stats.computer.gamesPlayed == 1)
        #expect(stats.computerLeaderboard.map(\.name) == ["Cy"])
        #expect(stats.computerLeaderboard.first?.easyGames == 1)
    }

    @Test func cardsReadAsTheyLook() {
        #expect(WildwoodCard.label("r7") == "red 7")
        #expect(WildwoodCard.label("gS") == "green Skip")
        #expect(WildwoodCard.label("W4") == "Bear wild +4")
        #expect(WildwoodCard.colour("bD") == "b" && WildwoodCard.symbol("bD") == "D")
        #expect(WildwoodCard.colour("W") == nil && WildwoodCard.isWild("W"))
        #expect(WildwoodCard.asset(nil) == "wildwood-card-back")
    }

    @Test func aDeviceWithSeveralSeatsAsksAsTheTable() {
        var device = WildwoodDevice(host: "host")
        #expect(device.askingToken == "host")
        device.setSeat(1, "one")
        #expect(device.askingToken == "one" && !device.passAndPlay)
        device.setSeat(0, "zero")
        #expect(device.seats == [0, 1] && device.passAndPlay && device.askingToken == "host")
    }
}
