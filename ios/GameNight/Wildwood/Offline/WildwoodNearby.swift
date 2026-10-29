import Foundation

// Up to four phones, no internet: one phone keeps the game
// (WildwoodOfflineTable) and the others play it from round the table over
// MultipeerConnectivity (NearbyLink.swift, service `gn-wildwood`). What
// travels is the server's API and nothing more, as Fugitive's Nearby.swift:
// each guest asks for the table, moves and sits down exactly as it would ask
// the server, and the host answers from its table with the view for that
// guest's token — so a guest's screen only ever holds its own hand.

nonisolated enum WildwoodNearbyCall: Codable, Equatable {
    case state(code: String, token: String?)
    case move(code: String, move: WildwoodMove, token: String)
    case claim(code: String, seat: Int)
    case release(code: String, seat: Int, token: String)
    case rematch(code: String, token: String)
}

nonisolated struct WildwoodNearbyRequest: Codable, Equatable {
    var id = UUID()
    let call: WildwoodNearbyCall
}

/// What the server would have answered: a payload, a rematch, or a refusal.
nonisolated struct WildwoodNearbyResponse: Codable, Equatable {
    let id: UUID
    var payload: WildwoodPayload?
    var rematch: WildwoodRematch?
    var status: Int?
    var message: String?
}

/// The host's side: answers a nearby phone's calls from the offline table.
struct WildwoodNearbyResponder {
    var table: WildwoodOfflineTable = .shared

    func answer(_ request: WildwoodNearbyRequest) async -> WildwoodNearbyResponse {
        var response = WildwoodNearbyResponse(id: request.id)
        do {
            switch request.call {
            case .state(let code, let token):
                response.payload = try await table.wildwoodState(code: code, token: token)
            case .move(let code, let move, let token):
                response.payload = try await table.wildwoodMove(code: code, move, token: token)
            case .claim(let code, let seat):
                response.payload = try await table.wildwoodClaim(code: code, seat: seat)
            case .release(let code, let seat, let token):
                response.payload = try await table.wildwoodRelease(code: code, seat: seat, token: token)
            case .rematch(let code, let token):
                response.rematch = try await table.wildwoodRematch(code: code, token: token)
            }
        } catch let failure as GameNightClient.Failure {
            response.status = failure.status ?? 500
            response.message = failure.errorDescription
        } catch {
            response.status = 500
            response.message = error.localizedDescription
        }
        return response
    }

    /// The same, from and to the bytes the link carries.
    func answer(_ data: Data) async -> Data? {
        guard let request = try? JSONDecoder().decode(WildwoodNearbyRequest.self, from: data) else { return nil }
        return try? JSONEncoder().encode(await answer(request))
    }
}

/// The guest's side: a WildwoodTransport whose "server" is the nearby host.
/// `exchange` carries a request there and brings the answer back — the
/// link in the app, a direct call in the tests.
final class WildwoodNearbyTransport: WildwoodTransport {
    typealias Exchange = (WildwoodNearbyRequest) async throws -> WildwoodNearbyResponse
    private let exchange: Exchange

    init(exchange: @escaping Exchange) {
        self.exchange = exchange
    }

    /// Its own shelf: seats in other phones' games mustn't touch this
    /// phone's own offline games.
    var wildwoodTokens: WildwoodTokens { .nearby }
    func wildwoodInviteURL(code: String) -> URL? { nil }

    func wildwoodState(code: String, token: String?) async throws -> WildwoodPayload {
        try await payload(.state(code: code, token: token))
    }

    func wildwoodMove(code: String, _ move: WildwoodMove, token: String) async throws -> WildwoodPayload {
        try await payload(.move(code: code, move: move, token: token))
    }

    func wildwoodClaim(code: String, seat: Int) async throws -> WildwoodPayload {
        try await payload(.claim(code: code, seat: seat))
    }

    func wildwoodRelease(code: String, seat: Int, token: String) async throws -> WildwoodPayload {
        try await payload(.release(code: code, seat: seat, token: token))
    }

    func wildwoodRematch(code: String, token: String) async throws -> WildwoodRematch {
        guard let rematch = try await call(.rematch(code: code, token: token)).rematch else {
            throw GameNightClient.Failure.badResponse
        }
        return rematch
    }

    private func payload(_ call: WildwoodNearbyCall) async throws -> WildwoodPayload {
        guard let payload = try await self.call(call).payload else { throw GameNightClient.Failure.badResponse }
        return payload
    }

    private func call(_ call: WildwoodNearbyCall) async throws -> WildwoodNearbyResponse {
        let response = try await exchange(WildwoodNearbyRequest(call: call))
        if let status = response.status {
            throw GameNightClient.Failure.server(status: status, message: response.message ?? "The other phone said no.",
                                                 payload: nil)
        }
        return response
    }
}

extension NearbyGuest {
    /// Wildwood's table's way to the host. Make one per game screen.
    var wildwoodTransport: WildwoodNearbyTransport {
        WildwoodNearbyTransport { [weak self] request in
            guard let self else { throw NearbyService.lostTouch }
            let answer = try await self.exchange(JSONEncoder().encode(request), id: request.id)
            return try JSONDecoder().decode(WildwoodNearbyResponse.self, from: answer)
        }
    }
}
