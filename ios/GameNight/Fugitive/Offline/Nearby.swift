import Foundation

// Two phones, no internet: one phone keeps the game (OfflineTable) and the
// other plays it from across the table, over MultipeerConnectivity
// (NearbyLink.swift — Bluetooth and peer-to-peer Wi-Fi, no network needed).
//
// What travels is the server's API, nothing more: the guest asks for the
// table, moves, sits down, exactly as it would ask the server, and the host
// answers from its OfflineTable with what the server would have said — the
// view for that guest's token. So the guest's screen only ever holds what
// its own seat may see, as online. (The host phone holds the whole game,
// as the server does; it's a family game, not a tournament.)

/// One call on the server's API, for the host to answer.
nonisolated enum NearbyCall: Codable, Equatable {
    case state(code: String, token: String?)
    case move(code: String, move: FugitiveMove, token: String)
    case claim(code: String, role: FugitiveRole)
    case release(code: String, role: FugitiveRole, token: String)
    case rematch(code: String, token: String)
}

nonisolated struct NearbyRequest: Codable, Equatable {
    var id = UUID()
    let call: NearbyCall
}

/// What the server would have answered: a payload, a rematch, or a refusal.
nonisolated struct NearbyResponse: Codable, Equatable {
    let id: UUID
    var payload: FugitivePayload?
    var rematch: FugitiveRematch?
    var status: Int?
    var message: String?
}

/// The host's side: answers a nearby phone's calls from the offline table.
struct NearbyResponder {
    var table: OfflineTable = .shared

    func answer(_ request: NearbyRequest) async -> NearbyResponse {
        var response = NearbyResponse(id: request.id)
        do {
            switch request.call {
            case .state(let code, let token):
                response.payload = try await table.fugitiveState(code: code, token: token)
            case .move(let code, let move, let token):
                response.payload = try await table.fugitiveMove(code: code, move, token: token)
            case .claim(let code, let role):
                response.payload = try await table.fugitiveClaim(code: code, role: role)
            case .release(let code, let role, let token):
                response.payload = try await table.fugitiveRelease(code: code, role: role, token: token)
            case .rematch(let code, let token):
                response.rematch = try await table.fugitiveRematch(code: code, token: token)
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
        guard let request = try? JSONDecoder().decode(NearbyRequest.self, from: data) else { return nil }
        return try? JSONEncoder().encode(await answer(request))
    }
}

/// The guest's side: a FugitiveTransport whose "server" is the nearby host.
/// `exchange` carries a request there and brings the answer back — the
/// MultipeerConnectivity link in the app, a direct call in the tests.
final class NearbyTransport: FugitiveTransport {
    typealias Exchange = (NearbyRequest) async throws -> NearbyResponse
    private let exchange: Exchange

    init(exchange: @escaping Exchange) {
        self.exchange = exchange
    }

    var tokens: FugitiveTokens { .offline }
    func inviteURL(code: String) -> URL? { nil }

    func fugitiveState(code: String, token: String?) async throws -> FugitivePayload {
        try await payload(.state(code: code, token: token))
    }

    func fugitiveMove(code: String, _ move: FugitiveMove, token: String) async throws -> FugitivePayload {
        try await payload(.move(code: code, move: move, token: token))
    }

    func fugitiveClaim(code: String, role: FugitiveRole) async throws -> FugitivePayload {
        try await payload(.claim(code: code, role: role))
    }

    func fugitiveRelease(code: String, role: FugitiveRole, token: String) async throws -> FugitivePayload {
        try await payload(.release(code: code, role: role, token: token))
    }

    func fugitiveRematch(code: String, token: String) async throws -> FugitiveRematch {
        guard let rematch = try await call(.rematch(code: code, token: token)).rematch else {
            throw GameNightClient.Failure.badResponse
        }
        return rematch
    }

    private func payload(_ call: NearbyCall) async throws -> FugitivePayload {
        guard let payload = try await self.call(call).payload else { throw GameNightClient.Failure.badResponse }
        return payload
    }

    private func call(_ call: NearbyCall) async throws -> NearbyResponse {
        let response = try await exchange(NearbyRequest(call: call))
        if let status = response.status {
            throw GameNightClient.Failure.server(status: status, message: response.message ?? "The other phone said no.",
                                                 payload: nil)
        }
        return response
    }
}
