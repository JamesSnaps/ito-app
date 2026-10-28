import Foundation
import Testing
@testable import GameNight

/// The Swift AI against ai.py: the Flask suite plays seeded games with the
/// computer in one seat or both and writes down every move, marking the
/// computer's (tests/test_fugitive_ai.py). Here the same games are dealt
/// and replayed, and at every move the computer made, the Swift AI must
/// choose exactly that move from that seat's view.
@Suite struct FugitiveAITests {
    @Test func mulberry32DrawsTheSameNumbersAsThePython() throws {
        let root = try Self.root()
        var rng = Mulberry32(1)
        #expect((0..<5).map { _ in rng.next() } == (root["mulberry32_seed_1"] as? [Int])?.map(UInt32.init))
        var perMove = FugitiveAI.moveRNG(seed: 7, seq: 3)
        #expect([perMove.next()] == (root["move_rng_seed_7_seq_3"] as? [Int])?.map(UInt32.init))
    }

    @Test func everyScriptedGameChoosesTheSameAsAiPy() throws {
        let games = try #require(try Self.root()["games"] as? [[String: Any]])
        #expect(games.count >= 8)
        var chosen = 0
        var levelsSeen: Set<String> = []

        for game in games {
            let levels = try #require(game["levels"] as? [String: String])
            let seed = UInt32(try #require(game["seed"] as? Int))
            var state = FugitiveEngine.newGame(decks: try #require(game["decks"] as? [[Int]]))

            for (number, step) in try #require(game["steps"] as? [[String: Any]]).enumerated() {
                let label = "seed \(seed), \(levels), step \(number)"
                let role = try #require(FugitiveRole(rawValue: step["role"] as? String ?? ""))
                let move = try JSONDecoder().decode(FugitiveEngineTests.ScriptMove.self,
                                                    from: JSONSerialization.data(withJSONObject: step["move"] ?? [:])).move
                if step["computer"] as? Bool == true {
                    let level = try #require(FugitiveAI.Level(rawValue: levels[role.rawValue] ?? ""))
                    levelsSeen.insert("\(role.rawValue) \(level.rawValue)")
                    var rng = FugitiveAI.moveRNG(seed: seed, seq: state.seq)
                    let mine = try FugitiveAI.choose(FugitiveEngine.view(state, viewer: role), level: level, rng: &rng)
                    #expect(mine.seq == state.seq, "\(label)")
                    #expect(Self.unsequenced(mine) == move, "\(label)")
                    chosen += 1
                }
                state = try FugitiveEngine.apply(state, role: role, move: move)
            }
            #expect(state.reason == game["reason"] as? String, "seed \(seed)")
        }
        #expect(chosen > 200)
        #expect(levelsSeen.count == 4)
    }

    @Test func theComputerOnlyMovesOnItsOwnTurn() {
        let state = FugitiveEngine.newGame(decks: FugitiveEngine.deckRanges.map { Array($0) })
        var rng = Mulberry32(1)
        #expect(throws: FugitiveAI.NotItsTurn.self) {
            try FugitiveAI.choose(FugitiveEngine.view(state, viewer: .marshal), level: .hard, rng: &rng)
        }
        #expect(throws: FugitiveAI.NotItsTurn.self) {
            try FugitiveAI.choose(FugitiveEngine.view(state, viewer: nil), level: .hard, rng: &rng)
        }
    }

    // MARK: - helpers

    static func root() throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: FugitiveEngineTests.fixture("fugitive_ai_games")) as? [String: Any])
    }

    /// The fixture's moves carry no `seq`; ScriptMove reads them with 0.
    static func unsequenced(_ move: FugitiveMove) -> FugitiveMove {
        FugitiveMove(type: move.type, deck: move.deck, card: move.card, sprints: move.sprints,
                     numbers: move.numbers, seq: 0)
    }
}
