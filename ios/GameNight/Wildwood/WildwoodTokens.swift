import Foundation

/// What this device holds in one Wildwood game: the dealer's token if it
/// dealt, and a token for each seat it sat in. More than one seat is
/// pass-and-play. The web page keeps the same under `wildwood:game:<code>`.
nonisolated struct WildwoodDevice: Codable, Equatable {
    var host: String?
    /// Seat number (as a string, for JSON) → token.
    var seatTokens: [String: String] = [:]

    func seat(_ seat: Int) -> String? { seatTokens[String(seat)] }

    mutating func setSeat(_ seat: Int, _ token: String?) { seatTokens[String(seat)] = token }

    var seats: [Int] { seatTokens.keys.compactMap(Int.init).sorted() }
    var passAndPlay: Bool { seats.count > 1 }

    /// The token to read the game with when nobody's hand should show:
    /// a single seat's own, otherwise the dealer's (the table's view).
    var askingToken: String? {
        let held = seats
        if held.count == 1 { return seat(held[0]) }
        return host ?? held.first.flatMap(seat)
    }
}

struct WildwoodTokens {
    var defaults: UserDefaults = .standard
    /// "" for games on the server; offline ones get their own shelf.
    var scope = ""

    private var devicesKey: String { "wildwood.\(scope)devices" }
    private var lastGameKey: String { "wildwood.\(scope)lastGame" }
    /// Shared by every shelf: the same family sits down either way.
    private static let setupKey = "wildwood.lastSetup"

    func held(for code: String) -> WildwoodDevice {
        devices[code] ?? WildwoodDevice()
    }

    func set(_ device: WildwoodDevice, for code: String) {
        var all = devices
        all[code] = device
        // Games end; don't keep every code this device ever saw.
        if all.count > 30, let oldest = all.keys.sorted().first, oldest != code { all[oldest] = nil }
        write(all, devicesKey)
    }

    var lastGame: String? {
        get { defaults.string(forKey: lastGameKey) }
        nonmutating set { defaults.set(newValue, forKey: lastGameKey) }
    }

    /// Last table's names and how it was set up, so a family isn't typed in
    /// every evening.
    var lastSetup: WildwoodSetup? {
        get { read(WildwoodSetup.self, Self.setupKey) }
        nonmutating set { write(newValue, Self.setupKey) }
    }

    private var devices: [String: WildwoodDevice] { read([String: WildwoodDevice].self, devicesKey) ?? [:] }

    private func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write<T: Encodable>(_ value: T, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }
}

nonisolated struct WildwoodSetup: Codable, Equatable {
    var names: [String] = ["", ""]
    var computers = 0
    var level = "easy"
    /// One device passed round, rather than a phone each.
    var pass = false
}
