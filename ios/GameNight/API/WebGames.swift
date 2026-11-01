import Foundation

// The hub's web-only games (app 1.14.0): Final Approach today, and whatever
// the server's registry gains later, with no app update. The server lists
// every game (`GET /api/games`); the app draws its own tiles for the games it
// has screens for and a tile opening the web page full screen for the rest
// (WebGameScreen.swift). Everything here is UIKit-free so it's tested on
// Linux; the screen itself is in App/.

/// One game on the server's hub.
nonisolated struct GameListing: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let tagline: String
    /// "#e8553f", the web tile's tint.
    let accent: String
    /// The game's page on the server, e.g. "/final-approach/".
    let path: String
    /// The web tile's call to action ("Play"); older lists may lack it.
    let action: String?
    /// The server's word that the app has a screen of its own for this game.
    let nativeApp: Bool

    /// The accent as 0xRRGGBB, for `Color(hex:)`; nil if it isn't one.
    var accentHex: UInt32? {
        var text = accent.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        guard text.count == 6 else { return nil }
        return UInt32(text, radix: 16)
    }
}

nonisolated struct GameList: Decodable, Equatable {
    let games: [GameListing]
}

extension GameNightClient {
    /// The hub's games, in the hub's order (server 1.31.1+).
    func games() async throws -> [GameListing] {
        let list: GameList = try await send("GET", "api/games")
        return list.games
    }
}

/// Which games get a web tile, and the last list the server sent, kept so the
/// tiles are there at launch and with no signal.
struct WebGames {
    var defaults: UserDefaults = .standard

    /// The games this build has its own screens for. Decided here, not by
    /// the server's `native_app`: a game a later build makes native is still
    /// only a web page to this one, so it stays a web tile here.
    static let native: Set<String> = ["flip7", "fugitive", "wildwood", "ito"]

    private static let key = "webGames.last"

    /// The games to show as web tiles, in the server's order.
    static func webOnly(_ games: [GameListing]) -> [GameListing] {
        games.filter { !native.contains($0.id) && $0.path.hasPrefix("/") }
    }

    /// The last list the server sent, or nothing if it never has.
    var cached: [GameListing] {
        guard let data = defaults.data(forKey: Self.key),
              let games = try? JSONDecoder().decode([GameListing].self, from: data) else { return [] }
        return games
    }

    func remember(_ games: [GameListing]) {
        defaults.set(try? JSONEncoder().encode(games), forKey: Self.key)
    }

    /// The tiles to show now: the server's list when it answers (and kept for
    /// next time), the last one when it doesn't.
    func refresh(from client: GameNightClient) async -> [GameListing] {
        if let fresh = try? await client.games() {
            remember(fresh)
            return Self.webOnly(fresh)
        }
        return Self.webOnly(cached)
    }
}

/// Signing a web game in as the app's profile. The web keeps "who this
/// device is" in localStorage `gamenight:me` as `{id, name, photo, token}`
/// (static/profiles.js, `GN.me`); the web screen runs this script at the
/// start of every page, before the page's own, so the game sees the app's
/// profile — its records, and grown-up or child rules, follow it — or no
/// profile when the app is signed out.
nonisolated enum WebSignIn {
    static let storageKey = "gamenight:me"

    /// "https://host[:port]", as `location.origin` spells it: lower case, no
    /// default port. Nil for anything but http(s).
    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host()?.lowercased(), !host.isEmpty else { return nil }
        let port = url.port.flatMap { (scheme == "https" && $0 == 443) || (scheme == "http" && $0 == 80) ? nil : $0 }
        return "\(scheme)://\(host)" + (port.map { ":\($0)" } ?? "")
    }

    /// The JSON the web stores: all four keys, `photo` null when there's none
    /// (as me.html writes it).
    static func storedValue(_ me: HeldMe) -> String {
        return json(StoredMe(me: me)) ?? "null"
    }

    /// The user script: only on the Game Night server's own origin, writes
    /// the profile (or removes it when signed out). Strings go in as JSON
    /// literals, so nothing in a name can break out of them.
    static func script(for me: HeldMe?, origin: String) -> String {
        let action: String
        if let me {
            action = "localStorage.setItem(\(literal(storageKey)), \(literal(storedValue(me))));"
        } else {
            action = "localStorage.removeItem(\(literal(storageKey)));"
        }
        return """
        (function () {
          if (location.origin !== \(literal(origin))) return;
          try { \(action) } catch (e) {}
        })();
        """
    }

    /// A JavaScript string literal (JSON's, which is JS's), with the two line
    /// separators JSON allows raw escaped as well.
    static func literal(_ text: String) -> String {
        (json(text) ?? "\"\"")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    private static func json(_ value: some Encodable) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) }
    }
}

/// Where a link from a web game goes: pages on the Game Night server stay in
/// the game's screen (its records, another game, the hub); anything else
/// opens in the system browser (or Mail, Messages…).
nonisolated enum WebGameLinks {
    enum Decision: Equatable { case stay, openOutside }

    static func decision(for url: URL, home: URL) -> Decision {
        switch url.scheme?.lowercased() {
        case "about", "blob", "data", "javascript":
            return .stay
        case "http", "https":
            guard let origin = WebSignIn.origin(of: url), let homeOrigin = WebSignIn.origin(of: home) else {
                return .openOutside
            }
            return origin == homeOrigin ? .stay : .openOutside
        default:
            return .openOutside
        }
    }
}

/// `HeldMe` with `photo` written out as null rather than left out.
private nonisolated struct StoredMe: Encodable {
    let me: HeldMe

    enum Keys: String, CodingKey { case id, name, photo, token }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(me.id, forKey: .id)
        try container.encode(me.name, forKey: .name)
        try container.encode(me.photo, forKey: .photo)
        try container.encode(me.token, forKey: .token)
    }
}
