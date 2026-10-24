import Foundation

/// Which server the app talks to. Production by default; a dev build can be
/// pointed at the Flask server on the Mac with the launch argument
/// `-serverURL http://localhost:5001` (UserDefaults reads launch arguments),
/// or at anything else from the settings screen.
enum AppSettings {
    static let defaultServer = "https://gamenight.collardserver.co.uk"
    private static let key = "serverURL"

    static var serverURL: URL {
        get {
            let stored = UserDefaults.standard.string(forKey: key) ?? defaultServer
            return URL(string: stored) ?? URL(string: defaultServer)!
        }
        set { UserDefaults.standard.set(newValue.absoluteString, forKey: key) }
    }

    /// Accepts what people type: a bare host gets https, a trailing slash is
    /// dropped. Nil for anything that isn't an http(s) address.
    static func normalised(_ text: String) -> URL? {
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host() != nil else { return nil }
        return url
    }

    static var client: GameNightClient { GameNightClient(baseURL: serverURL) }
}
