import SwiftUI

/// The app's front page, like the web hub: a way into any game by code, then
/// one panel per game. ito's host screen sits behind Authelia on the server,
/// which a native app can't get through yet, so hosting ito opens the
/// browser; watching the topic is native.
struct HubView: View {
    enum Route: Hashable {
        case join, newGame, settings, records
        case table(String)
        case ito(String)
    }

    @State private var path: [Route] = []
    /// Games handed over in full by Join / New game, so the table opens with
    /// cards on it rather than a spinner.
    @State private var handedOver: [String: PlayPayload] = [:]
    @State private var resumable: PlayPayload?
    @State private var webPage: WebPage?
    @State private var linkError: String?

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                Theme.background
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("GAME NIGHT").font(.caption.weight(.heavy)).kerning(2).foregroundStyle(Theme.goldBright)
                        Text("Pick a game").font(Theme.display(36))

                        if let game = resumable { resumeButton(game) }

                        Button { path.append(.join) } label: {
                            Label("Join with a code", systemImage: "number")
                        }
                        .buttonStyle(FeltButtonStyle(kind: resumable == nil ? .gold : .ghost, big: true))

                        Panel(title: "Flip 7") {
                            Text("Push your luck, bank your cards — first to 200 takes it. The app is the deck: it shuffles, deals and adds it all up.")
                                .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                            Button { path.append(.newGame) } label: {
                                Label("Start a game", systemImage: "suit.spade.fill")
                            }
                            .buttonStyle(FeltButtonStyle(kind: .ghost))
                            HStack(spacing: 10) {
                                Button { path.append(.records) } label: { Label("Records", systemImage: "star") }
                                Button { open("/flip7/rules") } label: { Label("Rules", systemImage: "questionmark.circle") }
                            }
                            .buttonStyle(FeltButtonStyle(kind: .ghost))
                        }

                        Panel(title: "ito") {
                            Text("Get the numbers in order without saying them. Join with the host’s code to see the topic on this screen.")
                                .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                            HStack(spacing: 10) {
                                Button { open("/ito/") } label: { Label("Host a room", systemImage: "safari") }
                                Button { open("/ito/rules") } label: { Label("Rules", systemImage: "questionmark.circle") }
                            }
                            .buttonStyle(FeltButtonStyle(kind: .ghost))
                            Text("Hosting opens in the browser — it needs the server’s sign-in.")
                                .font(.caption).foregroundStyle(Theme.cream.opacity(0.5))
                        }
                    }
                    .padding(24)
                    .frame(maxWidth: 560, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Theme.cream)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { path.append(.settings) } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .toolbarBackground(Theme.feltDark, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .navigationDestination(for: Route.self, destination: destination)
            .task(id: path.isEmpty) {
                if path.isEmpty { await checkResume() }
            }
        }
        .sheet(item: $webPage) { page in SafariView(url: page.url).ignoresSafeArea() }
        .alert("Couldn’t open that link", isPresented: Binding(get: { linkError != nil }, set: { if !$0 { linkError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(linkError ?? "")
        }
        // A link to a game — a web table's address, or gamenight://join/CODE
        // — opens it here, the same as typing the code.
        .onOpenURL { url in Task { await openLink(url) } }
        .tint(Theme.goldBright)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .join:
            JoinView(onResolved: go)
        case .newGame:
            NewGameView(onDealt: { go(.flip7($0)) })
        case .settings:
            SettingsView()
        case .records:
            RecordsView()
        case .ito(let code):
            ItoDisplayView(code: code)
        case .table(let code):
            if let payload = handedOver[code] {
                TableScreen(store: PlayStore(payload: payload))
            } else {
                TableScreen(store: PlayStore(code: code))
            }
        }
    }

    private func resumeButton(_ game: PlayPayload) -> some View {
        Button {
            go(.flip7(game))
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Back to the table").font(Theme.display(18))
                    Text("Flip 7 · room \(game.code) · round \(game.game.round) · " + game.game.players.map(\.name).joined(separator: ", "))
                        .font(.footnote).lineLimit(1)
                }
                Spacer()
                Image(systemName: "arrow.right")
            }
        }
        .buttonStyle(FeltButtonStyle())
    }

    private func go(_ destination: JoinDestination) {
        switch destination {
        case .flip7(let payload):
            handedOver[payload.code] = payload
            path = [.table(payload.code)]
        case .ito(let code):
            path = [.ito(code)]
        case .web(let url):
            webPage = WebPage(url: url)
        }
    }

    private func open(_ serverPath: String) {
        webPage = WebPage(url: AppSettings.client.webURL(serverPath))
    }

    private func openLink(_ url: URL) async {
        guard let code = Joining.code(in: url) else {
            linkError = "That link isn’t to a Game Night room."
            return
        }
        do {
            go(try await Joining.resolve(code: code))
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            linkError = "Room \(code) has ended or expired."
        } catch {
            linkError = error.localizedDescription
        }
    }

    /// The last game is only offered back once it's confirmed to still
    /// exist, still be going, and still know this device.
    private func checkResume() async {
        let tokens = TokenStore()
        guard let code = tokens.lastGame else { resumable = nil; return }
        let token = tokens.seat(for: code)?.token ?? tokens.hostToken(for: code)
        do {
            let payload = try await AppSettings.client.state(code: code, token: token)
            resumable = payload.game.phase != .gameOver && payload.you.role != nil ? payload : nil
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            tokens.lastGame = nil
            resumable = nil
        } catch {
            resumable = nil
        }
    }
}

/// Where the server is. Production unless changed; a LAN address works too
/// (the app allows plain http on the local network only).
struct SettingsView: View {
    @State private var text = AppSettings.serverURL.absoluteString
    @State private var saved = false

    var body: some View {
        Form {
            Section {
                TextField("Server", text: $text)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Save") {
                    if let url = AppSettings.normalised(text) {
                        AppSettings.serverURL = url
                        text = url.absoluteString
                        saved = true
                    }
                }
                .disabled(AppSettings.normalised(text) == nil)
                Button("Use the default") {
                    text = AppSettings.defaultServer
                    AppSettings.serverURL = URL(string: AppSettings.defaultServer)!
                    saved = true
                }
            } header: {
                Text("Game Night server")
            } footer: {
                Text(saved ? "Saved. New games use this server." : "Default: \(AppSettings.defaultServer)")
            }
            Section("About") {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            }
        }
        .navigationTitle("Settings")
        .onChange(of: text) { saved = false }
        .preferredColorScheme(.dark)
    }
}
