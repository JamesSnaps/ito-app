import Foundation
import Testing
@testable import GameNight

/// A nearby phone plays the host's offline game through the same API: every
/// call goes as JSON (as it would over the air) and comes back as the
/// server would have answered it, for that phone's token only.
@MainActor @Suite struct NearbyTests {
    let table = OfflineTable(shelf: OfflineShelf(
        folder: FileManager.default.temporaryDirectory.appendingPathComponent("nearby-\(UUID().uuidString)")))

    /// A guest whose requests reach the host's responder as bytes and back.
    func guest() -> NearbyTransport {
        let responder = NearbyResponder(table: table)
        return NearbyTransport { request in
            let sent = try JSONEncoder().encode(request)
            let reply = try #require(await responder.answer(sent))
            return try JSONDecoder().decode(NearbyResponse.self, from: reply)
        }
    }

    @Test func aGuestSitsDownAndSeesOnlyItsOwnHand() async throws {
        let dealt = try table.create(fugitive: "Ana", marshal: "Ben")
        let host = try #require(dealt.hostToken)
        let ana = try #require(try await table.fugitiveClaim(code: dealt.code, role: .fugitive).seatToken)

        // Ben's phone, across the table.
        let ben = guest()
        let watching = try await ben.fugitiveState(code: dealt.code, token: nil)
        #expect(watching.game.viewer == "table" && watching.game.hand == nil && !watching.taken(.marshal))
        let sat = try await ben.fugitiveClaim(code: dealt.code, role: .marshal)
        let benToken = try #require(sat.seatToken)
        #expect(sat.you.seat == .marshal && sat.game.hand == [])

        // Ana hides from the host phone; Ben's phone sees a face-down card.
        let anaView = try await table.fugitiveState(code: dealt.code, token: ana)
        let card = try #require(anaView.game.hand?.first { (1...3).contains($0) })
        _ = try await table.fugitiveMove(code: dealt.code, FugitiveMove(type: .hide, card: card, sprints: [], seq: 0),
                                         token: ana)
        let seen = try await ben.fugitiveState(code: dealt.code, token: benToken)
        #expect(seen.game.hideouts.count == 2 && seen.game.hideouts[1].card == nil)

        // Refusals come back as the server's would.
        await #expect(throws: GameNightClient.Failure.server(status: 409, message: "Someone's already sitting there.", payload: nil)) {
            try await ben.fugitiveClaim(code: dealt.code, role: .fugitive)
        }
        await #expect(throws: GameNightClient.Failure.server(status: 403, message: "Only the device that dealt can free a seat.", payload: nil)) {
            try await ben.fugitiveRelease(code: dealt.code, role: .fugitive, token: benToken)
        }
        // Still the Fugitive's opening turn: one more hideout, or stop there.
        await #expect(throws: GameNightClient.Failure.server(status: 400, message: "It isn't your turn.", payload: nil)) {
            try await ben.fugitiveMove(code: dealt.code, FugitiveMove(type: .draw, deck: 0, seq: 1), token: benToken)
        }
        // And only the dealing phone deals again.
        await #expect(throws: GameNightClient.Failure.server(status: 403, message: "Only the device that dealt can start a rematch.", payload: nil)) {
            try await ben.fugitiveRematch(code: dealt.code, token: benToken)
        }
        #expect(try await ben.fugitiveState(code: dealt.code, token: host).you.role == "host")
    }

    @Test func requestsAndAnswersSurviveTheTripAsJSON() throws {
        let calls: [NearbyCall] = [
            .state(code: "ABCD", token: nil), .state(code: "ABCD", token: "t"),
            .move(code: "ABCD", move: FugitiveMove(type: .guess, numbers: [4, 9], seq: 7), token: "t"),
            .claim(code: "ABCD", role: .marshal), .release(code: "ABCD", role: .fugitive, token: "h"),
            .rematch(code: "ABCD", token: "h"),
        ]
        for call in calls {
            let request = NearbyRequest(call: call)
            #expect(try JSONDecoder().decode(NearbyRequest.self, from: JSONEncoder().encode(request)) == request)
        }
    }
}
