import Foundation

/// What this device holds in one Fugitive game: the dealer's token if it
/// dealt, and a token for each seat it sat in. Both seats is pass-and-play.
/// The web page keeps the same thing under `fugitive:game:<code>`.
nonisolated struct FugitiveDevice: Codable, Equatable {
    var host: String?
    var fugitive: String?
    var marshal: String?
    var pass = false

    func seat(_ role: FugitiveRole) -> String? { role == .fugitive ? fugitive : marshal }

    mutating func setSeat(_ role: FugitiveRole, _ token: String?) {
        if role == .fugitive { fugitive = token } else { marshal = token }
    }

    var seats: [FugitiveRole] { FugitiveRole.allCases.filter { seat($0) != nil } }

    /// The token to read the game with when nobody's hand should show:
    /// a single seat's own, otherwise the dealer's (the table's view).
    var askingToken: String? {
        let held = seats
        if held.count == 1 { return seat(held[0]) }
        return host
    }

    /// A rematch swaps roles, and each player's token goes with them.
    var swapped: FugitiveDevice {
        FugitiveDevice(host: host, fugitive: marshal, marshal: fugitive, pass: pass)
    }
}

struct FugitiveTokens {
    var defaults: UserDefaults = .standard
    /// "" for games on the server, "offline." for games kept on a phone —
    /// separate shelves, so an offline code can't collide with an online one.
    var scope = ""

    static let offline = FugitiveTokens(scope: "offline.")

    private var devicesKey: String { "fugitive.\(scope)devices" }
    private var lastGameKey: String { "fugitive.\(scope)lastGame" }
    /// Shared by both: the same two people play either way.
    private static let namesKey = "fugitive.lastNames"

    func held(for code: String) -> FugitiveDevice {
        devices[code] ?? FugitiveDevice()
    }

    func set(_ device: FugitiveDevice, for code: String) {
        var all = devices
        all[code] = device
        // Games end; don't keep every code this device ever saw.
        if all.count > 30, let oldest = all.keys.sorted().first, oldest != code { all[oldest] = nil }
        write(all, devicesKey)
    }

    /// Last game's pair, so the same two aren't typed in every time.
    var lastNames: [String: String] {
        get { read([String: String].self, Self.namesKey) ?? [:] }
        nonmutating set { write(newValue, Self.namesKey) }
    }

    var lastGame: String? {
        get { defaults.string(forKey: lastGameKey) }
        nonmutating set { defaults.set(newValue, forKey: lastGameKey) }
    }

    private var devices: [String: FugitiveDevice] { read([String: FugitiveDevice].self, devicesKey) ?? [:] }

    private func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write<T: Encodable>(_ value: T, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }
}
