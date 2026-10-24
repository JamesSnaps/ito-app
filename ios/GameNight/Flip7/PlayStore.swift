import Foundation
import Observation
import UIKit

/// One Flip 7 table, as this device sees it. The same three ways of being at
/// a table as the web page:
///
/// - `.table`  — this device dealt (it holds the dealer's token) and plays
///   every seat that isn't on a phone: the iPad in the middle.
/// - `.player` — this device sits at one seat and plays that seat's turns.
///   If it also dealt, it can step in for a phone that's gone quiet.
/// - `.watch`  — neither: a read-only table, with an offer to sit down.
///
/// The rules are all on the server. This holds the latest table, polls for
/// the next one, and sends moves stamped with the `seq` it was looking at,
/// so a double tap can't play twice.
@Observable
final class PlayStore {
    enum Mode { case table, player, watch }

    private(set) var code: String
    private(set) var payload: PlayPayload?
    private(set) var hostToken: String?
    private(set) var seat: SeatClaim?
    private(set) var busy = false
    /// The game expired, or the code was never a game.
    private(set) var gone = false
    /// A short message to show and clear: a refused move, a lost seat.
    var notice: String?
    /// The name to put on the Flip 7 flash, cleared by the view.
    var flip7Flash: String?
    /// Seats that just busted, for a shake.
    private(set) var justBusted: Set<Int> = []
    /// Set when this device saw the game end, for the winner alert.
    var announcement: String?
    /// A phone's seat the dealer has chosen to play for.
    var actingFor: Int?
    /// Watching on purpose: don't keep offering a seat.
    var justWatching = false

    @ObservationIgnored private let client: GameNightClient
    @ObservationIgnored private let tokens: TokenStore
    @ObservationIgnored private var lastEvent: Int?
    @ObservationIgnored private var lastNudge: Int?
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    init(code: String, client: GameNightClient = AppSettings.client, tokens: TokenStore = TokenStore()) {
        self.code = code
        self.client = client
        self.tokens = tokens
        self.hostToken = tokens.hostToken(for: code)
        self.seat = tokens.seat(for: code)
    }

    /// For a game this device has just been handed in full (created, or
    /// checked on the way in), so the first frame isn't a spinner.
    convenience init(payload: PlayPayload, client: GameNightClient = AppSettings.client, tokens: TokenStore = TokenStore()) {
        self.init(code: payload.code, client: client, tokens: tokens)
        take(payload, askedAs: payload.hostToken ?? payload.seatToken)
    }

    // MARK: - who can do what

    var game: Game? { payload?.game }
    var seats: [Seat] { payload?.seats ?? [] }
    var mySeat: Int? { seat?.seat }

    var mode: Mode {
        if mySeat != nil { return .player }
        if hostToken != nil { return .table }
        return .watch
    }

    func takenByPhone(_ p: Int) -> Bool {
        seats.indices.contains(p) && seats[p].taken && p != mySeat
    }

    /// Your own seat, always. The dealer's device also plays every seat that
    /// isn't on a phone — that's the shared iPad — and steps in for one that
    /// is only when asked to, so nobody's turn gets tapped from across the room.
    func canAct(_ p: Int) -> Bool {
        if p == mySeat { return true }
        guard hostToken != nil else { return false }
        return p == actingFor || !takenByPhone(p)
    }

    /// A phone's own seat goes out with its seat token; anything else this
    /// device does, it does as the dealer.
    func token(for p: Int?) -> String? {
        if let p, p == mySeat, let seat { return seat.token }
        return hostToken ?? seat?.token
    }

    var openSeats: [Int] { seats.indices.filter { !seats[$0].taken } }

    var offersSeat: Bool {
        mode == .watch && !justWatching && !openSeats.isEmpty && game?.phase != .gameOver
    }

    /// Whose move the table is waiting on, while a round is live.
    var actingSeat: Int? {
        guard let game, game.phase == .playing else { return nil }
        return game.pending?.player
    }

    var isMyTurn: Bool { mode == .player && actingSeat != nil && actingSeat == mySeat }

    /// The action card this device has to hand out right now, if any.
    var giveForMe: Pending? {
        guard let game, game.phase == .playing, let pending = game.pending,
              pending.kind == .give, canAct(pending.player) else { return nil }
        return pending
    }

