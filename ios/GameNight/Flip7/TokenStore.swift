import Foundation

/// The tokens this device holds, per game. Same two kinds as the web page's
/// `flip7:play` / `flip7:seat`: the dealer's token for a game this device
/// started, and a seat token for a game it sat down in.
///
/// UserDefaults rather than the Keychain on purpose: a token opens one game
/// for one evening, the server forgets the game after six idle hours, and
/// the web page keeps the same thing in localStorage.
nonisolated struct SeatClaim: Codable, Equatable {
    let seat: Int
    let token: String
}

struct TokenStore {
    var defaults: UserDefaults = .standard

    private static let hostsKey = "flip7.hostTokens"
    private static let seatsKey = "flip7.seatClaims"
    private static let namesKey = "flip7.lastNames"
    private static let lastGameKey = "flip7.lastGame"

    func hostToken(for code: String) -> String? {
        hosts[code]
    }

    func setHostToken(_ token: String?, for code: String) {
        var all = hosts
        all[code] = token
        write(all, Self.hostsKey)
    }

    func seat(for code: String) -> SeatClaim? {
        seats[code]
    }

    func setSeat(_ claim: SeatClaim?, for code: String) {
        var all = seats
        all[code] = claim
        write(all, Self.seatsKey)
    }

    /// Last game's seating, so the same group isn't typed in every time.
    var lastNames: [String] {
        get { read([String].self, Self.namesKey) ?? [] }
        nonmutating set { write(newValue, Self.namesKey) }
    }

    /// The game to offer back from the hub. Checked against the server
    /// before it's shown — a dead code offered up is worse than no offer.
    var lastGame: String? {
        get { defaults.string(forKey: Self.lastGameKey) }
        nonmutating set { defaults.set(newValue, forKey: Self.lastGameKey) }
    }

    /// A rematch is a new room with the same tokens.
    func carry(from old: String, to new: String) {
        if let token = hostToken(for: old) { setHostToken(token, for: new) }
        if let claim = seat(for: old) { setSeat(claim, for: new) }
        if lastGame == old { lastGame = new }
    }

    // MARK: -

    private var hosts: [String: String] { read([String: String].self, Self.hostsKey) ?? [:] }
    private var seats: [String: SeatClaim] { read([String: SeatClaim].self, Self.seatsKey) ?? [:] }

    private func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write<T: Encodable>(_ value: T, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }
}
