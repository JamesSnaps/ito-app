import Foundation
import Observation
import SwiftUI

/// One Fugitive game, as this device sees it — the app's play.html.
///
/// The rules are all on the server, and so is the secrecy: the device asks
/// with whichever token it holds and gets back only what that token may
/// see. A device with one seat asks as that player. A device holding both
/// seats is pass-and-play: it asks as the table until the "for your eyes
/// only" folder is opened by whoever's turn it is, so a hand is never on
/// screen while the device changes hands. The dealing device without a
/// seat is the table: the public view, plus freeing seats and rematches.
@Observable
final class FugitiveStore {
    private(set) var code: String
    private(set) var payload: FugitivePayload?
    private(set) var device: FugitiveDevice
    private(set) var busy = false
    /// The game expired, or the code was never a game.
    private(set) var gone = false
    /// A short message to show and clear: a refused move, a lost seat.
    var notice: String?
    /// Pass-and-play: whose hand the screen is showing.
    private(set) var shownAs: FugitiveRole?

    // Choosing, on this device.
    var pick: Int?
    var sprints: Set<Int> = []
    var guesses: Set<Int> = []
    var assist: Bool = UserDefaults.standard.object(forKey: "fugitive.assist") as? Bool ?? true {
        didSet { UserDefaults.standard.set(assist, forKey: "fugitive.assist") }
    }

    // MARK: the table in motion
    //
    // The new game is on screen at once; the log says what just happened,
    // and each new entry is played out in turn — a sound, a stamp, a shake —
    // while the controls wait for the table to settle.

    struct Stamp: Identifiable, Equatable {
        enum Kind { case found, miss, escape }
        let id = UUID()
        let text: String
        let kind: Kind
    }

    private(set) var animating = false
    private(set) var stamp: Stamp?
    /// Bumped on a miss, for a shake of the trail.
    private(set) var shakes = 0
    /// The plane out, across the map, at an escape.
    private(set) var flyingAway = false
    /// The opening deal: hands fan in.
    private(set) var dealing = false
    /// Hideouts already in the game but not yet slid onto the trail.
    private(set) var landing: Set<Int> = []
    /// Cards drawn but still on their way: faces this viewer will see, and
    /// how many backs each hand is still owed.
    private(set) var incomingCards: Set<Int> = []
    private(set) var incomingBacks: [FugitiveRole: Int] = [:]

    /// A hand as it should look right now: what's held, less what's still
    /// in the air.
    func shownHand(_ role: FugitiveRole) -> [Int?] {
        guard let game else { return [] }
        if role == game.viewerRole, let hand = game.hand {
            return hand.filter { !incomingCards.contains($0) }
        }
        return Array(repeating: nil, count: max(0, game.handCount(role) - (incomingBacks[role] ?? 0)))
    }

    /// The server, this phone (offline) or a nearby host.
    @ObservationIgnored let transport: any FugitiveTransport
    @ObservationIgnored private let tokens: FugitiveTokens
    @ObservationIgnored private var lastEvent: Int?
    @ObservationIgnored private var lastNudge: Int?
    @ObservationIgnored private var dealt = false
    @ObservationIgnored private var queue: [FugitiveEvent] = []
    @ObservationIgnored private var animator: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    init(code: String, transport: any FugitiveTransport = AppSettings.client) {
        self.code = code
        self.transport = transport
        self.tokens = transport.tokens
        self.device = tokens.held(for: code)
    }

    /// For a game this device was just handed in full (dealt, or checked on
    /// the way in), so the first frame isn't a spinner.
    convenience init(payload: FugitivePayload, transport: any FugitiveTransport = AppSettings.client) {
        self.init(code: payload.code, transport: transport)
        take(payload, askedAs: device.askingToken)
    }

    var game: FugitiveGame? { payload?.game }
    /// What the invite QR opens; nil for a game kept on a phone.
    var inviteURL: URL? { transport.inviteURL(code: code) }
    var isTable: Bool { device.seats.isEmpty }
    var isDealer: Bool { device.host != nil }

    /// Pass-and-play's folder: up whenever it's someone's turn and the
    /// screen isn't theirs yet — and only once the table has settled.
    var folderFor: FugitiveRole? {
        guard device.seats.count == 2, !animating, let turn = game?.turn, shownAs != turn else { return nil }
        return turn
    }

    private var askingToken: String? {
        // Pass-and-play: the screen's player keeps their view while their
        // move is still playing out; the folder only goes up after it.
        if device.seats.count == 2, let shown = shownAs, animating || game?.turn == shown { return device.seat(shown) }
        return device.askingToken
    }

    // MARK: - polling

    func start() {
        guard pollTask == nil else { return }
        defer { nudgeIfMyTurn() }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                let live = self.game.map { !$0.isOver } ?? true
                try? await Task.sleep(for: .milliseconds(live ? 1000 : 2500))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        guard !busy, !gone else { return }
        let asked = askingToken
        do {
            let fresh = try await transport.fugitiveState(code: code, token: asked)
            // Asked as someone the screen no longer shows (the folder opened,
            // a seat was taken): that answer is the wrong view of the game.
            if !busy, asked == askingToken { take(fresh, askedAs: asked) }
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            gone = true
        } catch {
            // A blip; the next tick tries again.
        }
    }

