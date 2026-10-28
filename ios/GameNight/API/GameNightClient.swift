import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking  // URLSession, when the models are built on Linux
#endif

/// The Game Night server's JSON API — the same endpoints the web pages use,
/// so the rules live once, on the server.
///
/// Flip 7 Play: reads are open; moves carry a token in `X-Flip7-Token`: the
/// dealer's (moves for anyone) or a seat's (moves for that seat only).
/// ito: the topic display is a public read; the device that started a room
/// drives it with the host token in `X-Ito-Token` (ItoHost.swift).
struct GameNightClient {
    let baseURL: URL
    var session: URLSession = .shared

    enum Failure: LocalizedError, Equatable {
        /// The server answered with an error. 400 and 409 still carry the
        /// current table in `payload`, so the screen can catch up.
        case server(status: Int, message: String, payload: PlayPayload?)
        case unreachable
        case badResponse

        var status: Int? {
            if case .server(let status, _, _) = self { return status }
            return nil
        }

        var payload: PlayPayload? {
            if case .server(_, _, let payload) = self { return payload }
            return nil
        }

        var errorDescription: String? {
            switch self {
            case .server(_, let message, _): message
            case .unreachable: "Couldn’t reach the Game Night server. Check the connection and try again."
            case .badResponse: "The server sent something this app doesn’t understand. It may need updating."
            }
        }
    }

    func create(players: [String]) async throws -> PlayPayload {
        try await send("POST", "flip7/api/play", body: ["players": players])
    }

    func state(code: String, token: String?) async throws -> PlayPayload {
        try await send("GET", "flip7/api/play/\(code)", token: token)
    }

    func move(code: String, _ move: Move, token: String) async throws -> PlayPayload {
        try await send("POST", "flip7/api/play/\(code)/move", body: move, token: token)
    }

    func claim(code: String, seat: Int) async throws -> PlayPayload {
        try await send("POST", "flip7/api/play/\(code)/seats/\(seat)/claim")
    }

    func release(code: String, seat: Int, token: String) async throws -> PlayPayload {
        try await send("POST", "flip7/api/play/\(code)/seats/\(seat)/release", token: token)
    }

    func rematch(code: String, token: String) async throws -> Rematch {
        try await send("POST", "flip7/api/play/\(code)/rematch", token: token)
    }

    /// Which game a code belongs to — /join's JSON twin, throttled the same.
    func join(code: String) async throws -> JoinTarget {
        try await send("GET", "api/join/\(code)")
    }

    func flip7Stats() async throws -> Flip7Stats {
        try await send("GET", "flip7/api/stats")
    }

    func itoState(code: String) async throws -> ItoState {
        try await send("GET", "ito/api/\(code)/state")
    }

    /// A page on the server, for the screens the app leaves to the web:
    /// rules, ito's stats and topics, a scorekeeper's board.
    func webURL(_ path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL
    }

    /// The table's web address, which is what the invite QR code points at:
    /// a phone without the app joins in the browser.
    func tableURL(code: String) -> URL {
        baseURL.appendingPathComponent("flip7/play/\(code)")
    }

    // MARK: -

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private struct ErrorBody: Decodable { let error: String? }

    /// Each game names its own token header, and profiles have theirs:
    /// Flip 7's is the default, as it was the only one.
    func send<T: Decodable>(
        _ method: String, _ path: String, body: (any Encodable)? = nil, token: String? = nil,
        tokenHeader: String = "X-Flip7-Token", upload: (data: Data, type: String)? = nil
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = upload == nil ? 10 : 30
        if let token { request.setValue(token, forHTTPHeaderField: tokenHeader) }
        if let upload {
            request.setValue(upload.type, forHTTPHeaderField: "Content-Type")
            request.httpBody = upload.data
        } else if method == "POST" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body.map(AnyEncodable.init) ?? AnyEncodable([String: String]()))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Failure.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.badResponse }

        if (200..<300).contains(http.statusCode) {
            do {
                return try Self.decoder.decode(T.self, from: data)
            } catch {
                throw Failure.badResponse
            }
        }
        let payload = try? Self.decoder.decode(PlayPayload.self, from: data)
        let message = (try? Self.decoder.decode(ErrorBody.self, from: data))?.error
            ?? Self.fallbackMessage(for: http.statusCode)
        throw Failure.server(status: http.statusCode, message: message, payload: payload)
    }

    private static func fallbackMessage(for status: Int) -> String {
        switch status {
        case 404: "That game has ended or expired."
        case 429: "Too many wrong codes from this device. Wait a few minutes, then try again."
        default: "Something went wrong at the server (\(status))."
        }
    }
}

/// Lets `send` take any body without a generic parameter per call.
private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
