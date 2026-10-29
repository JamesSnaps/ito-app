import Foundation

// games/wildwood/engine.py in Swift, for playing with no server — on a plane.
//
// As with FugitiveEngine.swift, a port line for line, not a reinterpretation:
// the same state, the same order of checks, the same refusals word for word.
// It's pinned to the Python by scripted games the Flask suite writes out
// (tests/test_wildwood_offline.py → GameNightTests/Fixtures/
// wildwood_engine_games.json) and WildwoodEngineTests replays. Change
// engine.py, rewrite the fixture, then make this agree.
//
// `view` returns the app's own WildwoodGame, the same shape the server sends,
// so the offline table, the store and the computer all read one thing.

/// The whole game, as engine.py keeps it (the same JSON keys).
nonisolated struct WildwoodState: Codable, Equatable {
    var players: Int
    var hands: [[String]]
    var draw: [String]
    var discard: [String]
    var colour: String
    var turn: Int
    var direction: Int
    var stack: Int
    var drawn: String?
    var exposed: Int?
    var shuffleSeed: UInt32
    var reshuffles: Int
    /// "play" or "game_over".
    var phase: String
    var winner: Int?
    var log: [WildwoodEvent]
    var event: Int
    var seq: Int
    var recorded: Bool

    enum CodingKeys: String, CodingKey {
        case players, hands, draw, discard, colour, turn, direction, stack, drawn, exposed, reshuffles, phase,
             winner, log, event, seq, recorded
        case shuffleSeed = "shuffle_seed"
    }
}

nonisolated extension Mulberry32 {
    /// Fisher–Yates in place, from the end, one `below` per swap — as
    /// core/seeded.py's `shuffle`.
    mutating func shuffle<T>(_ items: inout [T]) {
        guard items.count > 1 else { return }
        for i in stride(from: items.count - 1, to: 0, by: -1) {
            let j = below(i + 1)
            items.swapAt(i, j)
        }
    }
}