    // MARK: - choosing a hideout

    /// How far the Fugitive can reach with the sprint cards picked.
    var reach: Int {
        guard let game else { return 0 }
        return game.lastHideout + game.maxStep + sprints.reduce(0) { $0 + game.steps($1) }
    }

    var canHide: Bool {
        guard let game, let pick else { return false }
        return pick > game.lastHideout && pick <= reach
    }

    /// Could this card be reached at all, with the rest of the hand?
    func reachable(_ card: Int) -> Bool {
        guard let game, let hand = game.hand else { return false }
        let spare = hand.filter { $0 != card }.reduce(0) { $0 + game.steps($1) }
        return card > game.lastHideout && card - game.lastHideout - game.maxStep <= spare
    }

    /// The first card tapped is where to hide; any after it sprint.
    func tap(_ card: Int) {
        guard let game else { return }
        if pick == nil || pick == card {
            pick = pick == card ? nil : card
            sprints.remove(card)
        } else if game.steps(card) > 0 {
            if sprints.contains(card) { sprints.remove(card) } else { sprints.insert(card) }
        }
        Sound.shared.play(.flick, volume: 0.6)
    }

    func toggleGuess(_ number: Int) {
        if game?.phase == .manhunt {
            guesses = guesses.contains(number) ? [] : [number]
        } else if guesses.contains(number) {
            guesses.remove(number)
        } else {
            guesses.insert(number)
        }
        Sound.shared.play(.flick, volume: 0.5)
    }

    // MARK: - moves

    func draw(from deck: Int) async { await send(.draw, deck: deck) }
    func hide() async {
        guard canHide, let pick else { return }
        await send(.hide, card: pick, sprints: sprints.sorted())
    }
    func pass() async { await send(.pass) }
    func guess() async {
        guard !guesses.isEmpty else { return }
        await send(.guess, numbers: guesses.sorted())
    }
    func letGo() async { await send(.letGo) }
    func resign() async { await send(.resign) }

    private func send(_ kind: FugitiveMove.Kind, deck: Int? = nil, card: Int? = nil,
                      sprints: [Int]? = nil, numbers: [Int]? = nil) async {
        guard !busy, !animating, let game, let role = game.viewerRole, let token = device.seat(role) else { return }
        busy = true
        defer { busy = false }
        let move = FugitiveMove(type: kind, deck: deck, card: card, sprints: sprints, numbers: numbers, seq: game.seq)
        do {
            take(try await transport.fugitiveMove(code: code, move, token: token), askedAs: token)
        } catch let failure as GameNightClient.Failure {
            if failure.status == 404 { gone = true; return }
            notice = failure.errorDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            busy = false
            await refresh()
        } catch {
            notice = error.localizedDescription
        }
    }

    // MARK: - seats and the room

