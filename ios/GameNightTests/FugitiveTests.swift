import Foundation
import Testing
@testable import GameNight

/// The Fugitive and profile fixtures are real responses from one scripted
/// game (`ios_fixtures` in tests/test_fugitive_play_api.py, which also
/// checks they still match the API).
private func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
    let bundle = Bundle(for: FixtureToken.self)
    let url = try #require(bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
                           ?? bundle.url(forResource: name, withExtension: "json"))
    return try GameNightClient.decoder.decode(T.self, from: Data(contentsOf: url))
}

private final class FixtureToken {}

@MainActor @Suite struct FugitiveModelTests {
    @Test func aNewGameShowsTheDealerTheTable() throws {
        let payload = try load("fugitive_created", as: FugitivePayload.self)
        #expect(payload.hostToken != nil)
        #expect(payload.you.role == "host" && payload.you.seat == nil)
        #expect(payload.name(.fugitive) == "Ana" && payload.name(.marshal) == "Ben")
        let game = payload.game
        #expect(game.viewer == "table" && game.viewerRole == nil)
        #expect(game.hand == nil)
        #expect(game.deckCounts.count == 3 && game.decks.count == 3)
        #expect(game.footprints.count == 43)
        #expect(game.hideouts.first?.card == 0)
        #expect(!game.myTurn)
    }

    @Test func theFugitiveSeesTheirHandAndTheirHideouts() throws {
        let payload = try load("fugitive_hide", as: FugitivePayload.self)
        let game = payload.game
        #expect(payload.you.seat == .fugitive)
        #expect(game.viewerRole == .fugitive && game.phase == .fugitiveHide && game.myTurn)
        #expect(game.hand == [9, 42])
        // Their own hideouts are face up to them, but not revealed.
        let last = try #require(game.hideouts.last)
        #expect(last.card == 13 && !last.revealed)
        #expect(last.sprints?.count == last.sprintCount)
        #expect(game.lastHideout == 13)
        #expect(game.candidates == nil)
    }

    @Test func theMarshalSeesBacksAndTheNotepadsHelp() throws {
        let game = try load("fugitive_marshal_guess", as: FugitivePayload.self).game
        #expect(game.viewerRole == .marshal && game.phase == .marshalGuess)
        #expect(game.hideouts.dropFirst().allSatisfy { $0.card == nil && $0.sprints == nil })
        // The count of tucked sprint cards is public; which ones isn't.
        #expect(game.hideouts.last?.sprintCount == 6)
        let candidates = try #require(game.candidates)
        #expect(candidates.count == game.hideouts.count)
        #expect(candidates[1] == [1, 2, 3])
    }

    @Test func theEndTurnsEverythingOverAndReadsAsCaseNotes() throws {
        let payload = try load("fugitive_game_over", as: FugitivePayload.self)
        let game = payload.game
        #expect(game.isOver && game.winner == .marshal && game.reason == "caught")
        #expect(game.hideouts.allSatisfy { $0.revealed && $0.card != nil })
        for event in game.log where event.kind != "game_over" {
            #expect(fugitiveNote(event, in: payload) != nil, "no wording for \(event.kind)")
        }
        let hid = try #require(game.log.first { $0.kind == "hid" && $0.card == 13 })
        #expect(fugitiveNote(hid, in: payload) == "Ana hid at 13, sprinting with 6 cards")
    }

    @Test func recordsDecodeInTheServersOrder() throws {
        let stats = try load("fugitive_stats", as: FugitiveStats.self)
        #expect(stats.gamesPlayed == 1)
        #expect(stats.leaderboard.map(\.name) == ["Ben", "Ana"])
        #expect(stats.leaderboard[0].marshalWins == 1 && stats.leaderboard[0].winRate == 100)
        let recent = try #require(stats.recent.first)
        #expect(recent.winner == .marshal && recent.hideouts == 2)
        #expect(FugitiveRecordsView.headline(recent) == "Ben caught Ana")
    }

    @Test func movesLeaveOutWhatDoesntApply() throws {
        let data = try JSONEncoder().encode(FugitiveMove(type: .letGo, seq: 3))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["type"] as? String == "let_go")
        #expect(json["seq"] as? Int == 3)
        #expect(json["deck"] == nil && json["card"] == nil && json["numbers"] == nil)

        let hide = try JSONEncoder().encode(FugitiveMove(type: .hide, card: 9, sprints: [5, 7], seq: 4))
        let hideJSON = try #require(JSONSerialization.jsonObject(with: hide) as? [String: Any])
        #expect(hideJSON["card"] as? Int == 9 && hideJSON["sprints"] as? [Int] == [5, 7])
    }
}

