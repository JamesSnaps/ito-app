import Foundation
import Testing
@testable import GameNight

/// The hub's web games (app 1.14.0): the server's list decodes, the app keeps
/// its own tiles for its own games, the list is kept for offline, a web game
/// is signed in as the app's profile exactly as the web stores it, and links
/// off the server leave the game.
@MainActor @Suite struct WebGamesTests {
    let store = WebGames(defaults: UserDefaults(suiteName: "webgames-\(UUID().uuidString)")!)
    let me = HeldMe(id: "fcdcc1e416", name: "Ana", photo: "/profiles/photos/fcdcc1e416-ab12.jpg", token: "s3cret")

    func listing(_ id: String, native: Bool = false, path: String? = nil) -> GameListing {
        GameListing(id: id, name: id, tagline: "", accent: "#e8553f", path: path ?? "/\(id)/",
                    action: "Play", nativeApp: native)
    }

    // MARK: The list

    @Test func theServersListDecodes() throws {
        let list = try GameNightClient.decoder.decode(GameList.self, from: FugitiveEngineTests.fixture("games"))
        let ids = list.games.map(\.id)
        #expect(ids.contains("flip7") && ids.contains("final-approach"))
        let approach = try #require(list.games.first { $0.id == "final-approach" })
        #expect(approach.name == "Final Approach")
        #expect(approach.path == "/final-approach/")
        #expect(approach.action == "Play")
        #expect(!approach.nativeApp)
        #expect(approach.accentHex == 0xE8553F)
        #expect(list.games.first { $0.id == "flip7" }?.nativeApp == true)
    }

    @Test func onlyGamesWithoutAScreenHereGetAWebTile() throws {
        let list = try GameNightClient.decoder.decode(GameList.self, from: FugitiveEngineTests.fixture("games"))
        #expect(WebGames.webOnly(list.games).map(\.id) == ["final-approach"])

        // A game this build doesn't know is a web tile, even one the server
        // says a later build has a screen for; one this build has never is.
        let games = [listing("ito", native: false), listing("final-vector"), listing("someday", native: true)]
        #expect(WebGames.webOnly(games).map(\.id) == ["final-vector", "someday"])
        // Only a path on the server.
        #expect(WebGames.webOnly([listing("odd", path: "https://elsewhere.example/")]).isEmpty)
    }

    @Test func anOlderListWithoutAnActionStillDecodes() throws {
        let json = ##"{"games": [{"id": "x", "name": "X", "tagline": "t", "accent": "#abc", "path": "/x/", "native_app": false}]}"##
        let list = try GameNightClient.decoder.decode(GameList.self, from: Data(json.utf8))
        #expect(list.games[0].action == nil)
        #expect(list.games[0].accentHex == 0xAABBCC)
        #expect(listing("x").accentHex == 0xE8553F)
        #expect(GameListing(id: "x", name: "", tagline: "", accent: "red", path: "/", action: nil, nativeApp: false).accentHex == nil)
    }

    @Test func theLastListIsKeptForNoSignal() async {
        #expect(store.cached.isEmpty)
        store.remember([listing("flip7", native: true), listing("final-approach")])
        #expect(store.cached.map(\.id) == ["flip7", "final-approach"])

        // Nothing answers on this port: the kept list's web games, no crash.
        let offline = GameNightClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        #expect(await store.refresh(from: offline).map(\.id) == ["final-approach"])

        // Never fetched and no signal: no web tiles at all.
        let fresh = WebGames(defaults: UserDefaults(suiteName: "webgames-\(UUID().uuidString)")!)
        #expect(await fresh.refresh(from: offline).isEmpty)
    }

    // MARK: Signing the page in

