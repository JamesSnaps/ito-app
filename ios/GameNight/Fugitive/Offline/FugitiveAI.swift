import Foundation

// games/fugitive/ai.py in Swift: the computer opponent, for offline games.
//
// Online the server plays it; with no signal OfflineTable does, the way
// game.py does. Like FugitiveEngine it's a port, line for line — same
// choices, same order, same draws from the same generator — pinned to the
// Python by seeded games the Flask suite writes out
// (tests/test_fugitive_ai.py → GameNightTests/Fixtures/fugitive_ai_games.json)
// and FugitiveAITests replays. Change ai.py, rewrite the fixture, then make
// this agree.
//
// `choose(seen, level, rng)` is the whole interface. `seen` is
// FugitiveEngine.view for the computer's seat — exactly what that seat's
// phone would be shown, the Marshal's with `candidates` — so the computer
// knows what a player in its chair would know and nothing more.

/// mulberry32, 32-bit state, wrapping arithmetic. `below(n)` is the only way
/// the AI draws, so nothing can round differently from the Python.
nonisolated struct Mulberry32 {
    private(set) var a: UInt32

    init(_ seed: UInt32) { a = seed }

    mutating func next() -> UInt32 {
        a = a &+ 0x6D2B_79F5
        var t = a
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return t ^ (t >> 14)
    }

    /// An integer in [0, n).
    mutating func below(_ n: Int) -> Int { Int(next() % UInt32(n)) }

    mutating func pick<T>(_ options: [T]) -> T { options[below(options.count)] }
}

