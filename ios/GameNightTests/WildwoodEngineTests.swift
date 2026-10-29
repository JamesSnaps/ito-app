import Foundation
import Testing
@testable import GameNight

/// The Swift engine and computer against engine.py and ai.py: the Flask suite
/// plays seeded games and writes down what happened (tests/
/// test_wildwood_offline.py). Here the same moves are replayed, and every
/// state, refusal, view and computer choice must come out the same.
@Suite struct WildwoodEngineTests {
    /// The state after a move, as the script writes it: everything but the
    /// log, with the piles as sizes and the next three cards to draw.
    struct Digest: Decodable, Equatable {
        let hands: [[String]]
        let colour: String
        let turn: Int
        let direction: Int
        let stack: Int
        let drawn: String?
        let exposed: Int?
        let reshuffles: Int
        let phase: String
        let winner: Int?
        let event: Int
        let seq: Int
        let drawCount: Int
        let drawTop: [String]
        let discardCount: Int
        let top: String

        init(_ s: WildwoodState) {
            hands = s.hands; colour = s.colour; turn = s.turn; direction = s.direction; stack = s.stack
            drawn = s.drawn; exposed = s.exposed; reshuffles = s.reshuffles; phase = s.phase; winner = s.winner
            event = s.event; seq = s.seq; drawCount = s.draw.count; drawTop = Array(s.draw.suffix(3))
            discardCount = s.discard.count; top = s.discard.last ?? ""
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            hands = try c.decode([[String]].self, forKey: .hands)
            colour = try c.decode(String.self, forKey: .colour)
            turn = try c.decode(Int.self, forKey: .turn)
            direction = try c.decode(Int.self, forKey: .direction)
            stack = try c.decode(Int.self, forKey: .stack)
            drawn = try c.decodeIfPresent(String.self, forKey: .drawn)
            exposed = try c.decodeIfPresent(Int.self, forKey: .exposed)
            reshuffles = try c.decode(Int.self, forKey: .reshuffles)
            phase = try c.decode(String.self, forKey: .phase)
            winner = try c.decodeIfPresent(Int.self, forKey: .winner)
            event = try c.decode(Int.self, forKey: .event)
            seq = try c.decode(Int.self, forKey: .seq)
            drawCount = try c.decode(Int.self, forKey: .drawCount)
            drawTop = try c.decode([String].self, forKey: .drawTop)
            discardCount = try c.decode(Int.self, forKey: .discardCount)
            top = try c.decode(String.self, forKey: .top)
        }

        enum CodingKeys: String, CodingKey {
            case hands, colour, turn, direction, stack, drawn, exposed, reshuffles, phase, winner, event, seq, top
            case drawCount, drawTop, discardCount
        }
    }

    struct Step: Decodable {
        let seat: Int
        let move: WildwoodMove
        let refused: String?
        let state: Digest?
        let last: WildwoodEvent?
        let views: [String: WildwoodGame]?
    }

    struct EngineGame: Decodable {
        let players: Int
        let deck: [String]
        let shuffleSeed: UInt32
        let first: Int
        let start: Start
        let steps: [Step]
        struct Start: Decodable { let state: Digest }
    }

    struct Scripts<Game: Decodable>: Decodable { let games: [Game] }

    struct AIGame: Decodable {
        struct Played: Decodable {
            let seat: Int
            let move: WildwoodMove
            let computer: Bool
        }
        let levels: [String?]
        let seed: UInt32
        let deck: [String]
        let shuffleSeed: UInt32
        let first: Int
        let moves: [Played]
        let winner: Int
    }

    static func fixture<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let candidates = [here.appendingPathComponent("Fixtures/\(name).json")]
            + [Bundle(for: Token.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
               Bundle(for: Token.self).url(forResource: name, withExtension: "json")].compactMap { $0 }
        let url = try #require(candidates.first { FileManager.default.fileExists(atPath: $0.path) })
        return try GameNightClient.decoder.decode(T.self, from: Data(contentsOf: url))
    }

    private final class Token {}

    @Test func everyScriptedGamePlaysTheSameAsEnginePy() throws {
        let games = try Self.fixture("wildwood_engine_games", as: Scripts<EngineGame>.self).games
        #expect(games.count >= 5)
        var refusals = 0, views = 0
        for game in games {
            var state = WildwoodEngine.newGame(players: game.players, deck: game.deck,
                                               shuffleSeed: game.shuffleSeed, first: game.first)
            #expect(Digest(state) == game.start.state)
            for (n, step) in game.steps.enumerated() {
                if let refused = step.refused {
                    let before = state
                    #expect(throws: IllegalMove(refused), "step \(n)") {
                        try WildwoodEngine.apply(&state, seat: step.seat, move: step.move)
                    }
                    #expect(state == before)
                    refusals += 1
                    continue
                }
                try WildwoodEngine.apply(&state, seat: step.seat, move: step.move)
                #expect(Digest(state) == step.state, "step \(n): \(step.move)")
                #expect(state.log.last == step.last, "step \(n)")
                for (viewer, expected) in step.views ?? [:] {
                    let who: WildwoodViewer = Int(viewer).map { .seat($0) } ?? .table
                    #expect(WildwoodEngine.view(state, viewer: who) == expected, "step \(n), viewer \(viewer)")
                    views += 1
                }
                if Digest(state) != step.state { return }
            }
            #expect(state.phase == "game_over")
        }
        #expect(refusals > 20 && views > 40)
    }

    @Test func theComputerChoosesWhatAiPyChose() throws {
        let games = try Self.fixture("wildwood_ai_games", as: Scripts<AIGame>.self).games
        #expect(games.count >= 7)
        var chosen = 0
        for game in games {
            var state = WildwoodEngine.newGame(players: game.levels.count, deck: game.deck,
                                               shuffleSeed: game.shuffleSeed, first: game.first)
            for (n, played) in game.moves.enumerated() {
                if played.computer, let raw = game.levels[played.seat], let level = WildwoodAI.Level(rawValue: raw) {
                    var rng = FugitiveAI.moveRNG(seed: game.seed, seq: state.seq)
                    let seen = WildwoodEngine.view(state, viewer: .seat(played.seat))
                    #expect(WildwoodAI.choose(seen, level: level, rng: &rng) == played.move, "move \(n)")
                    chosen += 1
                }
                try WildwoodEngine.apply(&state, seat: played.seat, move: played.move)
            }
            #expect(state.winner == game.winner)
        }
        #expect(chosen > 100)
    }

    @Test func theSameSeedShufflesTheSameWayAsCoreSeeded() {
        // core/seeded.py: Mulberry32(7).shuffle(list(range(10))).
        var rng = Mulberry32(7)
        var items = Array(0..<10)
        rng.shuffle(&items)
        #expect(items == Self.pythonShuffleOf10Seed7)
    }

    /// Written out by hand from Python, so a change to either shuffle shows.
    static let pythonShuffleOf10Seed7 = [0, 4, 8, 1, 7, 3, 5, 6, 9, 2]
}
