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

    /// True if this was the last device, so the profile is gone too.
    func forgetThisDevice(token: String) async throws -> Bool {
        let forgotten: Forgotten = try await send("POST", "api/profiles/me/forget", token: token, tokenHeader: Self.profileHeader)
        return forgotten.deleted ?? false
    }

    func deleteProfile(token: String) async throws {
        let _: Done = try await send("DELETE", "api/profiles/me", token: token, tokenHeader: Self.profileHeader)
    }
}
