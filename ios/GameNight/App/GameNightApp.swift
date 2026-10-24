import SwiftUI

/// Game Night for iOS: a native front end to the same server the web app
/// uses. Everything about a game — the deck, the rules, the scores — lives
/// on the server; this app shows the table and sends moves.
@main
struct GameNightApp: App {
    var body: some Scene {
        WindowGroup {
            HubView()
        }
    }
}