    @Test func originsAreSpelledAsTheBrowserDoes() {
        #expect(WebSignIn.origin(of: URL(string: "https://GameNight.collardserver.co.uk/final-approach/")!)
                == "https://gamenight.collardserver.co.uk")
        #expect(WebSignIn.origin(of: URL(string: "https://example.org:443/x")!) == "https://example.org")
        #expect(WebSignIn.origin(of: URL(string: "http://localhost:5001")!) == "http://localhost:5001")
        #expect(WebSignIn.origin(of: URL(string: "http://192.168.1.5:80/")!) == "http://192.168.1.5")
        #expect(WebSignIn.origin(of: URL(string: "mailto:a@b.c")!) == nil)
    }

    @Test func theStoredProfileIsTheWebsOwnShape() throws {
        let stored = WebSignIn.storedValue(me)
        let object = try #require(try JSONSerialization.jsonObject(with: Data(stored.utf8)) as? [String: Any])
        #expect(Set(object.keys) == ["id", "name", "photo", "token"])
        #expect(object["id"] as? String == "fcdcc1e416")
        #expect(object["name"] as? String == "Ana")
        #expect(object["photo"] as? String == "/profiles/photos/fcdcc1e416-ab12.jpg")
        #expect(object["token"] as? String == "s3cret")

        // No photo is written out as null, as the web's "You" page does.
        var plain = me
        plain.photo = nil
        let noPhoto = try #require(
            try JSONSerialization.jsonObject(with: Data(WebSignIn.storedValue(plain).utf8)) as? [String: Any])
        #expect(Set(noPhoto.keys) == ["id", "name", "photo", "token"])
        #expect(noPhoto["photo"] is NSNull)
    }

    @Test func theScriptSignsInOnlyOnTheServersOrigin() {
        let origin = "https://gamenight.collardserver.co.uk"
        let script = WebSignIn.script(for: me, origin: origin)
        #expect(script.contains(#"if (location.origin !== "https://gamenight.collardserver.co.uk") return;"#))
        #expect(script.contains(#"localStorage.setItem("gamenight:me", "#))
        #expect(script.contains(WebSignIn.literal(WebSignIn.storedValue(me))))
        #expect(!script.contains("removeItem"))
    }

    @Test func signedOutTheScriptSignsThePageOut() {
        let script = WebSignIn.script(for: nil, origin: "http://localhost:5001")
        #expect(script.contains(#"localStorage.removeItem("gamenight:me");"#))
        #expect(!script.contains("setItem"))
        #expect(script.contains(#""http://localhost:5001""#))
    }

    @Test func nothingInANameBreaksOutOfTheScript() throws {
        let awkward = HeldMe(id: "x", name: "A\"); alert(1); (\"\n\u{2028}</script>\\", photo: nil, token: "t")
        let script = WebSignIn.script(for: awkward, origin: "https://h")
        // The value is one line of JSON inside one string literal: the
        // separators a JS parser would treat as line breaks are escaped, the
        // newline is too, and the script is still its own four lines.
        #expect(!script.contains("\u{2028}"))
        #expect(script.split(separator: "\n").count == 4)
        let literal = WebSignIn.literal(WebSignIn.storedValue(awkward))
        #expect(!literal.contains("\n"))
        #expect(script.contains("localStorage.setItem(\"gamenight:me\", \(literal));"))
        // Read back as JSON (which is what a JS string literal of it is), it's
        // the stored value, which is the name.
        let back = try #require(try JSONSerialization.jsonObject(
            with: Data(literal.replacingOccurrences(of: "\\u2028", with: "\u{2028}").utf8),
            options: .fragmentsAllowed) as? String)
        let object = try #require(try JSONSerialization.jsonObject(with: Data(back.utf8)) as? [String: Any])
        #expect(object["name"] as? String == awkward.name)
    }

    // MARK: Links

    @Test func linksOnTheServerStayAndOthersLeave() {
        let home = URL(string: "https://gamenight.collardserver.co.uk/final-approach/")!
        func decide(_ text: String) -> WebGameLinks.Decision {
            WebGameLinks.decision(for: URL(string: text)!, home: home)
        }
        #expect(decide("https://gamenight.collardserver.co.uk/final-approach/stats") == .stay)
        #expect(decide("https://gamenight.collardserver.co.uk/final-vector/") == .stay)
        #expect(decide("https://GAMENIGHT.collardserver.co.uk/") == .closeToHub)   // the web hub: back to the app's
        #expect(decide("https://gamenight.collardserver.co.uk") == .closeToHub)
        #expect(decide("https://gamenight.collardserver.co.uk/?from=final-approach") == .closeToHub)
        #expect(decide("https://gamenight.collardserver.co.uk/me") == .stay)
        #expect(decide("about:blank") == .stay)
        #expect(decide("https://elevenlabs.io/") == .openOutside)
        #expect(decide("http://gamenight.collardserver.co.uk/") == .openOutside)    // another origin, even the hub
        #expect(decide("https://evil.gamenight.collardserver.co.uk/") == .openOutside)
        #expect(decide("mailto:someone@example.org") == .openOutside)
    }
}
