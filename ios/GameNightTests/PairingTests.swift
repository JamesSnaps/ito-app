import Foundation
import Testing
@testable import GameNight

/// Pairing (app 1.17.0, server 1.36.0): the server's answers decode, and a new
/// device's sign-in QR is told apart from rooms and add-a-device links.
@Suite struct PairingTests {
    func load<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        try GameNightClient.decoder.decode(type, from: FugitiveEngineTests.fixture(name))
    }

    @Test func theServersAnswersDecode() throws {
        let ask = try load("profile_pair_ask", as: PairAsk.self)
        #expect(ask.code.count == 6 && !ask.secret.isEmpty && ask.expiresIn == 300)
        #expect(Joining.pairCode(in: try #require(URL(string: ask.url))) == ask.code)

        let waiting = try load("profile_pair_requests", as: PairRequests.self).requests
        #expect(waiting.map(\.code) == [ask.code])
        #expect(waiting[0].where == nil && waiting[0].description == waiting[0].device)

        let approved = try load("profile_pair_approved", as: PairStatus.self)
        #expect(approved.status == "approved" && approved.profile?.name == "Ana" && approved.token?.isEmpty == false)
        let waitingStatus = try GameNightClient.decoder.decode(PairStatus.self, from: Data(#"{"status": "waiting"}"#.utf8))
        #expect(waitingStatus.profile == nil && waitingStatus.token == nil)
    }

    @Test func theRequestReadsTheWayThePersonSayingYesNeedsIt() {
        let home = PairRequest(code: "K7F2QD", device: "Chrome on a Mac", where: "home", expiresIn: 200)
        #expect(home.description == "Chrome on a Mac, on the home Wi-Fi")
        let away = PairRequest(code: "K7F2QD", device: "Safari on an iPad", where: "away", expiresIn: 200)
        #expect(away.description == "Safari on an iPad, not on the home Wi-Fi")
        #expect(PairRequest.spaced("K7F2QD") == "K7F 2QD")
    }

    @Test func signInQRsAreToldApartFromRoomsAndLinks() {
        let site = "https://gamenight.collardserver.co.uk"
        #expect(Joining.pairCode(in: URL(string: "\(site)/me/pair/K7F2QD")!) == "K7F2QD")
        #expect(Joining.pairCode(in: URL(string: "\(site)/me/pair/k7f2qd")!) == "K7F2QD")
        #expect(Joining.pairCode(in: URL(string: "gamenight://me/pair/K7F2QD")!) == "K7F2QD")
        // Six from the room alphabet: no I, O, 0 or 1, nothing longer.
        #expect(Joining.pairCode(in: URL(string: "\(site)/me/pair/K7F2Q0")!) == nil)
        #expect(Joining.pairCode(in: URL(string: "\(site)/me/pair/K7F2QDX")!) == nil)
        #expect(Joining.pairCode(in: URL(string: "\(site)/me/link/K7F2QD")!) == nil)
        #expect(Joining.profileLink(in: URL(string: "\(site)/me/pair/K7F2QD")!) == nil)
        #expect(Joining.code(in: URL(string: "\(site)/me/pair/K7F2QD")!) == nil)
        #expect(Joining.isOurs(URL(string: "\(site)/me/pair/K7F2QD")!))
    }
}