nonisolated enum FugitiveAI {
    enum Level: String, Codable, CaseIterable, Identifiable {
        case easy, hard
        var id: String { rawValue }
        var title: String { self == .easy ? "Easy" : "Hard" }
    }

    static let defaultLevel = Level.hard
    /// Out of 3: how often the hard Fugitive tucks a spare dead card under a
    /// hideout it didn't need it for.
    static let bluffIn3 = 1

    /// Asked to move for a seat whose turn it isn't.
    struct NotItsTurn: Error {}

    /// The generator for the move at `seq`. The seed is the room's secret;
    /// mixing in `seq` means picking a game up again chooses exactly as it
    /// would have.
    static func moveRNG(seed: UInt32, seq: Int) -> Mulberry32 {
        Mulberry32(seed ^ (UInt32(truncatingIfNeeded: seq) &* 0x9E37_79B1))
    }

    /// The move to make, for the seat `seen` belongs to, when it's that
    /// seat's turn. Its `seq` is the view's, as a person's would be.
    static func choose(_ seen: FugitiveGame, level: Level, rng: inout Mulberry32) throws -> FugitiveMove {
        guard let role = seen.viewerRole, seen.turn == role else { throw NotItsTurn() }
        let hard = level == .hard
        let choice: Choice
        switch seen.phase {
        case .fugitiveDraw, .marshalDraw: choice = .draw(deck(seen, hard, &rng))
        case .fugitiveHide: choice = hide(seen, hard, &rng)
        default: choice = guess(seen, hard, &rng)
        }
        return choice.move(seq: seen.seq)
    }

    private enum Choice {
        case draw(Int), hide(Int, [Int]), pass, guess([Int])

        func move(seq: Int) -> FugitiveMove {
            switch self {
            case .draw(let deck): FugitiveMove(type: .draw, deck: deck, seq: seq)
            case .hide(let card, let sprints): FugitiveMove(type: .hide, card: card, sprints: sprints, seq: seq)
            case .pass: FugitiveMove(type: .pass, seq: seq)
            case .guess(let numbers): FugitiveMove(type: .guess, numbers: numbers, seq: seq)
            }
        }
    }

    // MARK: - the Fugitive

    private static func last(_ seen: FugitiveGame) -> Int { seen.lastHideout }

    /// The cheapest sprint cards that get from the last hideout to `card`,
    /// or nil if the hand can't reach it. Cards below `card` go first — once
    /// it's down they can never be hideouts — lowest first; then the cards
    /// just above it.
    private static func sprints(for card: Int, _ seen: FugitiveGame, _ hand: [Int]) -> [Int]? {
        var needed = card - last(seen) - seen.maxStep
        if needed <= 0 { return [] }
        let spare = hand.filter { $0 != card && seen.steps($0) > 0 }
        let order = spare.filter { $0 < card } + spare.filter { $0 > card }
        var chosen: [Int] = []
        for c in order {
            if needed <= 0 { break }
            chosen.append(c)
            needed -= seen.steps(c)
        }
        return needed <= 0 ? chosen.sorted() : nil
    }

    private static func hide(_ seen: FugitiveGame, _ hard: Bool, _ rng: inout Mulberry32) -> Choice {
        let hand = seen.hand ?? []
        let last = last(seen)
        var options: [(card: Int, sprints: [Int])] = []
        for c in hand where c > last {
            if let sprints = sprints(for: c, seen, hand) { options.append((c, sprints)) }
        }

        if let escape = options.first(where: { $0.card == FugitiveEngine.escapeCard }) {
            return .hide(escape.card, escape.sprints)
        }
        options = options.filter { $0.card != FugitiveEngine.escapeCard }

        // The first turn's second hideout is optional: taken only when it
        // costs no sprint. Later, lying low (and drawing) is for when
        // nothing reaches.
        if seen.firstTurn && seen.hidesLeft == 1 {
            options = options.filter { $0.sprints.isEmpty }
        }
        if options.isEmpty { return .pass }

        if !hard {
            // Python's min over (len(sprints), card): the first smallest.
            var best = options[0]
            for o in options.dropFirst()
            where (o.sprints.count, o.card) < (best.sprints.count, best.card) { best = o }
            return .hide(best.card, best.sprints)
        }

        // Hard: cheapest first — no sprints, then only dead cards as sprints,
        // then cards that could have been hideouts — and at random within that.
        func cost(_ option: (card: Int, sprints: [Int])) -> Int {
            if option.sprints.isEmpty { return 0 }
            return option.sprints.allSatisfy { $0 < option.card } ? 1 : 2
        }

        let best = options.map(cost).min()!
        let (card, chosen) = rng.pick(options.filter { cost($0) == best })
        var sprints = chosen
        let dead = hand.filter { $0 < card && !chosen.contains($0) && seen.steps($0) > 0 }
        // A bluff: one more face-down card under the hideout widens the
        // Marshal's range by two, and a card below it is no use as a hideout.
        // Keep one back for a sprint later.
        if dead.count >= 2 && rng.below(3) < bluffIn3 {
            sprints = (sprints + [rng.pick(dead)]).sorted()
        }
        return .hide(card, sprints)
    }

    private static func deck(_ seen: FugitiveGame, _ hard: Bool, _ rng: inout Mulberry32) -> Int {
        let counts = seen.deckCounts
        let live = counts.indices.filter { counts[$0] != 0 }
        if seen.viewer == FugitiveRole.fugitive.rawValue {
            if !hard { return rng.pick(live) }
            // The deck the trail is heading into: cards a step or two past
            // the last hideout are the ones worth holding.
            let ahead = last(seen) + seen.maxStep
            for (i, range) in seen.decks.enumerated() where counts[i] != 0 && range[1] >= ahead { return i }
            return live.last!
        }
        if !hard { return rng.pick(live) }
        // The Marshal: the deck with the most numbers a hideout could be on,
        // since every one drawn is one the Fugitive can't be hiding at.
        let open = openNumbers(seen)
        let scores = seen.decks.enumerated().map { i, range in
            counts[i] != 0 ? open.filter { range[0] <= $0 && $0 <= range[1] }.count : -1
        }
        let top = scores.max()!
        if top <= 0 {
            // Nothing face down yet in any deck's range: the trail's next
            // stretch is the best bet.
            let ahead = seen.hideouts.compactMap(\.card).max()! + seen.maxStep
            for (i, range) in seen.decks.enumerated() where counts[i] != 0 && range[1] >= ahead { return i }
            return live.last!
        }
        return rng.pick(scores.indices.filter { scores[$0] == top })
    }

    // MARK: - the Marshal

    /// (index, options) for each hideout still face down.
    private static func hidden(_ seen: FugitiveGame) -> [(index: Int, options: [Int])] {
        let sets = seen.candidates.flatMap { $0.isEmpty ? nil : $0 } ?? FugitiveEngine.candidates(seen)
        return zip(seen.hideouts, sets).enumerated()
            .filter { !$0.element.0.revealed }
            .map { ($0.offset, $0.element.1) }
    }

    private static func openNumbers(_ seen: FugitiveGame) -> [Int] {
        Set(hidden(seen).flatMap(\.options)).sorted()
    }

    private static func guess(_ seen: FugitiveGame, _ hard: Bool, _ rng: inout Mulberry32) -> Choice {
        let hidden = hidden(seen).filter { !$0.options.isEmpty }
        if hidden.isEmpty { return .guess([fallback(seen)]) }
        let manhunt = seen.phase == .manhunt
        if !hard { return .guess([rng.pick(openNumbers(seen))]) }

        // Pinned down: every hideout the notepad leaves one number for. The
        // notepad never rules out the truth, so they're all right — one guess.
        let sure = Set(hidden.filter { $0.options.count == 1 }.map { $0.options[0] }).sorted()
        if !sure.isEmpty { return .guess(manhunt ? [sure[0]] : sure) }
        let fewest = hidden.map(\.options.count).min()!
        let narrowest = hidden.filter { $0.options.count == fewest }.map(\.options)
        // The earliest of them: it has fewer hideouts after it to have moved
        // its range.
        return .guess([rng.pick(narrowest[0])])
    }

    /// Some legal number, should the notepad ever come back empty.
    private static func fallback(_ seen: FugitiveGame) -> Int {
        let turned = Set(seen.hideouts.filter(\.revealed).compactMap(\.card))
        let mine = Set(seen.hand ?? [])
        let numbers = (FugitiveEngine.startCard + 1..<FugitiveEngine.escapeCard).filter { !turned.contains($0) }
        return numbers.first { !mine.contains($0) } ?? numbers[0]
    }
}
