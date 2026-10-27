import Foundation

/// Where a room code (or a link to one) should take you. One resolver for
/// the Join screen, the scanner, links and QR codes alike — the app's
/// version of /join.
enum JoinDestination: Equatable {
    /// A Flip 7 game on the app's deck, already loaded.
    case flip7(PlayPayload)
    /// A Fugitive game, already loaded as this device may see it.
    case fugitive(FugitivePayload)
    /// An ito room: the topic display.
    case ito(code: String)
    /// A one-time code for signing this device in as someone's profile.
    case profileLink(String)
    /// Something the app doesn't show itself — a Flip 7 scorekeeper's
    /// board — so it opens in the browser.
    case web(URL)
}

enum Joining {
    /// No I/O/0/1 — codes are read aloud across a table (core/rooms.py).
    static let alphabet = Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func isCode(_ text: String) -> Bool {
        text.count == 4 && text.allSatisfy { alphabet.contains($0) }
    }

    static func resolve(code raw: String, client: GameNightClient = AppSettings.client,
                        tokens: TokenStore = TokenStore()) async throws -> JoinDestination {
        let code = raw.uppercased()
        let target = try await client.join(code: code)
        switch target.game {
        case "ito":
            return .ito(code: target.code)
        case "flip7":
            do {
                let token = tokens.seat(for: target.code)?.token ?? tokens.hostToken(for: target.code)
                let payload = try await client.state(code: target.code, token: token)
                tokens.lastGame = payload.code
                return .flip7(payload)
            } catch let failure as GameNightClient.Failure where failure.status == 404 {
                // A scorekeeper's spectator board, not a game: the web shows it.
                return .web(client.webURL(target.path))
            }
        case "fugitive":
            let held = FugitiveTokens().held(for: target.code)
            return .fugitive(try await client.fugitiveState(code: target.code, token: held.askingToken))
        default:
            return .web(client.webURL(target.path))
        }
    }

    /// A link from outside or a scanned QR: a profile link, or a room.
    static func destination(for url: URL) async throws -> JoinDestination? {
        if let link = profileLink(in: url) { return .profileLink(link) }
        guard let code = code(in: url) else { return nil }
        return try await resolve(code: code)
    }

    /// Is this a link the app knows what to do with?
    static func isOurs(_ url: URL) -> Bool {
        profileLink(in: url) != nil || code(in: url) != nil
    }

    /// The code from a "sign another device in" link: `/me/link/<code>`.
    static func profileLink(in url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "gamenight", url.host() == "me", parts.count == 2, parts[0] == "link" { return parts[1] }
        guard parts.count == 3, parts[0] == "me", parts[1] == "link", !parts[2].isEmpty else { return nil }
        return parts[2]
    }

    /// A room code out of a link: the web pages players are sent to
    /// (`/flip7/play/ABCD`, `/flip7/watch/ABCD`, `/fugitive/play/ABCD`,
    /// `/ito/play/ABCD`, `/join?code=ABCD`) or the app's own
    /// `gamenight://join/ABCD`.
    static func code(in url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        var candidates: [String] = []
        if url.scheme == "gamenight" {
            // gamenight://join/ABCD — the host is "join", the code the path.
            if url.host() == "join" { candidates += parts }
        } else if parts.count >= 3, ["play", "watch"].contains(parts[1]) {
            candidates.append(parts[2])
        }
        if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value {
            candidates.append(query)
        }
        return candidates.map { $0.uppercased() }.first(where: isCode)
    }
}
