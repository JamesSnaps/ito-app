import Foundation

// games/fugitive/engine.py in Swift, for playing with no server — on a plane.
//
// This is the one deliberate exception to "the rules live in engine.py": a
// game with no signal has nowhere else to run. So it's a port, line for
// line, not a reinterpretation — same state, same order of checks, same
// refusals word for word — and it's pinned to the Python by scripted games
// the Flask suite writes out (tests/test_fugitive_offline.py →
// GameNightTests/Fixtures/fugitive_engine_games.json) and FugitiveEngineTests
// replays. Change engine.py, rewrite the fixture, then make this agree.
//
// The state is the Python dict's shape (the same JSON keys), so an offline
// game can be sent home and replayed there.

/// A move the rules don't allow right now. The message is player-facing.
nonisolated struct IllegalMove: Error, Equatable {
    let message: String
    init(_ message: String) { self.message = message }
}

/// The whole game, as engine.py keeps it.
nonisolated struct FugitiveState: Codable, Equatable {
    nonisolated struct Placed: Codable, Equatable {
        var card: Int
        var sprints: [Int]
        var revealed: Bool
    }

    /// A log entry: only the fields its kind uses are set.
    nonisolated struct Entry: Codable, Equatable {
        var id: Int
        var kind: String
        var role: FugitiveRole?
        var deck: Int?
        var card: Int?
        var index: Int?
        var sprints: [Int]?
        var numbers: [Int]?
        var hit: Bool?
        var revealed: [Int]?
        var winner: FugitiveRole?
        var reason: String?
    }

    var decks: [[Int]]
    /// Keyed "fugitive" / "marshal", as the JSON is.
    var hands: [String: [Int]]
    var hideouts: [Placed]
    var phase: FugitiveGame.Phase
    var hidesLeft: Int
    var placed: Int
    var firstTurn: Bool
    var drawsLeft: Int
    var marshalHasPlayed: Bool
    var winner: FugitiveRole?
    /// caught | escaped | manhunt_failed | let_go | resigned
    var reason: String?
    var log: [Entry]
    var event: Int
    var seq: Int

    func hand(_ role: FugitiveRole) -> [Int] { hands[role.rawValue] ?? [] }

    enum CodingKeys: String, CodingKey {
        case decks, hands, hideouts, phase, placed, winner, reason, log, event, seq
        case hidesLeft = "hides_left"
        case firstTurn = "first_turn"
        case drawsLeft = "draws_left"
        case marshalHasPlayed = "marshal_has_played"
    }
}

