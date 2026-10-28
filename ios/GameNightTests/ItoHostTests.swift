import Foundation
import Testing
@testable import GameNight

/// Hosting ito from the app: the server's answers decode, and the host
/// screen asks for a round's result exactly when the web's host page does.
@MainActor @Suite struct ItoHostTests {
    let tokens = ItoHostTokens(defaults: UserDefaults(suiteName: "ito-\(UUID().uuidString)")!)

    @Test func theServersAnswersDecode() throws {
        let created = try GameNightClient.decoder.decode(
            ItoCreated.self, from: FugitiveEngineTests.fixture("ito_created"))
        #expect(created.code.count == 4)
        #expect(!created.hostToken.isEmpty)
        #expect(created.categories.contains("family"))
        let fresh = try GameNightClient.decoder.decode(ItoState.self, from: FugitiveEngineTests.fixture("ito_created"))
        #expect(fresh.roundNumber == 0 && fresh.currentTopic == nil)

        let drawn = try GameNightClient.decoder.decode(ItoState.self, from: FugitiveEngineTests.fixture("ito_drawn"))
        #expect(drawn.code == created.code)
        #expect(drawn.roundNumber == 1 && drawn.drawId == 1 && !drawn.scored)
        #expect(drawn.currentTopic != nil && drawn.currentCategory != nil)
    }

    @Test func startingARoomKeepsItsTokenAndOffersItBack() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        #expect(store.code == "ABCD")
        #expect(store.token == "secret")
        #expect(tokens.lastRoom == "ABCD")
        #expect(store.categories == ["family", "action"])
        #expect(store.roundNumber == 0)
    }

    @Test func goingForTheNextCardAsksHowTheLastOneWent() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()

        // Nothing to score yet: the first card is dealt straight away.
        await store.requestDraw()
        #expect(!store.asking && store.roundNumber == 1)

        // Now the round is owed its result.
        await store.requestDraw()
        #expect(store.asking && store.roundNumber == 1)

        // Answering records it, then deals.
        await store.answer(.win)
        #expect(server.results == [.win])
        #expect(!store.asking && store.roundNumber == 2)

        // Cancelling does neither, and the next tap asks again.
        await store.requestDraw()
        store.asking = false
        #expect(store.roundNumber == 2 && server.results == [.win])
        await store.requestDraw()
        #expect(store.asking)

        // "Don't record it" deals without recording.
        await store.answer(nil)
        #expect(server.results == [.win] && store.roundNumber == 3)
    }

    @Test func aSwappedCardIsNotARound() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        store.category = "action"
        await store.requestDraw()
        await store.reroll()
        #expect(!store.asking)
        #expect(store.roundNumber == 1 && store.state?.drawId == 2)
        #expect(server.draws.map(\.reroll) == [false, true])
        #expect(server.draws.map(\.category) == ["action", "action"])
    }

    @Test func aResultThatDidntSaveIsStillOwed() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        await store.requestDraw()
        server.failResults = true
        await store.requestDraw()
        await store.answer(.lose)
        #expect(store.roundNumber == 1)
        #expect(store.problem == "The records are damaged.")
        await store.requestDraw()
        #expect(store.asking)
    }

    @Test func aClosedRoomSaysSoAndIsNotOfferedBack() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        server.gone = true
        await store.refresh()
        #expect(store.closed)
        #expect(tokens.lastRoom == nil)

        server.gone = false
        await store.startNew()
        #expect(!store.closed && store.code == "ABCD")
    }

    @Test func aRoomThisDeviceDidntStartCantBeDealtFrom() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: "WXYZ", api: server, tokens: tokens)
        await store.start()
        #expect(store.token == nil)
        await store.requestDraw()
        #expect(server.draws.isEmpty)
    }

    @Test func aPollThatSetOffBeforeADealDoesntUndoIt() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        // The poll reads the room, then a card is dealt before its answer
        // gets back: the older room must not land over the new card.
        server.whileAnsweringState = { await store.requestDraw() }
        await store.refresh()
        #expect(store.roundNumber == 1 && store.state?.drawId == 1)

        // With nothing dealt meanwhile, a poll catches up as before.
        server.whileAnsweringState = nil
        await store.refresh()
        #expect(store.roundNumber == 1)
    }

    @Test func aNewSessionKeepsTheRoom() async {
        let server = FakeItoServer()
        let store = ItoHostStore(code: nil, api: server, tokens: tokens)
        await store.start()
        await store.requestDraw()
        await store.reset()
        #expect(store.code == "ABCD" && store.roundNumber == 0)
        await store.requestDraw()
        #expect(!store.asking && store.roundNumber == 1)
    }
}

/// games/ito/game.py's room rules, enough for the host screen: a draw is a
/// new round unless it's a reroll, a result scores the round once.
@MainActor final class FakeItoServer: ItoHosting {
    var round = 0, drawId = 0, scored = false
    var draws: [(category: String?, reroll: Bool)] = []
    var results: [ItoOutcome] = []
    var failResults = false
    var gone = false
    /// Runs between reading the room and answering with it — a request that
    /// lands while a poll is on its way back.
    var whileAnsweringState: (() async -> Void)?

    private func check(_ token: String?) throws {
        if gone { throw GameNightClient.Failure.server(status: 404, message: "gone", payload: nil) }
        if let token, token != "secret" { throw GameNightClient.Failure.server(status: 403, message: "no", payload: nil) }
    }

    private var state: ItoState {
        ItoState(code: "ABCD", currentTopic: drawId > 0 ? "Topic \(drawId)" : nil,
                 currentCategory: drawId > 0 ? "family" : nil, currentLow: nil, currentHigh: nil,
                 currentType: nil, roundNumber: round, drawId: drawId, scored: scored)
    }

    func itoCreate() async throws -> ItoCreated {
        try check(nil)
        (round, drawId, scored) = (0, 0, false)
        return ItoCreated(code: "ABCD", hostToken: "secret", categories: ["family", "action"])
    }

    func itoCategories() async throws -> [String] { ["family", "action"] }

    func itoState(code: String) async throws -> ItoState {
        try check(nil)
        let answer = state
        await whileAnsweringState?()
        return answer
    }

    func itoDraw(code: String, category: String?, reroll: Bool, token: String) async throws -> ItoState {
        try check(token)
        draws.append((category, reroll))
        drawId += 1
        if !reroll || round == 0 {
            round += 1
            scored = false
        }
        return state
    }

    func itoResult(code: String, outcome: ItoOutcome, token: String) async throws {
        try check(token)
        if failResults { throw GameNightClient.Failure.server(status: 503, message: "The records are damaged.", payload: nil) }
        results.append(outcome)
        scored = true
    }

    func itoReset(code: String, token: String) async throws -> ItoState {
        try check(token)
        (round, drawId, scored) = (0, 0, false)
        return state
    }
}
