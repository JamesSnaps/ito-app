import Foundation
import Testing
@testable import GameNight

/// The fixtures are real responses from the Flask server code
/// (see tests/test_flip7_play_api.py, which checks they still match it).
func fixture(_ name: String) throws -> PlayPayload {
    let bundle = Bundle(for: BundleToken.self)
    let url = try #require(bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
                           ?? bundle.url(forResource: name, withExtension: "json"))
    return try GameNightClient.decoder.decode(PlayPayload.self, from: Data(contentsOf: url))
}

private final class BundleToken {}

@Suite struct ModelTests {
    @Test func aNewGameDecodes() throws {
        let payload = try fixture("play_created")
        #expect(payload.code.count == 4)
        #expect(payload.hostToken != nil)
        #expect(payload.you.role == .host)
        #expect(payload.game.phase == .playing)
        #expect(payload.game.players.map(\.name) == ["Ana", "Ben", "Cat"])
        #expect(payload.seats.count == 3)
        #expect(payload.game.pending != nil)
    }

    @Test func aCardWaitingToBeGivenDecodes() throws {
        let game = try fixture("play_give").game
        let pending = try #require(game.pending)
        #expect(pending.kind == .give)
        #expect(Card(try #require(pending.card))?.isAction == true)
        #expect(pending.options?.isEmpty == false)
    }

    @Test func theEndOfARoundAndAGameDecode() throws {
        let round = try fixture("play_round_over").game
        #expect(round.phase == .roundOver)
        #expect(round.lastRound != nil)
        #expect(round.players.allSatisfy { $0.rounds.count == 1 })

        let over = try fixture("play_game_over").game
        #expect(over.phase == .gameOver)
        #expect(!over.winners.isEmpty)
        #expect(over.winners.allSatisfy { over.players[$0].total >= over.target })
    }

    @Test func everyLogEntryReadsAsASentence() throws {
        let game = try fixture("play_game_over").game
        let names = game.players.map(\.name)
        for event in game.log {
            #expect(event.describe(names: names) != nil, "no wording for \(event.kind)")
        }
    }

    @Test func movesEncodeTheWayTheServerReadsThem() throws {
        let data = try JSONEncoder().encode(Move(type: .nextRound, player: nil, target: nil, seq: 7))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["type"] as? String == "next_round")
        #expect(json["seq"] as? Int == 7)
        // Left out, not null: the engine reads a missing player as "nobody".
        #expect(json["player"] == nil)
    }
}

@Suite struct CardTests {
    @Test func idsRoundTrip() {
        for id in ["n0", "n7", "n12", "+2", "+10", "x2", "freeze", "flip3", "chance"] {
            #expect(Card(id)?.id == id)
        }
        #expect(Card("n") == nil)
        #expect(Card("joker") == nil)
    }

    @Test func articlesReadNaturally() {
        #expect(Card.number(8).withArticle == "an 8")
        #expect(Card.number(11).withArticle == "an 11")
        #expect(Card.number(7).withArticle == "a 7")
        #expect(Card.times2.withArticle == "the ×2")
        #expect(Card.flipThree.withArticle == "a Flip Three")
    }

    @Test func aMatIsLaidOutLikeTheWebTable() {
        let hand = Hand(numbers: [9, 2, 5], mods: [8, 2], x2: true, chance: true,
                        actions: ["freeze"], held: ["flip3"], bustCard: 5)
        #expect(hand.tableCards.map(\.card.id) == ["n2", "n5", "n9", "n5", "+2", "+8", "x2", "chance", "freeze", "flip3"])
        // Two 5s still get distinct identities, so SwiftUI can animate them.
        #expect(Set(hand.tableCards.map(\.id)).count == hand.tableCards.count)
        #expect(hand.tableCards[3].role == .bust)
    }
}

@Suite struct SettingsTests {
    @Test func serverAddressesAreTidied() {
        #expect(AppSettings.normalised("gamenight.example.com/")?.absoluteString == "https://gamenight.example.com")
        #expect(AppSettings.normalised("http://192.168.1.20:5000")?.absoluteString == "http://192.168.1.20:5000")
        #expect(AppSettings.normalised("ftp://nope") == nil)
        #expect(AppSettings.normalised("  ") == nil)
    }
}

@Suite struct JoiningTests {
    @Test func codesComeOutOfEveryKindOfLink() {
        let cases: [(String, String?)] = [
            ("https://gamenight.collardserver.co.uk/flip7/play/ABCD", "ABCD"),
            ("https://gamenight.collardserver.co.uk/flip7/watch/wxyz", "WXYZ"),
            ("https://gamenight.collardserver.co.uk/ito/play/K7M3", "K7M3"),
            ("https://gamenight.collardserver.co.uk/join?code=k7m3", "K7M3"),
            ("gamenight://join/ABCD", "ABCD"),
            ("https://gamenight.collardserver.co.uk/flip7/rules", nil),
            // I, O, 0 and 1 are never in a code.
            ("gamenight://join/IO01", nil),
        ]
        for (link, code) in cases {
            #expect(Joining.code(in: URL(string: link)!) == code, "\(link)")
        }
    }

    @Test func itoTopicsSplitTheirInstructionOff() {
        #expect(ItoCardFront.split("Things you’d do on holiday (mime it)") == ("Things you’d do on holiday", "mime it"))
        #expect(ItoCardFront.split("Plain topic") == ("Plain topic", ""))
    }

    @Test func statsAndItoStateDecode() throws {
        let stats = """
        {"games_played": 2, "players": {}, "best_round": {"score": 61, "player": "Ana"},
         "recent": [{"at": "2026-10-24T17:51:04+00:00", "winner": "Ana", "score": 264, "players": 5}],
         "leaderboard": [{"name": "Ana", "games": 2, "wins": 2, "points": 400, "rounds": 10,
                          "best_game": 264, "best_round": 61, "flip7s": 1, "busts": 3, "average": 40.0}]}
        """
        let decoded = try GameNightClient.decoder.decode(Flip7Stats.self, from: Data(stats.utf8))
        #expect(decoded.leaderboard.first?.bestGame == 264)

        let ito = """
        {"code": "ABCD", "current_topic": null, "current_category": null, "current_low": null,
         "current_high": null, "current_type": null, "round_number": 0, "draw_id": 0,
         "used": [], "scored": false}
        """
        #expect(try GameNightClient.decoder.decode(ItoState.self, from: Data(ito.utf8)).drawId == 0)
    }

    @Test func signingOutSaysWhetherTheProfileWentWithIt() throws {
        func decode(_ json: String) throws -> Bool? {
            try GameNightClient.decoder.decode(Forgotten.self, from: Data(json.utf8)).deleted
        }
        #expect(try decode(#"{"forgotten": true, "deleted": true}"#) == true)
        #expect(try decode(#"{"forgotten": true, "deleted": false}"#) == false)
        // A server before 1.8.1 doesn't say.
        #expect(try decode(#"{"forgotten": true}"#) == nil)
    }
}
