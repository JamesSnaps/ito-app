import Foundation

/// Where a room code (or a link to one) should take you. One resolver for
/// the Join screen, links and QR codes alike — the app's version of /join.
enum JoinDestination: Equatable {
    /// A Flip 7 game on the app's deck, already loaded.
    case flip7(PlayPayload)
    /// An ito room: the topic display.
    case ito(code: String)
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
        default:
            return .web(client.webURL(target.path))
        }
    }

    /// A room code out of a link: the web pages players are sent to
    /// (`/flip7/play/ABCD`, `/flip7/watch/ABCD`, `/ito/play/ABCD`,
    /// `/join?code=ABCD`) or the app's own `gamenight://join/ABCD`.
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