nonisolated enum WildwoodEngine {
    static let colours = WildwoodCard.colours
    static let numbers = (1...9).map(String.init)
    static let actions = ["S", "R", "D"]
    static let wilds = WildwoodCard.wilds
    static let symbols = numbers + actions
    static let handSize = 7
    static let minPlayers = 2
    static let maxPlayers = 4
    static let penalty = 2
    static let logSent = 60
    static let logKept = 120

    // MARK: - cards

    static func fullDeck() -> [String] {
        var deck: [String] = []
        for colour in colours {
            for symbol in symbols { deck += [colour + symbol, colour + symbol] }
        }
        for wild in wilds { deck += Array(repeating: wild, count: 4) }
        return deck
    }

    static func isCard(_ card: String?) -> Bool {
        guard let card else { return false }
        if wilds.contains(card) { return true }
        return card.count == 2 && colours.contains(String(card.prefix(1))) && symbols.contains(String(card.dropFirst()))
    }

    static func colourOf(_ card: String) -> String? { WildwoodCard.colour(card) }
    static func symbolOf(_ card: String) -> String { WildwoodCard.symbol(card) }

    static func isNumber(_ card: String) -> Bool {
        !wilds.contains(card) && numbers.contains(symbolOf(card))
    }

    static func sortKey(_ card: String) -> (Int, Int) {
        if let wild = wilds.firstIndex(of: card) { return (colours.count, wild) }
        return (colours.firstIndex(of: String(card.prefix(1))) ?? 0, symbols.firstIndex(of: String(card.dropFirst())) ?? 0)
    }

    static func sorted(_ cards: [String]) -> [String] {
        cards.sorted { sortKey($0) < sortKey($1) }
    }

    // MARK: - a game

    /// A fresh game, dealt from `deck` (top card last) and ready for `first`.
    /// The phone shuffles the deck itself; the server only ever replays it.
    static func newGame(players: Int, deck: [String], shuffleSeed: UInt32, first: Int = 0) -> WildwoodState {
        var pile = deck
        var hands = Array(repeating: [String](), count: players)
        for _ in 0..<handSize {
            for seat in 0..<players { hands[seat].append(pile.removeLast()) }
        }
        // Turn up a number to start on; anything else goes back under the pile.
        while let top = pile.last, !isNumber(top) {
            pile.insert(pile.removeLast(), at: 0)
        }
        let top = pile.removeLast()
        var state = WildwoodState(
            players: players, hands: hands.map(sorted), draw: pile, discard: [top],
            colour: colourOf(top) ?? "r", turn: first % players, direction: 1, stack: 0, drawn: nil, exposed: nil,
            shuffleSeed: shuffleSeed, reshuffles: 0, phase: "play", winner: nil, log: [], event: 0, seq: 0,
            recorded: false)
        log(&state, WildwoodEvent(id: 0, kind: "deal", first: state.turn, top: top))
        return state
    }

    static func turn(_ s: WildwoodState) -> Int? { s.phase == "game_over" ? nil : s.turn }

    static func canPlay(_ s: WildwoodState, seat: Int, card: String) -> Bool {
        let top = s.discard.last ?? ""
        if let drawn = s.drawn, card != drawn { return false }
        if s.stack > 0 { return symbolOf(card) == "D" && symbolOf(top) == "D" }
        if card == "W" { return true }
        if card == "W4" { return !s.hands[seat].contains { colourOf($0) == s.colour } }
        return colourOf(card) == s.colour || (!wilds.contains(top) && symbolOf(card) == symbolOf(top))
    }

    static func playable(_ s: WildwoodState, seat: Int) -> [String] {
        guard turn(s) == seat else { return [] }
        var seen: [String] = []
        for card in s.hands[seat] where !seen.contains(card) && canPlay(s, seat: seat, card: card) {
            seen.append(card)
        }
        return seen
    }

    static func nextSeat(_ s: WildwoodState, _ seat: Int, steps: Int = 1) -> Int {
        // Python's % is never negative; Swift's can be.
        let n = s.players
        return ((seat + s.direction * steps) % n + n) % n
    }

    /// Play one move for `seat`, in place. Throws IllegalMove before
    /// changing anything.
    static func apply(_ state: inout WildwoodState, seat: Int, move: WildwoodMove) throws {
        guard (0..<state.players).contains(seat) else { throw IllegalMove("No such player.") }
        if state.phase == "game_over" { throw IllegalMove("The game is over.") }
        var s = state
        switch move.type {
        case .call:
            try call(&s, seat)
        case .catch:
            try catchOut(&s, seat)
        case .play, .draw, .pass, .take:
            guard s.turn == seat else { throw IllegalMove("It isn't your turn.") }
            switch move.type {
            case .play: try play(&s, seat, move)
            case .draw: try drawMove(&s, seat)
            case .pass: try pass(&s, seat)
            default: try take(&s, seat)
            }
        }
        s.seq += 1
        state = s
    }

    /// What `viewer` may see — the payload's `game`.
    static func view(_ s: WildwoodState, viewer: WildwoodViewer) -> WildwoodGame {
        let over = s.phase == "game_over"
        let seat = viewer.seat
        let log = s.log.suffix(logSent).map { entry -> WildwoodEvent in
            var entry = entry
            if entry.kind == "draw", !(over || entry.seat == seat) { entry.cards = nil }
            return entry
        }
        return WildwoodGame(
            viewer: viewer, phase: s.phase, turn: turn(s), players: s.players,
            hand: seat.map { s.hands[$0] }, handCounts: s.hands.map(\.count), hands: over ? s.hands : nil,
            top: s.discard.last ?? "", colour: s.colour, direction: s.direction, stack: s.stack,
            drawCount: s.draw.count, discardCount: s.discard.count, deciding: s.drawn != nil,
            drawn: seat != nil && seat == s.turn ? s.drawn : nil, exposed: s.exposed,
            playable: seat.map { playable(s, seat: $0) } ?? [], winner: s.winner, log: Array(log), seq: s.seq)
    }

    // MARK: - moves

    private static func play(_ s: inout WildwoodState, _ seat: Int, _ move: WildwoodMove) throws {
        guard let card = move.card, isCard(card), s.hands[seat].contains(card) else {
            throw IllegalMove("That card isn't in your hand.")
        }
        guard canPlay(s, seat: seat, card: card) else { throw IllegalMove(refusal(s, seat, card)) }
        var colour = move.colour
        if wilds.contains(card) {
            guard let picked = colour, colours.contains(picked) else { throw IllegalMove("Pick a colour for the wild.") }
            colour = picked
        } else {
            colour = colourOf(card)
        }
        let call = move.call ?? false

        closeWindow(&s, seat)
        if let i = s.hands[seat].firstIndex(of: card) { s.hands[seat].remove(at: i) }
        s.discard.append(card)
        s.colour = colour ?? s.colour
        s.drawn = nil
        if s.hands[seat].isEmpty {
            log(&s, WildwoodEvent(id: 0, kind: "play", seat: seat, card: card, colour: colour))
            end(&s, seat)
            return
        }
        let called = s.hands[seat].count == 1 && call
        log(&s, WildwoodEvent(id: 0, kind: "play", seat: seat, card: card, colour: colour, called: called ? true : nil))
        if s.hands[seat].count == 1 && !call { s.exposed = seat }

        switch symbolOf(card) {
        case "S":
            log(&s, WildwoodEvent(id: 0, kind: "skip", seat: nextSeat(s, seat)))
            advance(&s, 2)
        case "R":
            s.direction = -s.direction
            log(&s, WildwoodEvent(id: 0, kind: "reverse", direction: s.direction))
            // Between two players a Reverse is a Skip: the same player goes again.
            advance(&s, s.players == 2 ? 2 : 1)
        case "D":
            s.stack += 2
            advance(&s, 1)
        case "W4":
            s.stack = 4
            advance(&s, 1)
        default:
            advance(&s, 1)
        }
    }

    private static func refusal(_ s: WildwoodState, _ seat: Int, _ card: String) -> String {
        let top = s.discard.last ?? ""
        let name = WildwoodCard.colourName(s.colour)
        if s.drawn != nil { return "You can only play the card you just drew — or keep it." }
        if s.stack > 0 {
            if symbolOf(top) == "D" { return "Play a Draw two, or take the \(s.stack) cards." }
            return "Take the \(s.stack) cards — a Bear can't be stacked."
        }
        if card == "W4" { return "The Bear only goes down when you've no \(name) cards." }
        return "That doesn't match — it needs to be \(name), or the same symbol."
    }

    private static func drawMove(_ s: inout WildwoodState, _ seat: Int) throws {
        if s.stack > 0 { throw IllegalMove("Take the \(s.stack) cards, or play a Draw two on top.") }
        if s.drawn != nil { throw IllegalMove("You've drawn already — play that card or keep it.") }
        closeWindow(&s, seat)
        let drawn = dealTo(&s, seat, count: 1, reason: "draw")
        if let card = drawn.first, canPlay(s, seat: seat, card: card) {
            s.drawn = card
        } else {
            advance(&s, 1)
        }
    }

    private static func pass(_ s: inout WildwoodState, _ seat: Int) throws {
        guard s.drawn != nil else { throw IllegalMove("Play a card, or draw one.") }
        s.drawn = nil
        log(&s, WildwoodEvent(id: 0, kind: "keep", seat: seat))
        advance(&s, 1)
    }

    private static func take(_ s: inout WildwoodState, _ seat: Int) throws {
        guard s.stack > 0 else { throw IllegalMove("There's nothing to take.") }
        closeWindow(&s, seat)
        let count = s.stack
        s.stack = 0
        _ = dealTo(&s, seat, count: count, reason: "take")
        advance(&s, 1)
    }

    private static func call(_ s: inout WildwoodState, _ seat: Int) throws {
        guard s.exposed == seat else { throw IllegalMove("That's for when you're down to one card.") }
        s.exposed = nil
        log(&s, WildwoodEvent(id: 0, kind: "call", seat: seat))
    }

    private static func catchOut(_ s: inout WildwoodState, _ seat: Int) throws {
        guard let caught = s.exposed else { throw IllegalMove("Nobody to catch — everyone said Last card!") }
        if caught == seat { throw IllegalMove("That's you — say Last card! instead.") }
        s.exposed = nil
        log(&s, WildwoodEvent(id: 0, kind: "catch", seat: caught, by: seat))
        _ = dealTo(&s, caught, count: penalty, reason: "caught")
    }

    // MARK: - helpers

    private static func closeWindow(_ s: inout WildwoodState, _ seat: Int) {
        if let exposed = s.exposed, exposed != seat { s.exposed = nil }
    }

    private static func advance(_ s: inout WildwoodState, _ steps: Int) {
        s.turn = nextSeat(s, s.turn, steps: steps)
    }

    private static func dealTo(_ s: inout WildwoodState, _ seat: Int, count: Int, reason: String) -> [String] {
        var cards: [String] = []
        for _ in 0..<count {
            if s.draw.isEmpty { reshuffle(&s) }
            guard let card = s.draw.popLast() else { break }
            cards.append(card)
        }
        if !cards.isEmpty, s.exposed == seat {
            // More than one card again: nothing left to be caught for.
            s.exposed = nil
        }
        s.hands[seat] = sorted(s.hands[seat] + cards)
        log(&s, WildwoodEvent(id: 0, kind: "draw", seat: seat, count: cards.count, cards: cards, reason: reason))
        return cards
    }

    private static func reshuffle(_ s: inout WildwoodState) {
        guard s.discard.count >= 2 else { return }
        let top = s.discard.removeLast()
        var pile = s.discard
        s.discard = [top]
        s.reshuffles += 1
        var rng = Mulberry32(s.shuffleSeed ^ (UInt32(truncatingIfNeeded: s.reshuffles) &* 0x9E37_79B1))
        rng.shuffle(&pile)
        s.draw = pile
        log(&s, WildwoodEvent(id: 0, kind: "reshuffle", count: pile.count))
    }

    private static func end(_ s: inout WildwoodState, _ winner: Int) {
        s.phase = "game_over"
        s.winner = winner
        s.drawn = nil
        s.exposed = nil
        s.stack = 0
        log(&s, WildwoodEvent(id: 0, kind: "game_over", winner: winner))
    }

    private static func log(_ s: inout WildwoodState, _ entry: WildwoodEvent) {
        s.event += 1
        var entry = entry
        entry = WildwoodEvent(id: s.event, kind: entry.kind, seat: entry.seat, card: entry.card, colour: entry.colour,
                              called: entry.called, count: entry.count, cards: entry.cards, reason: entry.reason,
                              by: entry.by, first: entry.first, top: entry.top, direction: entry.direction,
                              winner: entry.winner)
        s.log.append(entry)
        if s.log.count > logKept { s.log.removeFirst(s.log.count - logKept) }
    }
}