    // MARK: - polling

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                // Faster while a round is live: on a phone the poll is how
                // you find out it's your turn.
                let live = self?.game?.phase == .playing
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
        do {
            let asked = seat?.token ?? hostToken
            let fresh = try await client.state(code: code, token: asked)
            if !busy { take(fresh, askedAs: asked) }
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            gone = true
        } catch {
            // Retry on the next tick; a blip shouldn't interrupt the game.
        }
    }

    // MARK: - actions

    func send(_ kind: Move.Kind, player: Int?, target: Int? = nil) async {
        guard !busy, let game, let token = token(for: player) else { return }
        busy = true
        defer { busy = false }
        do {
            let move = Move(type: kind, player: player, target: target, seq: game.seq)
            take(try await client.move(code: code, move, token: token), askedAs: token)
        } catch let failure as GameNightClient.Failure {
            if let payload = failure.payload { take(payload, askedAs: token) }
            if failure.status == 404 { gone = true } else { notice = failure.errorDescription }
        } catch {
            notice = error.localizedDescription
        }
    }

    func sit(at seatIndex: Int) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await client.claim(code: code, seat: seatIndex)
            if let token = result.seatToken {
                let claim = SeatClaim(seat: seatIndex, token: token)
                seat = claim
                tokens.setSeat(claim, for: code)
                tokens.lastGame = code
            }
            take(result, askedAs: result.seatToken)
        } catch let failure as GameNightClient.Failure {
            if let payload = failure.payload { take(payload, askedAs: nil) }
            notice = failure.errorDescription
        } catch {
            notice = error.localizedDescription
        }
    }

    /// The dealer frees a seat — someone sat in the wrong one, or this
    /// device is going back to being the table.
    func free(seat seatIndex: Int) async {
        guard !busy, let hostToken else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await client.release(code: code, seat: seatIndex, token: hostToken)
            if seatIndex == mySeat { forgetSeat() }
            take(result, askedAs: hostToken)
        } catch {
            notice = error.localizedDescription
        }
    }

    func rematch() async {
        guard !busy, let hostToken else { return }
        busy = true
        defer { busy = false }
        do {
            let next = try await client.rematch(code: code, token: hostToken)
            follow(to: next.code)
        } catch {
            notice = error.localizedDescription
        }
    }

    // MARK: - taking a new table

    /// `askedAs` is the token the request carried. `you` describes that
    /// token, so only an answer to the seat token can say the seat is gone —
    /// a move made as the dealer comes back as `host` even on a device that
    /// also has a seat.
    private func take(_ fresh: PlayPayload, askedAs token: String?) {
        let before = payload?.game
        noteEvents(in: fresh.game)
        payload = fresh

        // The dealer freed this phone's seat (or the game was recreated).
        if let seat, token == seat.token, fresh.you.role != .seat, fresh.code == code {
            forgetSeat()
            notice = "Your seat was freed on the dealer’s device. Pick it again to rejoin."
        }
        if let actingFor, actingSeat != actingFor { self.actingFor = nil }
        if let before, before.phase != .gameOver, fresh.game.phase == .gameOver {
            announcement = winnerLine(fresh.game)
        }
        if let next = fresh.next { follow(to: next) }
        nudgeIfMyTurn()
    }

    /// A rematch is a new room. The dealer's and the players' tokens carry
    /// over, so this device just moves across with what it has.
    private func follow(to next: String) {
        guard next != code else { return }
        tokens.carry(from: code, to: next)
        code = next
        hostToken = tokens.hostToken(for: next)
        seat = tokens.seat(for: next)
        lastEvent = nil
        payload = nil
        Task { await refresh() }
    }

    private func forgetSeat() {
        seat = nil
        tokens.setSeat(nil, for: code)
    }

    /// New log entries since the last look: the moments worth more than a
    /// redraw. Skipped on the first load, so opening a game doesn't replay it.
    private func noteEvents(in game: Game) {
        let fresh = lastEvent.map { last in game.log.filter { $0.id > last } } ?? []
        lastEvent = game.log.last?.id ?? 0
        for event in fresh {
            switch event.kind {
            case "flip7":
                if let p = event.player, game.players.indices.contains(p) {
                    flip7Flash = game.players[p].name
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            case "bust":
                if let p = event.player {
                    justBusted.insert(p)
                    if p == mySeat { UINotificationFeedbackGenerator().notificationOccurred(.error) }
                    Task { [weak self] in
                        try? await Task.sleep(for: .milliseconds(700))
                        self?.justBusted.remove(p)
                    }
                }
            default:
                break
            }
        }
    }

    /// On a phone, your turn is the thing worth a buzz — once per turn.
    private func nudgeIfMyTurn() {
        guard isMyTurn, let seq = game?.seq, lastNudge != seq else { return }
        lastNudge = seq
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    private func winnerLine(_ game: Game) -> String {
        let names = game.winners.map { game.players[$0].name }
        let score = game.winners.first.map { game.players[$0].total } ?? 0
        if names.count == 1, game.winners.first == mySeat { return "You win, on \(score)!" }
        if names.count > 1 { return "\(names.joined(separator: " & ")) share it, on \(score)." }
        return "\(names.first ?? "Someone") wins, on \(score)."
    }
}