@Suite struct FugitiveDeviceTests {
    @Test func aDeviceAsksAsItsOneSeatOrAsTheTable() {
        #expect(FugitiveDevice(host: "h").askingToken == "h")
        #expect(FugitiveDevice(host: "h", marshal: "m").askingToken == "m")
        #expect(FugitiveDevice(fugitive: "f").askingToken == "f")
        // Pass-and-play: nobody's hand until the folder is opened.
        #expect(FugitiveDevice(host: "h", fugitive: "f", marshal: "m", pass: true).askingToken == "h")
    }

    @Test func aRematchSwapsTheSeatsTokens() {
        let device = FugitiveDevice(host: "h", fugitive: "f", marshal: nil)
        let swapped = device.swapped
        #expect(swapped.host == "h" && swapped.marshal == "f" && swapped.fugitive == nil)
        #expect(swapped.seats == [.marshal])
    }

    @Test func tokensAreKeptPerGame() throws {
        let defaults = try #require(UserDefaults(suiteName: "fugitive-tests-\(UUID())"))
        let tokens = FugitiveTokens(defaults: defaults)
        #expect(tokens.held(for: "ABCD") == FugitiveDevice())
        tokens.set(FugitiveDevice(host: "h", fugitive: "f"), for: "ABCD")
        #expect(tokens.held(for: "ABCD").seat(.fugitive) == "f")
        #expect(tokens.held(for: "WXYZ").seats.isEmpty)
        tokens.lastNames = ["fugitive": "Ana", "marshal": "Ben"]
        #expect(tokens.lastNames["marshal"] == "Ben")
    }
}

@Suite struct ProfileTests {
    @Test func profilesDecode() throws {
        let list = try load("profiles", as: ProfileList.self)
        #expect(list.profiles.map(\.name) == ["Ana"])
        #expect(list.profiles[0].photo == nil)

        let made = try load("profile_created", as: HeldProfile.self)
        #expect(made.profile.id == list.profiles[0].id && !made.token.isEmpty)

        let link = try load("profile_link", as: ProfileLink.self)
        #expect(link.expiresIn == 600)
        #expect(Joining.profileLink(in: try #require(URL(string: link.url))) == link.code)
    }

    @MainActor @Test func namesFoldAndInitialLikeTheWeb() {
        #expect(Faces.fold("  Ana   Maria ") == "ana maria")
        #expect(AvatarView.initials("Ana Maria Lopez") == "AL")
        #expect(AvatarView.initials("ben") == "BE")
    }
}

@Suite struct ScannedLinkTests {
    @Test func signInLinksAreToldApartFromRooms() {
        let site = "https://gamenight.collardserver.co.uk"
        #expect(Joining.profileLink(in: URL(string: "\(site)/me/link/JPAI-SSBFWPr")!) == "JPAI-SSBFWPr")
        #expect(Joining.profileLink(in: URL(string: "gamenight://me/link/abc")!) == "abc")
        #expect(Joining.profileLink(in: URL(string: "\(site)/me")!) == nil)
        #expect(Joining.profileLink(in: URL(string: "\(site)/fugitive/play/ABCD")!) == nil)

        #expect(Joining.code(in: URL(string: "\(site)/fugitive/play/abcd")!) == "ABCD")
        #expect(Joining.code(in: URL(string: "\(site)/me/link/ABCD")!) == nil)

        #expect(Joining.isOurs(URL(string: "\(site)/me/link/xyz")!))
        #expect(Joining.isOurs(URL(string: "\(site)/flip7/play/K7M3")!))
        #expect(!Joining.isOurs(URL(string: "https://example.com/somewhere")!))
    }
}

/// The mugshots and the city map are drawn from fugitive.js's seeded
/// randomness, so a name looks the same on a phone and in the browser.
/// These values come from running fugitive.js's own `seeded`/`nameSeed`.
@Suite struct SeededTests {
    @Test func nameSeedsMatchTheWeb() {
        #expect(Seeded.nameSeed("Ana") == 282_127)
        #expect(Seeded.nameSeed("  BEN ") == 370_327)
        #expect(Seeded.nameSeed("Zoë") == 292_684)
    }

    @Test func theSequenceMatchesTheWeb() {
        var r = Seeded(Seeded.nameSeed("Ana"))
        let expected = [0.404637991684, 0.704882151913, 0.767929271096]
        for value in expected {
            #expect(abs(r.next() - value) < 1e-9)
        }
        var q = Seeded(42)
        #expect(abs(q.next() - 0.403652096167) < 1e-9)
    }
}