nonisolated enum FugitiveEngine {
    static let startCard = 0
    static let escapeCard = 42
    /// Inclusive ranges, drawn from the end of each list.
    static let deckRanges: [ClosedRange<Int>] = [4...14, 15...28, 29...41]
    static let startingCards = [1, 2, 3, 42]
    static let startingDraws = [3, 2, 0]
    static let maxStep = 3
    static let firstTurnHideouts = 2
    static let marshalFirstDraws = 2
    /// A Manhunt is only on while no hideout above this has been revealed.
    static let manhuntMaxRevealed = 29
    /// engine.py's placeholder spread, until it's read off the cards.
    static let twoFootprints: Set<Int> = [6, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40]
    static let maxFootprints = 2

    static func footprints(_ card: Int) -> Int {
        if card == escapeCard { return 0 }
        return twoFootprints.contains(card) ? 2 : 1
    }

    // MARK: - a new game

    /// A fresh game, shuffled with `rng`.
    static func newGame<R: RandomNumberGenerator>(using rng: inout R) -> FugitiveState {
        newGame(decks: deckRanges.map { Array($0).shuffled(using: &rng) })
    }

    /// A fresh game from decks as they'll be drawn, top card last — how a
    /// game is replayed, and how the tests rig one.
    static func newGame(decks: [[Int]]) -> FugitiveState {
        var decks = decks
        var hand = startingCards
        for (index, count) in startingDraws.enumerated() {
            for _ in 0..<count { hand.append(decks[index].removeLast()) }
        }
        return FugitiveState(
            decks: decks,
            hands: ["fugitive": hand.sorted(), "marshal": []],
            hideouts: [.init(card: startCard, sprints: [], revealed: true)],
            phase: .fugitiveHide,
            hidesLeft: firstTurnHideouts,
            placed: 0,
            firstTurn: true,
            drawsLeft: 0,
            marshalHasPlayed: false,
            winner: nil,
            reason: nil,
            log: [],
            event: 0,
            seq: 0)
    }

    /// Whose move it is, or nil once it's over.
    static func turn(_ state: FugitiveState) -> FugitiveRole? {
        switch state.phase {
        case .fugitiveDraw, .fugitiveHide: .fugitive
        case .marshalDraw, .marshalGuess, .manhunt: .marshal
        case .gameOver: nil
        }
    }

    // MARK: - moves

    /// Play one move for `role`. Returns the new state, or throws
    /// IllegalMove and leaves `state` as it was.
    static func apply(_ state: FugitiveState, role: FugitiveRole, move: FugitiveMove) throws -> FugitiveState {
        var s = state
        if s.phase == .gameOver { throw IllegalMove("The game is over.") }
        if move.type == .resign {
            end(&s, winner: role.other, reason: "resigned")
        } else if turn(s) != role {
            throw IllegalMove("It isn't your turn.")
        } else {
            switch s.phase {
            case .fugitiveDraw, .marshalDraw: try drawMove(&s, role: role, move: move)
            case .fugitiveHide: try hideMove(&s, move: move)
            case .marshalGuess: try guessMove(&s, move: move)
            default: try manhuntMove(&s, move: move)
            }
        }
        s.seq += 1
        return s
    }

    /// Why the Fugitive can't hide at `card` with `sprints` under it, or nil.
    static func hideError(_ state: FugitiveState, card: Int?, sprints: [Int]) -> String? {
        let hand = state.hand(.fugitive)
        guard let card else { return "Pick a card to hide, and the cards to sprint with." }
        if !hand.contains(card) { return "You don't hold \(card)." }
        if Set(sprints).count != sprints.count { return "A card can only be used once." }
        for c in sprints {
            if c == card { return "A card can't be the hideout and a sprint." }
            if !hand.contains(c) { return "You don't hold \(c)." }
            if footprints(c) == 0 { return "\(c) can't be used to sprint." }
        }
        let last = lastCard(state)
        if card <= last { return "Hideouts have to go up — your last was \(last)." }
        let reach = maxStep + sprints.reduce(0) { $0 + footprints($1) }
        if card - last > reach {
            return "\(card) is \(card - last) past \(last); that only reaches \(last + reach)."
        }
        return nil
    }

    private static func drawMove(_ s: inout FugitiveState, role: FugitiveRole, move: FugitiveMove) throws {
        guard move.type == .draw else { throw IllegalMove("Draw a card first.") }
        guard let deck = move.deck, s.decks.indices.contains(deck) else { throw IllegalMove("No such deck.") }
        guard !s.decks[deck].isEmpty else { throw IllegalMove("That deck is empty.") }
        draw(&s, role: role, deck: deck)

        if role == .fugitive {
            fugitiveHides(&s, firstTurn: false)
        } else {
            s.drawsLeft -= 1
            if s.drawsLeft == 0 || decksEmpty(s) { s.phase = .marshalGuess }
        }
    }

    private static func hideMove(_ s: inout FugitiveState, move: FugitiveMove) throws {
        if move.type == .pass {
            if s.firstTurn && s.placed == 0 {
                throw IllegalMove("Place at least one hideout on your first turn.")
            }
            if s.placed == 0 {
                log(&s, kind: "passed")
                // Not hiding buys a card from the lowest deck that has any.
                if let lowest = s.decks.firstIndex(where: { !$0.isEmpty }) {
                    draw(&s, role: .fugitive, deck: lowest)
                }
            }
            marshalsTurn(&s)
            return
        }
        guard move.type == .hide else { throw IllegalMove("Hide somewhere, or draw instead.") }

        let sprints = move.sprints ?? []
        if let error = hideError(s, card: move.card, sprints: sprints) { throw IllegalMove(error) }
        guard let card = move.card else { return }
        let used = Set(sprints + [card])
        s.hands["fugitive"] = s.hand(.fugitive).filter { !used.contains($0) }
        let escaped = card == escapeCard
        s.hideouts.append(.init(card: card, sprints: sprints.sorted(), revealed: escaped))
        var entry = blank(&s, kind: "hid")
        entry.index = s.hideouts.count - 1
        entry.card = card
        entry.sprints = sprints.sorted()
        s.log.append(entry)

        if escaped {
            escape(&s)
            return
        }
        s.hidesLeft -= 1
        s.placed += 1
        if s.hidesLeft == 0 { marshalsTurn(&s) }
    }

    private static func guessMove(_ s: inout FugitiveState, move: FugitiveMove) throws {
        guard move.type == .guess else { throw IllegalMove("Guess where the Fugitive is.") }
        let numbers = try checkGuess(s, move.numbers)
        resolveGuess(&s, numbers)
        if s.phase == .gameOver { return }
        s.marshalHasPlayed = true
        fugitiveHides(&s, firstTurn: false, drawFirst: true)
    }

    private static func manhuntMove(_ s: inout FugitiveState, move: FugitiveMove) throws {
        if move.type == .letGo {
            end(&s, winner: .fugitive, reason: "let_go")
            return
        }
        guard move.type == .guess else { throw IllegalMove("Guess a hideout, or let the Fugitive go.") }
        let numbers = try checkGuess(s, move.numbers)
        guard numbers.count == 1 else { throw IllegalMove("In a Manhunt, guess one hideout at a time.") }
        if !resolveGuess(&s, numbers) { end(&s, winner: .fugitive, reason: "manhunt_failed") }
    }

    private static func checkGuess(_ s: FugitiveState, _ numbers: [Int]?) throws -> [Int] {
        guard let numbers, !numbers.isEmpty else { throw IllegalMove("Guess at least one number.") }
        if Set(numbers).count != numbers.count { throw IllegalMove("Each number can only be guessed once.") }
        let revealed = Set(s.hideouts.filter(\.revealed).map(\.card))
        for n in numbers {
            if !(startCard < n && n < escapeCard) {
                throw IllegalMove("\(n) isn't a hideout number — guess 1 to 41.")
            }
            if revealed.contains(n) { throw IllegalMove("\(n) is already turned over.") }
        }
        return numbers
    }

    /// Several numbers at once reveal nothing unless every one is right.
    @discardableResult
    private static func resolveGuess(_ s: inout FugitiveState, _ numbers: [Int]) -> Bool {
        var hidden: [Int: Int] = [:]
        for (i, h) in s.hideouts.enumerated() where !h.revealed { hidden[h.card] = i }
        let hit = numbers.allSatisfy { hidden[$0] != nil }
        let revealed = hit ? numbers.compactMap { hidden[$0] }.sorted() : []
        for i in revealed { s.hideouts[i].revealed = true }
        var entry = blank(&s, kind: "guessed")
        entry.numbers = numbers
        entry.hit = hit
        entry.revealed = revealed
        s.log.append(entry)
        if hit && s.hideouts.allSatisfy(\.revealed) { end(&s, winner: .marshal, reason: "caught") }
        return hit
    }

    private static func escape(_ s: inout FugitiveState) {
        let highest = s.hideouts.filter { $0.revealed && $0.card != escapeCard }.map(\.card).max() ?? startCard
        if highest <= manhuntMaxRevealed && s.hideouts.contains(where: { !$0.revealed }) {
            s.phase = .manhunt
            log(&s, kind: "manhunt")
        } else {
            end(&s, winner: .fugitive, reason: "escaped")
        }
    }

    private static func fugitiveHides(_ s: inout FugitiveState, firstTurn: Bool, drawFirst: Bool = false) {
        s.firstTurn = firstTurn
        s.hidesLeft = 1
        s.placed = 0
        s.phase = drawFirst && !decksEmpty(s) ? .fugitiveDraw : .fugitiveHide
    }

    private static func marshalsTurn(_ s: inout FugitiveState) {
        s.hidesLeft = 0
        s.firstTurn = false
        if decksEmpty(s) {
            s.phase = .marshalGuess
        } else {
            s.phase = .marshalDraw
            s.drawsLeft = s.marshalHasPlayed ? 1 : marshalFirstDraws
        }
    }

    private static func draw(_ s: inout FugitiveState, role: FugitiveRole, deck: Int) {
        let card = s.decks[deck].removeLast()
        s.hands[role.rawValue] = (s.hand(role) + [card]).sorted()
        var entry = blank(&s, kind: "drew")
        entry.role = role
        entry.deck = deck
        entry.card = card
        s.log.append(entry)
    }

    private static func end(_ s: inout FugitiveState, winner: FugitiveRole, reason: String) {
        s.phase = .gameOver
        s.winner = winner
        s.reason = reason
        s.hidesLeft = 0
        s.drawsLeft = 0
        var entry = blank(&s, kind: "game_over")
        entry.winner = winner
        entry.reason = reason
        s.log.append(entry)
    }

    private static func log(_ s: inout FugitiveState, kind: String) {
        s.log.append(blank(&s, kind: kind))
    }

    /// The next log entry's id and kind; the caller fills in the rest.
    private static func blank(_ s: inout FugitiveState, kind: String) -> FugitiveState.Entry {
        s.event += 1
        return .init(id: s.event, kind: kind)
    }

    private static func lastCard(_ s: FugitiveState) -> Int { s.hideouts.last?.card ?? startCard }
    private static func decksEmpty(_ s: FugitiveState) -> Bool { s.decks.allSatisfy(\.isEmpty) }

    // MARK: - what each seat sees

    /// engine.view, plus the Marshal's notepad help exactly as game.payload
    /// adds it — the same FugitiveGame the server sends, so the screens
    /// can't tell an offline game from an online one.
    static func view(_ state: FugitiveState, viewer: FugitiveRole?) -> FugitiveGame {
        let over = state.phase == .gameOver
        let fugitive = viewer == .fugitive

        let hideouts = state.hideouts.map { h in
            let shown = fugitive || over || h.revealed
            let sprintsShown = fugitive || over || (h.revealed && h.card != escapeCard)
            return Hideout(card: shown ? h.card : nil, sprintCount: h.sprints.count,
                           sprints: sprintsShown ? h.sprints : nil, revealed: h.revealed)
        }

        let log = state.log.map { entry in
            var card = entry.card
            var sprints = entry.sprints
            if entry.kind == "drew" && !(over || entry.role == viewer) {
                card = nil
            } else if entry.kind == "hid", let index = entry.index {
                card = hideouts[index].card
                sprints = hideouts[index].sprints
            }
            return FugitiveEvent(id: entry.id, kind: entry.kind, role: entry.role, deck: entry.deck, card: card,
                                 index: entry.index, sprints: sprints, numbers: entry.numbers, hit: entry.hit,
                                 revealed: entry.revealed, winner: entry.winner, reason: entry.reason)
        }

        var seen = FugitiveGame(
            viewer: viewer?.rawValue ?? "table",
            phase: state.phase,
            turn: turn(state),
            hidesLeft: state.hidesLeft,
            firstTurn: state.firstTurn,
            drawsLeft: state.drawsLeft,
            hideouts: hideouts,
            deckCounts: state.decks.map(\.count),
            decks: deckRanges.map { [$0.lowerBound, $0.upperBound] },
            hand: viewer.map { state.hand($0) },
            handCounts: Dictionary(uniqueKeysWithValues: FugitiveRole.allCases.map { ($0.rawValue, state.hand($0).count) }),
            footprints: Dictionary(uniqueKeysWithValues: (startCard...escapeCard).map { (String($0), footprints($0)) }),
            maxStep: maxStep,
            winner: state.winner,
            reason: state.reason,
            log: log,
            seq: state.seq,
            candidates: nil)
        // The Marshal's notepad help, worked out from the Marshal's own view.
        if viewer == .marshal && !over {
            seen = seen.with(candidates: candidates(seen))
        }
        return seen
    }

    /// engine.candidates: every number each hideout could still be, from
    /// what this view can see. It must never rule out the truth.
    static func candidates(_ seen: FugitiveGame) -> [[Int]] {
        let hideouts = seen.hideouts
        let n = hideouts.count

        var excluded: Set<Int> = seen.viewer == "marshal" ? Set(seen.hand ?? []) : []
        for h in hideouts {
            if let card = h.card { excluded.insert(card) }
            excluded.formUnion(h.sprints ?? [])
        }

        // A wrong single guess only clears the hideouts that existed when it
        // was made: the Fugitive is free to hide on that number afterwards.
        var missedBefore: [Int: Int] = [:]
        var placed = 1
        for entry in seen.log {
            if entry.kind == "hid" {
                placed += 1
            } else if entry.kind == "guessed", entry.hit == false, let numbers = entry.numbers, numbers.count == 1 {
                missedBefore[numbers[0]] = placed
            }
        }

        // How far past the one before each hideout can be: exact when its
        // sprints are known.
        let stretch = hideouts.map { h in
            maxStep + (h.sprints.map { $0.reduce(0) { $0 + footprints($1) } } ?? h.sprintCount * maxFootprints)
        }
        var lo = hideouts.map { $0.card ?? startCard + 1 }
        var hi = hideouts.map { $0.card ?? escapeCard - 1 }
        // Hideouts are all different, so one pinned to a single number rules
        // that number out for the rest.
        var forced: [Int: Int] = [:]
        var sets: [[Int]] = []

        var changed = true
        while changed {
            changed = false

            func tighten(_ i: Int, _ newLo: Int, _ newHi: Int) {
                if newLo > lo[i] { lo[i] = newLo; changed = true }
                if newHi < hi[i] { hi[i] = newHi; changed = true }
            }

            if n > 1 {
                for i in 1..<n { tighten(i, lo[i - 1] + 1, hi[i - 1] + stretch[i]) }
                for i in stride(from: n - 2, through: 0, by: -1) { tighten(i, lo[i + 1] - stretch[i + 1], hi[i + 1] - 1) }
            }

            sets = []
            for (i, h) in hideouts.enumerated() {
                if let card = h.card {
                    sets.append([card])
                    continue
                }
                sets.append(lo[i] > hi[i] ? [] : (lo[i]...hi[i]).filter { c in
                    !excluded.contains(c) && i >= (missedBefore[c] ?? 0) && (forced[c] ?? i) == i
                })
            }
            for (i, options) in sets.enumerated() {
                guard hideouts[i].card == nil, let first = options.first, let last = options.last else { continue }
                tighten(i, first, last)
                if options.count == 1 && forced[first] == nil {
                    forced[first] = i
                    changed = true
                }
            }
        }
        return sets
    }
}

extension FugitiveGame {
    /// The same view with the notepad's candidates set.
    nonisolated func with(candidates: [[Int]]?) -> FugitiveGame {
        FugitiveGame(viewer: viewer, phase: phase, turn: turn, hidesLeft: hidesLeft, firstTurn: firstTurn,
                     drawsLeft: drawsLeft, hideouts: hideouts, deckCounts: deckCounts, decks: decks, hand: hand,
                     handCounts: handCounts, footprints: footprints, maxStep: maxStep, winner: winner,
                     reason: reason, log: log, seq: seq, candidates: candidates)
    }
}

extension FugitiveState.Entry {
    nonisolated init(id: Int, kind: String) {
        self.init(id: id, kind: kind, role: nil, deck: nil, card: nil, index: nil, sprints: nil, numbers: nil,
                  hit: nil, revealed: nil, winner: nil, reason: nil)
    }
}