    func sit(as role: FugitiveRole) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await transport.fugitiveClaim(code: code, role: role)
            if let token = result.seatToken {
                device.setSeat(role, token)
                device.pass = device.seats.count == 2
                tokens.set(device, for: code)
                tokens.lastGame = code
                shownAs = nil
            }
            take(result, askedAs: result.seatToken)
        } catch {
            notice = error.localizedDescription
        }
    }

    func free(_ role: FugitiveRole) async {
        guard !busy, let host = device.host else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await transport.fugitiveRelease(code: code, role: role, token: host)
            if device.seat(role) != nil {
                device.setSeat(role, nil)
                tokens.set(device, for: code)
            }
            take(result, askedAs: host)
        } catch {
            notice = error.localizedDescription
        }
    }

    func rematch() async {
        guard !busy, let host = device.host else { return }
        busy = true
        defer { busy = false }
        do {
            follow(to: try await transport.fugitiveRematch(code: code, token: host).code)
        } catch {
            notice = error.localizedDescription
        }
    }

    /// Pass-and-play: the player whose turn it is has the device.
    func openFolder() {
        guard let role = folderFor else { return }
        shownAs = role
        Sound.shared.play(.slide)
        Task { await refresh() }
    }

    // MARK: - taking a new game

    private func take(_ fresh: FugitivePayload, askedAs token: String?) {
        // A poll answered after a move, or for the game before a rematch, is
        // older than what's on screen: putting it back would undo the move
        // (and in pass-and-play, show the last mover's view again).
        guard fresh.code == code else { return }
        if let current = payload?.game.seq, fresh.game.seq < current { return }
        // A seat freed by the dealing device: that token sits nowhere now.
        for role in device.seats where token == device.seat(role) && fresh.you.seat != role && fresh.code == code {
            device.setSeat(role, nil)
            device.pass = false
            tokens.set(device, for: code)
            notice = "You’re no longer the \(role.title) in this game."
        }
        if let next = fresh.next, device.host != nil || !device.seats.isEmpty {
            follow(to: next)
            return
        }
        if fresh.game.seq != payload?.game.seq {
            pick = nil
            sprints = []
            guesses = []
        }
        let first = lastEvent == nil
        let fresher = first ? [] : fresh.game.log.filter { $0.id > (lastEvent ?? 0) }
        lastEvent = fresh.game.log.last?.id ?? 0
        payload = fresh

        // Opening a game already under way doesn't replay it; a fresh deal
        // is dealt out, once, and not behind a pass-and-play folder.
        if !dealt, fresh.game.seq == 0, folderFor == nil, fresh.game.viewerRole != nil || isTable {
            dealt = true
            queue.append(FugitiveEvent(id: 0, kind: "deal", role: nil, deck: nil, card: nil, index: nil, sprints: nil,
                                       numbers: nil, hit: nil, revealed: nil, winner: nil, reason: nil))
        }
        // Whatever the new entries put on the table waits for its animation.
        for event in fresher {
            if event.kind == "hid", let index = event.index { landing.insert(index) }
            if event.kind == "drew", let role = event.role {
                if role == fresh.game.viewerRole, let card = event.card {
                    incomingCards.insert(card)
                } else {
                    incomingBacks[role, default: 0] += 1
                }
            }
        }
        queue += fresher
        playOut()
        nudgeIfMyTurn()
    }

    /// A rematch is a new room with the roles swapped; this device's tokens
    /// swap with them.
    private func follow(to next: String) {
        guard next != code else { return }
        device = device.swapped
        tokens.set(device, for: next)
        if tokens.lastGame == code { tokens.lastGame = next }
        code = next
        payload = nil
        lastEvent = nil
        dealt = false
        shownAs = nil
        // Whatever the last game was still playing out stops here, rather
        // than landing a stamp or a plane on the new deal.
        animator?.cancel()
        animator = nil
        animating = false
        stamp = nil
        flyingAway = false
        dealing = false
        queue = []
        landing = []
        incomingCards = []
        incomingBacks = [:]
        Task { await refresh() }
    }

    private func playOut() {
        guard animator == nil, !queue.isEmpty else { return }
        animating = true
        animator = Task { [weak self] in
            while let self, !Task.isCancelled, !self.queue.isEmpty {
                let event = self.queue.removeFirst()
                await self.perform(event)
            }
            // Cancelled by a rematch, which has already reset all this.
            guard let self, !Task.isCancelled else { return }
            self.animating = false
            self.animator = nil
            self.nudgeIfMyTurn()
            // Pass-and-play: the folder is up for the next player, so stop
            // holding the last mover's view and read the game as the table.
            if self.folderFor != nil { Task { await self.refresh() } }
        }
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
    }

    private func show(_ text: String, _ kind: Stamp.Kind, for seconds: Double) async {
        // A cancelled play-out (a rematch) mustn't stamp the new game.
        guard !Task.isCancelled else { return }
        stamp = Stamp(text: text, kind: kind)
        Sound.shared.play(.stamp)
        await pause(seconds)
        stamp = nil
    }

    private func perform(_ event: FugitiveEvent) async {
        let sound = Sound.shared
        switch event.kind {
        case "deal":
            dealing = true
            sound.play(.riffle)
            await pause(1.3)
            dealing = false
        case "drew":
            sound.play(.flick)
            withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) {
                if let card = event.card, incomingCards.contains(card) {
                    incomingCards.remove(card)
                } else if let role = event.role, let owed = incomingBacks[role], owed > 0 {
                    incomingBacks[role] = owed - 1
                }
            }
            await pause(0.35)
            sound.play(.land, volume: 0.8)
            await pause(0.25)
        case "hid":
            sound.play(.slide)
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                if let index = event.index { landing.remove(index) }
            }
            await pause(0.5)
            sound.play(.land)
            await pause(0.2)
        case "guessed":
            if event.hit == true {
                await show("Found", .found, for: 1.0)
            } else {
                sound.play(.miss)
                shakes += 1
                let numbers = (event.numbers ?? []).map(String.init).joined(separator: ", ")
                await show("\(numbers) — not here", .miss, for: 1.1)
            }
        case "manhunt":
            sound.play(.siren)
            await show("Manhunt", .miss, for: 1.4)
        case "game_over":
            if event.winner == .marshal {
                sound.play(.caught)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                await show("Caught", .found, for: 1.8)
            } else {
                sound.play(.escape)
                flyingAway = true
                await pause(1.4)
                flyingAway = false
                await show("Escaped", .escape, for: 1.8)
            }
        default:
            await pause(0.1)
        }
    }

    /// Your turn, on your own device, is worth a buzz — once per turn.
    private func nudgeIfMyTurn() {
        // Only once the table is on screen: a store SwiftUI builds and
        // throws away mustn't buzz.
        guard pollTask != nil, !animating, folderFor == nil, let game, game.myTurn, lastNudge != game.seq else { return }
        lastNudge = game.seq
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Sound.shared.play(.turn)
    }
}
