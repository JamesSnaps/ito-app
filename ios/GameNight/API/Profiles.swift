import Foundation

// Player profiles, mirrored from core/profiles.py: a claimed name and an
// optional selfie, shared by every game. A device holds a profile with a
// token sent in `X-Profile-Token`; faces are looked up by name, the way the
// records key players (trimmed, spaces collapsed, case ignored).

nonisolated struct Profile: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    /// A server path like /profiles/photos/ab12-cd34.jpg, or nil.
    let photo: String?
}

/// The profile this device holds, if any — the app's `gamenight:me`.
/// UserDefaults like the game tokens: a profile token can change a name's
/// photo, nothing more, and the web keeps the same thing in localStorage.
/// (Here rather than in Faces.swift so the web games' sign-in in
/// WebGames.swift builds, and is tested, on Linux.)
nonisolated struct HeldMe: Codable, Equatable {
    var id: String
    var name: String
    var photo: String?
    var token: String
}

enum Me {
    private static let key = "gamenight.me"

    static var current: HeldMe? {
        get {
            guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
            return try? JSONDecoder().decode(HeldMe.self, from: data)
        }
        set {
            UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: key)
        }
    }
}

nonisolated struct ProfileList: Decodable, Equatable {
    let profiles: [Profile]
}

/// What making a profile, or redeeming a link to one, hands this device.
nonisolated struct HeldProfile: Decodable, Equatable {
    let profile: Profile
    let token: String
}

nonisolated struct ProfileEnvelope: Decodable, Equatable {
    let profile: Profile
}

/// A one-time QR for signing another device in as you.
nonisolated struct ProfileLink: Decodable, Equatable {
    let code: String
    let url: String
    let expiresIn: Int
}

nonisolated struct Done: Decodable, Equatable {}

// Pairing (server 1.36.0): the other way round from the link above. A new
// device picks a face and asks; a device that's already that person says yes.

/// What asking hands the new device: the code both screens show, the secret
/// only it keeps (only that collects the token), and the page its QR opens.
nonisolated struct PairAsk: Decodable, Equatable {
    let code: String
    let secret: String
    let url: String
    let expiresIn: Int
}

/// The asking device's poll: "waiting", "refused", or "approved" with the
/// profile and this device's token, handed over once.
nonisolated struct PairStatus: Decodable, Equatable {
    let status: String
    let profile: Profile?
    let token: String?
}

/// A request waiting for this device's profile to answer.
nonisolated struct PairRequest: Decodable, Equatable, Identifiable {
    let code: String
    /// "Chrome on a Mac", from the asking device's browser.
    let device: String
    /// "home" or "away", or nil when the server doesn't know.
    let `where`: String?
    let expiresIn: Int

    var id: String { code }

    /// "Chrome on a Mac, on the home Wi-Fi" — what the person saying yes reads.
    var description: String {
        switch `where` {
        case "home": "\(device), on the home Wi-Fi"
        case "away": "\(device), not on the home Wi-Fi"
        default: device
        }
    }

    /// "K7F 2QD": the code as both screens show it.
    static func spaced(_ code: String) -> String {
        code.count == 6 ? "\(code.prefix(3)) \(code.suffix(3))" : code
    }
}

nonisolated struct PairRequests: Decodable, Equatable {
    let requests: [PairRequest]
}

/// Signing out: the last device out deletes the profile (server 1.8.1+;
/// older servers leave `deleted` out).
nonisolated struct Forgotten: Decodable, Equatable {
    let deleted: Bool?
}

extension GameNightClient {
    static let profileHeader = "X-Profile-Token"

    func profiles() async throws -> [Profile] {
        let list: ProfileList = try await send("GET", "api/profiles")
        return list.profiles
    }

    func createProfile(name: String) async throws -> HeldProfile {
        try await send("POST", "api/profiles", body: ["name": name])
    }

    func myProfile(token: String) async throws -> Profile {
        let envelope: ProfileEnvelope = try await send("GET", "api/profiles/me", token: token, tokenHeader: Self.profileHeader)
        return envelope.profile
    }

    /// A JPEG; the server redraws it as a 320px square with nothing else kept.
    func uploadPhoto(_ jpeg: Data, token: String) async throws -> Profile {
        let envelope: ProfileEnvelope = try await send("POST", "api/profiles/me/photo", token: token,
                                                       tokenHeader: Self.profileHeader, upload: (jpeg, "image/jpeg"))
        return envelope.profile
    }

    func removePhoto(token: String) async throws -> Profile {
        let envelope: ProfileEnvelope = try await send("DELETE", "api/profiles/me/photo", token: token, tokenHeader: Self.profileHeader)
        return envelope.profile
    }

    func linkAnotherDevice(token: String) async throws -> ProfileLink {
        try await send("POST", "api/profiles/me/link", token: token, tokenHeader: Self.profileHeader)
    }

    func redeemLink(code: String) async throws -> HeldProfile {
        try await send("POST", "api/profiles/link/\(code)")
    }

    // MARK: Pairing

    static let pairSecretHeader = "X-Pair-Secret"

    func askToPair(profileID: String) async throws -> PairAsk {
        try await send("POST", "api/profiles/pair", body: ["profile": profileID])
    }

    /// A 404 means the request has gone: run out, or cancelled.
    func pairStatus(code: String, secret: String) async throws -> PairStatus {
        try await send("GET", "api/profiles/pair/\(code)", token: secret, tokenHeader: Self.pairSecretHeader)
    }

    func cancelPair(code: String, secret: String) async {
        let _: Done? = try? await send("DELETE", "api/profiles/pair/\(code)", token: secret, tokenHeader: Self.pairSecretHeader)
    }

    func pairRequests(token: String) async throws -> [PairRequest] {
        let waiting: PairRequests = try await send("GET", "api/profiles/me/pairs", token: token, tokenHeader: Self.profileHeader)
        return waiting.requests
    }

    func answerPair(code: String, approve: Bool, token: String) async throws {
        let _: Done = try await send("POST", "api/profiles/me/pairs/\(code)", body: ["approve": approve],
                                     token: token, tokenHeader: Self.profileHeader)
    }

    /// True if this was the last device, so the profile is gone too.
    func forgetThisDevice(token: String) async throws -> Bool {
        let forgotten: Forgotten = try await send("POST", "api/profiles/me/forget", token: token, tokenHeader: Self.profileHeader)
        return forgotten.deleted ?? false
    }

    func deleteProfile(token: String) async throws {
        let _: Done = try await send("DELETE", "api/profiles/me", token: token, tokenHeader: Self.profileHeader)
    }
}
