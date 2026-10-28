import Foundation
import Observation

// Hosting ito from the app. The room is the server's, as on the web: the
// app starts one (`POST /ito/api/rooms`), keeps the host token it's given,
// and sends it with every draw, result and reset in `X-Ito-Token`. Anyone
// with the code can watch; only the device holding the token deals.

/// `POST /ito/api/rooms` — a new room, the token that runs it and what
/// there is to draw from.
nonisolated struct ItoCreated: Decodable, Equatable {
    let code: String
    let hostToken: String
    let categories: [String]
}

nonisolated enum ItoOutcome: String, Encodable {
    case win, lose
}

/// The calls the host screen makes; `GameNightClient` in the app, a stand-in
/// in the tests.
protocol ItoHosting {
    func itoCreate() async throws -> ItoCreated
    func itoCategories() async throws -> [String]
    func itoState(code: String) async throws -> ItoState
    func itoDraw(code: String, category: String?, reroll: Bool, token: String) async throws -> ItoState
    func itoResult(code: String, outcome: ItoOutcome, token: String) async throws
    func itoReset(code: String, token: String) async throws -> ItoState
}

extension GameNightClient: ItoHosting {
    func itoCreate() async throws -> ItoCreated {
        try await send("POST", "ito/api/rooms")
    }

    func itoCategories() async throws -> [String] {
        try await send("GET", "ito/api/categories")
    }

    func itoDraw(code: String, category: String?, reroll: Bool, token: String) async throws -> ItoState {
        try await send("POST", "ito/api/\(code)/draw", body: Draw(category: category, reroll: reroll),
                       token: token, tokenHeader: "X-Ito-Token")
    }

    func itoResult(code: String, outcome: ItoOutcome, token: String) async throws {
        // The answer is the game's stats, which the host screen doesn't show.
        let _: Ignored = try await send("POST", "ito/api/\(code)/result", body: ["outcome": outcome],
                                        token: token, tokenHeader: "X-Ito-Token")
    }

    func itoReset(code: String, token: String) async throws -> ItoState {
        try await send("POST", "ito/api/\(code)/reset", token: token, tokenHeader: "X-Ito-Token")
    }

    private struct Draw: Encodable {
        let category: String?
        let reroll: Bool
    }

    private struct Ignored: Decodable {}
}

/// The rooms this device started, and the last one — kept per code in
/// UserDefaults, like the other games' tokens.
struct ItoHostTokens {
    var defaults: UserDefaults = .standard

    private static let tokensKey = "ito.hostTokens"
    private static let lastRoomKey = "ito.lastRoom"

    func token(for code: String) -> String? {
        all[code]
    }

    func set(_ token: String, for code: String) {
        var tokens = all
        tokens[code] = token
        // Rooms close after six idle hours; don't keep every code forever.
        if tokens.count > 30, let oldest = tokens.keys.sorted().first, oldest != code { tokens[oldest] = nil }
        defaults.set(tokens, forKey: Self.tokensKey)
    }

    var lastRoom: String? {
        get { defaults.string(forKey: Self.lastRoomKey) }
        nonmutating set { defaults.set(newValue, forKey: Self.lastRoomKey) }
    }

    private var all: [String: String] {
        defaults.dictionary(forKey: Self.tokensKey) as? [String: String] ?? [:]
    }
}

/// ito's host page in Swift: the room, the category to draw from, and the
/// rule that going for the next card is when the last round gets its
/// result. Three ways out of that question, as on the web: answer (records,
/// then deals), skip (deals without recording) or cancel (neither — the
/// round is still owed, so the next draw asks again).
@Observable
final class ItoHostStore {
    private(set) var code: String?
    private(set) var state: ItoState?
    private(set) var categories: [String] = []
    /// nil draws from every category ("Any").
    var category: String?
    /// The "how did the reveal go?" question is up.
    var asking = false
    /// Said under the deck: an empty category, a refused draw, no signal.
    private(set) var problem: String?
    private(set) var busy = false
    /// The room has gone: expired, or swept by a restart.
    private(set) var closed = false

    private let api: any ItoHosting
    private let tokens: ItoHostTokens
    /// Bumped by every change made from here, so a poll that set off before
    /// one can't land after it and put the older room back on screen.
    private var changes = 0

    /// `code` nil starts a new room; otherwise it's one this device started.
    init(code: String?, api: any ItoHosting = AppSettings.client, tokens: ItoHostTokens = ItoHostTokens()) {
        self.code = code
        self.api = api
        self.tokens = tokens
    }

    var token: String? { code.flatMap(tokens.token(for:)) }

    var roundNumber: Int { state?.roundNumber ?? 0 }

    /// The round on the table still needs its result.
    var unscored: Bool { roundNumber > 0 && state?.scored == false }

    /// Opens the room: makes it if there isn't one yet, otherwise catches up
    /// with it.
    func start() async {
        guard code == nil else {
            await refresh()
            if categories.isEmpty, !closed { categories = (try? await api.itoCategories()) ?? [] }
            return
        }
        busy = true
        changes += 1
        defer { busy = false }
        do {
            let created = try await api.itoCreate()
            tokens.set(created.hostToken, for: created.code)
            tokens.lastRoom = created.code
            code = created.code
            categories = created.categories
            state = try await api.itoState(code: created.code)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Catches up with the room — another device may be hosting it too.
    func refresh() async {
        guard let code else { return }
        let before = changes
        do {
            let fresh = try await api.itoState(code: code)
            guard changes == before else { return }
            state = fresh
            if token != nil { tokens.lastRoom = code }
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            // The same goes for "gone": it may be news of a room since replaced.
            guard changes == before else { return }
            gone()
        } catch {
            // Try again on the next tick.
        }
    }

    /// The deck was tapped. The round on the table is owed a result first.
    func requestDraw() async {
        if unscored {
            asking = true
        } else {
            await draw(reroll: false)
        }
    }

    /// The answer to "how did the reveal go?"; nil is "don't record it".
    /// Either way the next card is dealt — unless saving the answer failed,
    /// when the round is still owed it and dealing over it would lose that.
    func answer(_ outcome: ItoOutcome?) async {
        asking = false
        if let outcome, let code, let token {
            busy = true
            changes += 1
            do {
                try await api.itoResult(code: code, outcome: outcome, token: token)
            } catch {
                busy = false
                fail(error)
                return
            }
            busy = false
        }
        await draw(reroll: false)
    }

    /// "Not this one": a new card for the same round. Never asks for a
    /// result — the round it would score is the one being replaced.
    func reroll() async {
        await draw(reroll: true)
    }

    /// A fresh session in the same room: the topic history and round count
    /// go, the records stay.
    func reset() async {
        guard let code, let token else { return }
        busy = true
        changes += 1
        defer { busy = false }
        do {
            state = try await api.itoReset(code: code, token: token)
            problem = nil
        } catch {
            fail(error)
        }
    }

    /// The room has closed; start another.
    func startNew() async {
        code = nil
        state = nil
        closed = false
        await start()
    }

    private func draw(reroll: Bool) async {
        guard let code, let token, !busy else { return }
        busy = true
        changes += 1
        defer { busy = false }
        do {
            state = try await api.itoDraw(code: code, category: category, reroll: reroll, token: token)
            problem = nil
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: Error) {
        if let failure = error as? GameNightClient.Failure, failure.status == 404 {
            gone()
        } else {
            problem = error.localizedDescription
        }
    }

    private func gone() {
        closed = true
        if tokens.lastRoom == code { tokens.lastRoom = nil }
    }
}
