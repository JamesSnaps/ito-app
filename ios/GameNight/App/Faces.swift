import Observation
import SwiftUI

/// Everyone's faces: the server's profile list, fetched once and refreshed
/// when the hub appears. A name with no profile behind it is a guest.
@Observable
final class Faces {
    static let shared = Faces()

    private(set) var profiles: [Profile] = []
    /// Bumped whenever this device's own profile changes, so "You" redraws.
    private(set) var me: HeldMe? = Me.current

    @ObservationIgnored private var loadedAt: Date?

    /// The same folding the web does: trimmed, spaces collapsed, case ignored.
    static func fold(_ name: String) -> String {
        name.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
    }

    func load(force: Bool = false) async {
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 60 { return }
        if let fresh = try? await AppSettings.client.profiles() {
            profiles = fresh
            loadedAt = Date()
        }
    }

    func profile(named name: String) -> Profile? {
        let key = Self.fold(name)
        guard !key.isEmpty else { return nil }
        return profiles.first { Self.fold($0.name) == key }
    }

    func photoURL(for name: String) -> URL? {
        guard let path = profile(named: name)?.photo else { return nil }
        return AppSettings.client.webURL(path)
    }

    /// Keep the list and this device's copy in step after a change here.
    func remember(_ profile: Profile, token: String? = nil) {
        profiles.removeAll { $0.id == profile.id }
        profiles.append(profile)
        let held = HeldMe(id: profile.id, name: profile.name, photo: profile.photo,
                          token: token ?? Me.current?.token ?? "")
        Me.current = held
        me = held
    }

    func forget(deleted: Bool) {
        if deleted, let id = me?.id { profiles.removeAll { $0.id == id } }
        Me.current = nil
        me = nil
    }
}

/// A round face: the profile photo if there is one, initials if not.
struct AvatarView: View {
    let name: String
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let url = Faces.shared.photoURL(for: name) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initials
                    }
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Color(hue: Self.hue(name), saturation: 0.45, brightness: 0.45))
            Text(Self.initials(name))
                .font(.system(size: size * 0.38, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
        }
    }

    /// The same colour the web gives this name.
    static func hue(_ name: String) -> Double {
        var h = 0
        for scalar in Faces.fold(name).unicodeScalars { h = (h * 31 + Int(scalar.value)) % 360 }
        return Double(h) / 360
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: \.isWhitespace)
        if words.count > 1, let first = words.first?.first, let last = words.last?.first {
            return "\(first)\(last)".uppercased()
        }
        return String((words.first ?? "?").prefix(2)).uppercased()
    }
}

/// The regulars as faces to tap — "who's playing?" without typing.
struct RegularsPicker: View {
    /// Names already at the table, left out.
    let skip: [String]
    let onPick: (String) -> Void
    var label = "Regulars — tap to add"

    var body: some View {
        let taken = Set(skip.map(Faces.fold))
        let mine = Faces.shared.me?.id
        let people = Faces.shared.profiles
            .filter { !taken.contains(Faces.fold($0.name)) }
            .sorted { a, b in
                // This device's own profile first, then alphabetical.
                if (a.id == mine) != (b.id == mine) { return a.id == mine }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        if !people.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(people) { person in
                            Button { onPick(person.name) } label: {
                                VStack(spacing: 4) {
                                    AvatarView(name: person.name, size: 46)
                                    Text(person.name).font(.caption2).lineLimit(1).frame(maxWidth: 64)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Add \(person.name)")
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }
}
