import Foundation

/// The Fugitive's choice while hiding, and what each card in hand means for
/// it — play.html's `pick`, in Swift. Two steps, said out loud rather than
/// implied by the order of taps: choose where to hide, then choose sprint
/// cards to tuck under it (to reach further, or as a bluff). A tap means
/// whichever step is on, and the hand shows what it would do before you tap.
nonisolated struct FugitiveHiding: Equatable {
    enum Mode: Equatable { case hideout, sprint }

    /// What a card would cost as the next hideout.
    enum Cost: Equatable {
        /// Within the free reach of the last hideout: no sprint cards needed.
        case inReach
        /// Only with this many more footprints from sprint cards.
        case needs(Int)
        /// Not above the trail, or too far even with every other card.
        case outOfReach
    }

    var mode: Mode = .hideout
    var pick: Int?
    var sprints: Set<Int> = []
    /// False in a game without the app's hints: any card on from the trail
    /// can be picked, nothing switches to Sprint for you, and the hint says
    /// only what's chosen. The rules still refuse a hideout out of reach.
    var hints = true

    /// As far as the Fugitive gets without sprinting.
    static func freeReach(_ game: FugitiveGame) -> Int { game.lastHideout + game.maxStep }

    func footprints(_ game: FugitiveGame) -> Int { sprints.reduce(0) { $0 + game.steps($1) } }

    func reach(_ game: FugitiveGame) -> Int { Self.freeReach(game) + footprints(game) }

    func canHide(_ game: FugitiveGame) -> Bool {
        guard let pick else { return false }
        return pick > game.lastHideout && (!hints || pick <= reach(game))
    }

    static func cost(_ card: Int, in game: FugitiveGame) -> Cost {
        guard card > game.lastHideout, let hand = game.hand else { return .outOfReach }
        let short = card - freeReach(game)
        if short <= 0 { return .inReach }
        let spare = hand.filter { $0 != card }.reduce(0) { $0 + game.steps($1) }
        return short <= spare ? .needs(short) : .outOfReach
    }

    /// Whether tapping this card does anything in the step that's on.
    func canTap(_ card: Int, in game: FugitiveGame) -> Bool {
        if card == pick { return true }
        switch mode {
        case .hideout: return hints ? Self.cost(card, in: game) != .outOfReach : card > game.lastHideout
        case .sprint: return game.steps(card) > 0
        }
    }

    mutating func tap(_ card: Int, in game: FugitiveGame) {
        guard canTap(card, in: game) else { return }
        if card == pick {
            // The hideout again: start over.
            self = Self(hints: hints)
            return
        }
        switch mode {
        case .hideout:
            // Another card moves the hideout; it never turns into a sprint.
            pick = card
            sprints.remove(card)
            // Out of reach as it stands, so sprinting is the only way there.
            if hints && card > reach(game) { mode = .sprint }
        case .sprint:
            if sprints.contains(card) { sprints.remove(card) } else { sprints.insert(card) }
        }
    }

    /// Sprinting needs a hideout to sprint to.
    mutating func switchTo(_ mode: Mode) {
        guard mode == .hideout || pick != nil else { return }
        self.mode = mode
    }

    /// Above the hint on the first turn, which places two hideouts one at a time.
    static func heading(_ game: FugitiveGame) -> String? {
        guard game.firstTurn else { return nil }
        return game.hidesLeft >= 2 ? "First turn · hideout 1 of 2" : "First turn · hideout 2 of 2, or stop at one"
    }

    /// The way out of hiding, under Hide: stopping after one hideout on the
    /// first turn, or lying low later — which draws from the lowest deck
    /// that still has cards (2nd edition), not one you choose, so it says
    /// which. Nil when there's no way out (the first hideout must go down).
    static func passLabel(_ game: FugitiveGame) -> String? {
        if game.firstTurn { return game.hidesLeft == 1 ? "Done — one is enough" : nil }
        guard let lowest = game.deckCounts.firstIndex(where: { $0 > 0 }),
              game.decks.indices.contains(lowest), let lo = game.decks[lowest].first, let hi = game.decks[lowest].last
        else { return "Lie low" }
        return "Lie low · draw from \(lo)–\(hi)"
    }

    func hint(_ game: FugitiveGame) -> String {
        guard hints else {
            guard let pick else { return "Tap a card to hide there, then switch to Sprint to tuck cards under it." }
            let k = sprints.count
            return "Hide at \(pick)" + (k > 0 ? " with \(k) sprint card\(k == 1 ? "" : "s")." : ".")
        }
        let free = Self.freeReach(game)
        guard let pick else {
            let playable = (game.hand ?? []).contains { Self.cost($0, in: game) != .outOfReach }
            if !playable {
                return "Nothing in your hand reaches on from \(game.lastHideout)"
                    + (game.firstTurn ? " — stop at one." : " — lie low and draw a card.")
            }
            return "From \(game.lastHideout) you reach \(free) for free (✓). A card marked +N needs N footprints from sprint cards."
        }
        let used = footprints(game)
        let tally = sprints.isEmpty
            ? "reach \(free)"
            : "reach \(free) + \(used) from \(sprints.sorted().map(String.init).joined(separator: ", ")) = \(free + used)"
        if pick > free + used {
            let short = pick - free - used
            return "\(pick) needs \(short) more footprint\(short == 1 ? "" : "s") · \(tally). Tap cards to sprint with them."
        }
        switch mode {
        case .hideout:
            return sprints.isEmpty
                ? "Hide at \(pick). Switch to Sprint to tuck cards under it as a bluff."
                : "Hide at \(pick) · \(tally)."
        case .sprint:
            return "Hide at \(pick) · \(tally). Tap cards to add or take them off."
        }
    }
}
