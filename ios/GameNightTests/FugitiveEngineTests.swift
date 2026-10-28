import Foundation
import Testing
@testable import GameNight

/// The Swift engine against engine.py: the Flask suite plays seeded games —
/// legal moves and refused ones — and writes down every view after every
/// move (tests/test_fugitive_offline.py). Here the same moves are replayed
/// and every view and every refusal must come out the same.
@Suite struct FugitiveEngineTests {
    /// A move as the script writes it: the server's move, minus `seq`.
    struct ScriptMove: Decodable {
        let type: FugitiveMove.Kind
        let deck: Int?
        let card: Int?
        let sprints: [Int]?
        let numbers: [Int]?

        var move: FugitiveMove {
            FugitiveMove(type: type, deck: deck, card: card, sprints: sprints, numbers: numbers, seq: 0)
        }
    }

    @Test func everyScriptedGamePlaysTheSameAsEnginePy() throws {
        let root = try #require(try JSONSerialization.jsonObject(with: Self.fixture("fugitive_engine_games")) as? [String: Any])
        let constants = try #require(root["constants"] as? [String: Any])
        let games = try #require(root["games"] as? [[String: Any]])
        #expect(games.count >= 6)
        var refusals = 0, views = 0

        for game in games {
            let seed = game["seed"] as? Int ?? -1
            let decks = try #require(game["decks"] as? [[Int]])
            var state = FugitiveEngine.newGame(decks: decks)
            try expectViews(state, game["start"], constants, "seed \(seed), the deal")

            for (number, step) in try #require(game["steps"] as? [[String: Any]]).enumerated() {
                let label = "seed \(seed), step \(number)"
                let role = try #require(FugitiveRole(rawValue: step["role"] as? String ?? ""))
                let move = try JSONDecoder().decode(ScriptMove.self,
                                                    from: JSONSerialization.data(withJSONObject: step["move"] ?? [:])).move
                if let expected = step["error"] as? String {
                    #expect(throws: IllegalMove(expected), "\(label)") {
                        try FugitiveEngine.apply(state, role: role, move: move)
                    }
                    refusals += 1
                } else {
                    state = try FugitiveEngine.apply(state, role: role, move: move)
                    try expectViews(state, step["views"], constants, label)
                    views += 3
                }
            }
            #expect(state.reason == game["reason"] as? String, "seed \(seed)")
        }
        #expect(refusals > 400 && views > 700)
    }

    @Test func aShuffledGameDealsTheFugitive_1_2_3_42AndFiveMore() {
        var rng = SystemRandomNumberGenerator()
        let state = FugitiveEngine.newGame(using: &rng)
        let hand = state.hand(.fugitive)
        #expect(hand.count == 9)
        #expect([1, 2, 3, 42].allSatisfy(hand.contains))
        #expect(state.decks.map(\.count) == [8, 12, 13])
        // Every card from 1 to 42 exactly once, between the hand and the decks.
        #expect((hand + state.decks.flatMap { $0 }).sorted() == Array(1...42))
    }

    @Test func aStateRoundTripsThroughThePythonJSONKeys() throws {
        var rng = SystemRandomNumberGenerator()
        let state = FugitiveEngine.newGame(using: &rng)
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        #expect(json["hides_left"] as? Int == 2 && json["first_turn"] as? Bool == true)
        #expect(json["marshal_has_played"] as? Bool == false && json["phase"] as? String == "fugitive_hide")
        #expect(try JSONDecoder().decode(FugitiveState.self, from: JSONEncoder().encode(state)) == state)
    }

    // MARK: - helpers

    private func expectViews(_ state: FugitiveState, _ raw: Any?, _ constants: [String: Any], _ label: String) throws {
        let expected = try #require(raw as? [String: [String: Any]], "\(label): no views")
        for (viewer, role) in [("fugitive", FugitiveRole.fugitive), ("marshal", .marshal), ("table", nil)] {
            var json = try #require(expected[viewer])
            for (key, value) in constants { json[key] = value }
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let want = try decoder.decode(FugitiveGame.self, from: JSONSerialization.data(withJSONObject: json))
            let got = FugitiveEngine.view(state, viewer: role)
            #expect(got == want, "\(label), \(viewer)'s view")
            if got != want { Self.explain(got, want, label: "\(label), \(viewer)") }
        }
    }

    /// Which part of a view differs, when one does — the whole struct is too
    /// long to read in a failure.
    private static func explain(_ got: FugitiveGame, _ want: FugitiveGame, label: String) {
        let parts: [(String, Bool)] = [
            ("phase/turn", got.phase == want.phase && got.turn == want.turn),
            ("counters", got.hidesLeft == want.hidesLeft && got.firstTurn == want.firstTurn && got.drawsLeft == want.drawsLeft),
            ("hideouts", got.hideouts == want.hideouts),
            ("decks", got.deckCounts == want.deckCounts),
            ("hand", got.hand == want.hand && got.handCounts == want.handCounts),
            ("end", got.winner == want.winner && got.reason == want.reason),
            ("log", got.log == want.log),
            ("seq", got.seq == want.seq),
            ("candidates", got.candidates == want.candidates),
        ]
        for (name, same) in parts where !same { print("\(label): \(name) differs") }
        if got.deckCounts != want.deckCounts || got.hand != want.hand {
            print("  decks got \(got.deckCounts) want \(want.deckCounts); hand got \(got.hand ?? []) want \(want.hand ?? [])")
        }
        if got.candidates != want.candidates {
            print("  got  \(got.candidates ?? [])\n  want \(want.candidates ?? [])")
        }
    }

    /// The fixture from the test bundle, or beside this file when the tests
    /// run from a Swift package (as they do on Linux).
    static func fixture(_ name: String, file: String = #filePath) throws -> Data {
        let here = URL(fileURLWithPath: file).deletingLastPathComponent()
        let candidates = [
            Bundle(for: EngineFixtureToken.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
            Bundle(for: EngineFixtureToken.self).url(forResource: name, withExtension: "json"),
            here.appendingPathComponent("Fixtures/\(name).json"),
        ]
        let url = try #require(candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) })
        return try Data(contentsOf: url)
    }
}

private final class EngineFixtureToken {}
