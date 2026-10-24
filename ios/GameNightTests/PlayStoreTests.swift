import Foundation
import Testing
@testable import GameNight

/// Who may tap what — the rules the web page follows too (play.html's
/// `canAct`), so a phone and the iPad agree.
@Suite struct PlayStoreTests {
    private func tokens() -> TokenStore {
        let suite = "PlayStoreTests.\(UUID().uuidString)"
        return TokenStore(defaults: UserDefaults(suiteName: suite)!)
    }

    private let client = GameNightClient(baseURL: URL(string: "http://localhost:1")!)

    @Test func aWatcherCanDoNothingAndIsOfferedASeat() throws {
        let payload = try fixture("play_created")
        let store = PlayStore(payload: payload, client: client, tokens: tokens())
        // The fixture was created with a dealer token this store never saw.
        #expect(store.mode == .watch)
        #expect(!store.canAct(0) && !store.canAct(1))
        #expect(store.offersSeat)
    }

    @Test func theDealerPlaysEverySeatNotOnAPhone() throws {
        let payload = try fixture("play_created")
        let tokens = tokens()
        tokens.setHostToken("dealer", for: payload.code)
        let store = PlayStore(code: payload.code, client: client, tokens: tokens)
        #expect(store.mode == .table)
        #expect(store.token(for: 1) == "dealer")
    }

    @Test func aPhoneMovesOnlyForItsOwnSeatWithItsOwnToken() throws {
        let payload = try fixture("play_created")
        let tokens = tokens()
        tokens.setSeat(SeatClaim(seat: 2, token: "cat"), for: payload.code)
        let store = PlayStore(code: payload.code, client: client, tokens: tokens)
        #expect(store.mode == .player)
        #expect(store.canAct(2))
        #expect(!store.canAct(0))
        #expect(store.token(for: 2) == "cat")
    }

    @Test func aRematchCarriesTheTokensAcross() {
        let tokens = tokens()
        tokens.setHostToken("dealer", for: "ABCD")
        tokens.setSeat(SeatClaim(seat: 1, token: "ben"), for: "ABCD")
        tokens.lastGame = "ABCD"
        tokens.carry(from: "ABCD", to: "WXYZ")
        #expect(tokens.hostToken(for: "WXYZ") == "dealer")
        #expect(tokens.seat(for: "WXYZ") == SeatClaim(seat: 1, token: "ben"))
        #expect(tokens.lastGame == "WXYZ")
    }
}
