import Foundation
import Observation
import SwiftUI

/// One Wildwood game, as this device sees it — the app's play.html.
///
/// The rules and the secrecy are on the server (or, offline, whoever keeps
/// the game): the device asks with whichever token it holds and gets back
/// only what that token may see. One seat asks as that player. Several seats
/// is pass-and-play: it asks as the table until the curtain is tapped by
/// whoever's turn it is, so a hand is never on screen while the device
/// changes hands. The dealing device without a seat is the table.
@Observable
final class WildwoodStore {
    private(set) var code: String
    private(set) var payload: WildwoodPayload?
    private(set) var device: WildwoodDevice
    private(set) var busy = false
    /// The game expired, or the code was never a game.
    private(set) var gone = false
    /// A short message to show and clear: a refused move, a lost seat.
    var notice: String?
    /// Whether the polls are getting through, for "Reconnecting…".
    let connection = PollHealth()
    /// Pass-and-play: whose hand the screen is showing.
    private(set) var shownAs: Int?
    /// "Last card!" said ahead of the play, for the turn it was said on.
    var armed = false

    // MARK: the table in motion
    //
    // The new game is on screen at once; the log says what just happened,
    // and each new entry is played out in turn — a card onto the pile, a
    // card into a hand, a word across the table — while the controls wait.

    struct Burst: Identifiable, Equatable {
        enum Kind { case call, caught, plain, win }
        let id = UUID()
        let text: String
        let kind: Kind
    }

    private(set) var animating = false
    private(set) var burst: Burst?
    /// The card on the pile as the play-out has got to, and its colour.
    private(set) var shownTop: String?
    private(set) var shownColour: String?
    /// Which seat the card now landing on the pile came from.
    private(set) var playedFrom: Int?
    /// Bumped as each card lands, to replay the landing.
    private(set) var landings = 0
    /// Cards drawn but still on their way: per seat, and this viewer's faces.
    private(set) var owed: [Int: Int] = [:]
    private(set) var owedMine: [String] = []
    /// A seat that just missed a go, for a shake.
    private(set) var skipped: Int?

    /// The server, this phone (offline) or a nearby host.
    @ObservationIgnored let transport: any WildwoodTransport
    @ObservationIgnored private let tokens: WildwoodTokens
    @ObservationIgnored private var lastEvent: Int?
    @ObservationIgnored private var lastNudge: Int?
    @ObservationIgnored private var armedSeq: Int?
    @ObservationIgnored private var dealt = false
    @ObservationIgnored private var queue: [WildwoodEvent] = []
    @ObservationIgnored private var animator: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    /// How many missed log entries are played out when a table catches up
    /// (play.html's PLAY_OUT): a phone that slept through ten turns shouldn't
    /// spend a minute replaying them.
    static let playOutLimit = 10

    init(code: String, transport: any WildwoodTransport = AppSettings.client) {
        self.code = code
        self.transport = transport
        self.tokens = transport.wildwoodTokens
        self.device = tokens.held(for: code)
    }

    /// For a game this device was just handed in full, so the first frame
    /// isn't a spinner. Asked by whoever handed it over, not with this
    /// device's own token — so it can't say a seat was freed.
    convenience init(payload: WildwoodPayload, transport: any WildwoodTransport = AppSettings.client) {
        self.init(code: payload.code, transport: transport)
        take(payload, askedAs: nil)
    }

    var game: WildwoodGame? { payload?.game }
    var inviteURL: URL? { transport.wildwoodInviteURL(code: code) }
    var isDealer: Bool { device.host != nil }
    var mySeat: Int? { game?.mySeat }

    /// Pass-and-play's curtain: up whenever it's one of this device's seats
    /// to move and the screen isn't theirs yet — once the table has settled.
    var curtainFor: Int? {
        guard device.passAndPlay, !animating, let turn = game?.turn, device.seats.contains(turn), shownAs != turn else { return nil }
        return turn
    }

    private var askingToken: String? {
        // The screen's player keeps their view while their move plays out;
        // the curtain only goes up after it.
        if device.passAndPlay, let shown = shownAs, animating || game?.turn == shown { return device.seat(shown) }
        return device.askingToken
    }

    /// A hand as it should look right now: what's held, less what's still
    /// on its way from the pile.
    var shownHand: [String] {
        guard var hand = game?.hand else { return [] }
        for card in owedMine { if let i = hand.lastIndex(of: card) { hand.remove(at: i) } }
        return hand
    }

    func shownCount(_ seat: Int) -> Int {
        guard let game, game.handCounts.indices.contains(seat) else { return 0 }
        return max(0, game.handCounts[seat] - (owed[seat] ?? 0))
    }

    /// Who catches a forgotten call from this device: the seat on screen, or
    /// another seat it holds — never the one who forgot.
    var catcher: Int? {
        guard let game, !game.isOver, let exposed = game.exposed else { return nil }
        if let me = game.mySeat, me != exposed, device.seat(me) != nil { return me }
        return device.seats.first { $0 != exposed }
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
            let fresh = try await connection.track { try await transport.wildwoodState(code: code, token: asked) }
            if !busy, asked == askingToken { take(fresh, askedAs: asked) }
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            gone = true
        } catch {
            // A blip; the next tick tries again.
        }
    }

    // MARK: - moves

    func play(_ card: String, colour: String? = nil) async {
        guard let game else { return }
        let call = armed && game.hand?.count == 2
        await send(WildwoodMove(type: .play, card: card, colour: colour, call: call ? true : nil))
    }
    func draw() async { await send(WildwoodMove(type: .draw)) }
    func keep() async { await send(WildwoodMove(type: .pass)) }
    func take() async { await send(WildwoodMove(type: .take)) }
    func call() async { await send(WildwoodMove(type: .call)) }
    func catchForgotten() async {
        guard let seat = catcher else { return }
        await send(WildwoodMove(type: .catch), as: seat)
    }

    func toggleArmed() {
        armed.toggle()
        if armed { Sound.shared.play(.flip7, volume: 0.6) }
    }

    private func send(_ move: WildwoodMove, as seat: Int? = nil) async {
        guard !busy, !animating, !gone, let game, let seat = seat ?? game.mySeat, let token = device.seat(seat) else { return }
        busy = true
        defer { busy = false }
        var move = move
        move.seq = game.seq
        do {
            let fresh = try await transport.wildwoodMove(code: code, move, token: token)
            // Answered as another of this device's seats (a catch, in
            // pass-and-play): that's not the view on screen.
            if seat == game.mySeat { take(fresh, askedAs: token) } else { busy = false; await refresh() }
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

    func sit(at seat: Int) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await transport.wildwoodClaim(code: code, seat: seat)
            if let token = result.seatToken {
                device.setSeat(seat, token)
                tokens.set(device, for: code)
                tokens.lastGame = code
                shownAs = nil
            }
            take(result, askedAs: result.seatToken)
        } catch {
            notice = error.localizedDescription
        }
    }

    func free(_ seat: Int) async {
        guard !busy, let host = device.host else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await transport.wildwoodRelease(code: code, seat: seat, token: host)
            if device.seat(seat) != nil {
                device.setSeat(seat, nil)
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
            follow(to: try await transport.wildwoodRematch(code: code, token: host).code)
        } catch {
            notice = error.localizedDescription
        }
    }

    /// Pass-and-play: the player whose turn it is has the device.
    func openCurtain() {
        guard let seat = curtainFor else { return }
        shownAs = seat
        Sound.shared.play(.slide)
        Task { await refresh() }
    }

    // MARK: - taking a new game

    private func take(_ fresh: WildwoodPayload, askedAs token: String?) {
        // A poll answered after a move is older than what's on screen.
        guard fresh.code == code else { return }
        if let current = payload?.game.seq, fresh.game.seq < current { return }
        // A seat freed by the dealing device: that token sits nowhere now.
        for seat in device.seats where token == device.seat(seat) && fresh.you.seat != seat {
            device.setSeat(seat, nil)
            tokens.set(device, for: code)
            notice = "You’re no longer sitting at this table."
        }
        if let next = fresh.next, device.host != nil || !device.seats.isEmpty {
            follow(to: next)
            return
        }
        if fresh.game.seq != armedSeq {
            armed = false
            armedSeq = fresh.game.seq
        }
        let first = lastEvent == nil
        let fresher = first ? [] : Array(fresh.game.log.filter { $0.id > (lastEvent ?? 0) }.suffix(Self.playOutLimit))
        lastEvent = fresh.game.log.last?.id ?? 0
        let previous = payload
        payload = fresh

        if !dealt, fresh.game.seq == 0, curtainFor == nil {
            dealt = true
            queue.append(WildwoodEvent(id: 0, kind: "deal"))
        }
        // The pile shows what was there until each new card lands on it.
        if fresher.contains(where: { $0.kind == "play" }), let before = previous?.game {
            shownTop = before.top
            shownColour = before.colour
        }
        for event in fresher where event.kind == "draw" {
            guard let seat = event.seat, let count = event.count, count > 0 else { continue }
            if seat == fresh.game.mySeat, let cards = event.cards {
                owedMine += cards
            } else {
                owed[seat, default: 0] += count
            }
        }
        queue += fresher
        playOut()
        nudgeIfMyTurn()
    }

    /// A rematch is a new room with the same seats; every token carries over.
    private func follow(to next: String) {
        guard next != code else { return }
        tokens.set(device, for: next)
        if tokens.lastGame == code { tokens.lastGame = next }
        code = next
        payload = nil
        lastEvent = nil
        dealt = false
        shownAs = nil
        armed = false
        animator?.cancel()
        animator = nil
        animating = false
        burst = nil
        queue = []
        owed = [:]
        owedMine = []
        shownTop = nil
        shownColour = nil
        playedFrom = nil
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
            guard let self, !Task.isCancelled else { return }
            self.animating = false
            self.animator = nil
            self.shownTop = nil
            self.shownColour = nil
            self.playedFrom = nil
            self.nudgeIfMyTurn()
            // Pass-and-play: the curtain is up for the next player, so stop
            // holding the last mover's view and read the game as the table.
            if self.curtainFor != nil { Task { await self.refresh() } }
        }
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
    }

    private func say(_ text: String, _ kind: Burst.Kind, for seconds: Double) async {
        guard !Task.isCancelled else { return }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { burst = Burst(text: text, kind: kind) }
        await pause(seconds)
        withAnimation(.easeOut(duration: 0.2)) { burst = nil }
    }

    private func who(_ seat: Int?) -> String {
        guard let seat else { return "" }
        return seat == mySeat ? "You" : payload?.name(seat) ?? ""
    }

    private func perform(_ event: WildwoodEvent) async {
        let sound = Sound.shared
        switch event.kind {
        case "deal":
            sound.play(.riffle)
            await pause(0.9)
        case "play":
            guard let card = event.card else { break }
            sound.play(.flick)
            playedFrom = event.seat
            withAnimation(.spring(response: 0.38, dampingFraction: 0.72)) {
                shownTop = card
                shownColour = event.colour
                landings += 1
            }
            await pause(0.32)
            sound.play(.land)
            if event.called == true {
                sound.play(.flip7, volume: 0.7)
                await say("\(who(event.seat)): Last card!", .call, for: 0.8)
            }
            if WildwoodCard.isWild(card), let colour = event.colour {
                await say(WildwoodCard.colourName(colour).capitalized + "!", .plain, for: 0.6)
            }
            if WildwoodCard.symbol(card) == "D" || card == "W4" { sound.play(.stay) }
            await pause(0.15)
        case "skip":
            sound.play(.miss, volume: 0.6)
            withAnimation(.default) { skipped = event.seat }
            await say(event.seat == mySeat ? "You miss a go" : "\(who(event.seat)) misses a go", .plain, for: 0.7)
            skipped = nil
        case "reverse":
            sound.play(.slide)
            await pause(0.3)
        case "draw":
            let count = event.count ?? 0
            for _ in 0..<min(count, 6) {
                sound.play(.flick, volume: 0.7)
                withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                    if let seat = event.seat, seat == mySeat, !owedMine.isEmpty {
                        owedMine.removeFirst()
                    } else if let seat = event.seat, let left = owed[seat], left > 0 {
                        owed[seat] = left - 1
                    }
                }
                await pause(0.22)
            }
            // Anything past six arrives at once.
            withAnimation {
                if let seat = event.seat, seat == mySeat { owedMine.removeAll() } else if let seat = event.seat { owed[seat] = 0 }
            }
        case "call":
            sound.play(.flip7, volume: 0.7)
            await say("\(who(event.seat)): Last card!", .call, for: 0.8)
        case "catch":
            sound.play(.caught)
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            await say("Caught! \(who(event.seat)) \(event.seat == mySeat ? "draw" : "draws") 2", .caught, for: 1.0)
        case "reshuffle":
            sound.play(.riffle)
            await pause(0.5)
        case "game_over":
            sound.play(.flip7)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await say(event.winner == mySeat ? "You win!" : "\(who(event.winner)) wins!", .win, for: 1.6)
        default:
            await pause(0.05)
        }
    }

    /// Your turn, on your own device, is worth a buzz — once per turn.
    private func nudgeIfMyTurn() {
        guard pollTask != nil, !animating, curtainFor == nil, let game, game.myTurn, lastNudge != game.seq else { return }
        lastNudge = game.seq
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Sound.shared.play(.turn)
    }
}
