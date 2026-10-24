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
    /// Games dealt on this device, which open with the shuffle and the deal.
    @State private var dealtHere: Set<String> = []
    @State private var resumable: PlayPayload?
    @State private var webPage: WebPage?
    @State private var linkError: String?
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                Theme.background
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // On an iPad, Join sits beside the title as a fixed-size
                        // button rather than a gold bar across the whole screen;
                        // the gold is kept for the one thing to do next.
                        if sizeClass == .regular {
                            HStack(alignment: .bottom) {
                                heading
                                Spacer()
                                joinButton.frame(width: 300)
                            }
                            if let game = resumable { resumeButton(game) }
                        } else {
                            heading
                            if let game = resumable { resumeButton(game) }
                            joinButton
                        }

                        // Side by side wherever there's room for both — an iPad
                        // either way up — stacked on a phone.
                        let tiles = sizeClass == .regular
                            ? AnyLayout(HStackLayout(alignment: .top, spacing: 20))
                            : AnyLayout(VStackLayout(spacing: 16))
                        tiles {
                            GameTile(title: "Flip 7", accent: Theme.gold,
                                     blurb: "Push your luck, bank your cards — first to 200 takes it. The app is the deck: it shuffles, deals and adds it all up.") {
                                Flip7Art()
                            } actions: {
                                Button { path.append(.newGame) } label: {
                                    Label("Start a game", systemImage: "suit.spade.fill")
                                }
                                .buttonStyle(FeltButtonStyle(kind: resumable == nil ? .gold : .ghost))
                                HStack(spacing: 10) {
                                    Button { path.append(.records) } label: { Label("Records", systemImage: "star") }
                                    Button { open("/flip7/rules") } label: { Label("Rules", systemImage: "questionmark.circle") }
                                }
                                .buttonStyle(FeltButtonStyle(kind: .ghost))
                            }
                            GameTile(title: "ito", accent: Color(hex: 0x8F7BFF),
                                     blurb: "Get the numbers in order without saying them. Join with the host’s code to see the topic on this screen.") {
                                ItoArt()
                            } actions: {
                                HStack(spacing: 10) {
                                    Button { open("/ito/") } label: { Label("Host a room", systemImage: "safari") }
                                    Button { open("/ito/rules") } label: { Label("Rules", systemImage: "questionmark.circle") }
                                }
                                .buttonStyle(FeltButtonStyle(kind: .ghost))
                                Text("Hosting opens in the browser — it needs the server’s sign-in.")
                                    .font(.caption).foregroundStyle(Theme.cream.opacity(0.5))
                            }
                        }
                    }
                    .padding(sizeClass == .regular ? 40 : 24)
                    .frame(maxWidth: sizeClass == .regular ? 1000 : 560, alignment: .leading)
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
            NewGameView(onDealt: { payload in
                dealtHere.insert(payload.code)
                go(.flip7(payload))
            })
        case .settings:
            SettingsView()
        case .records:
            RecordsView()
        case .ito(let code):
            ItoDisplayView(code: code)
        case .table(let code):
            if let payload = handedOver[code] {
                TableScreen(store: PlayStore(payload: payload, fromTheTop: dealtHere.contains(code)))
            } else {
                TableScreen(store: PlayStore(code: code))
            }
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GAME NIGHT").font(.caption.weight(.heavy)).kerning(2).foregroundStyle(Theme.goldBright)
            Text("Pick a game").font(Theme.display(sizeClass == .regular ? 44 : 36))
        }
    }

    private var joinButton: some View {
        Button { path.append(.join) } label: {
            Label("Join with a code", systemImage: "number")
        }
        .buttonStyle(FeltButtonStyle(kind: .ghost, big: true))
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
            Section {
                Toggle("Sounds", isOn: Binding(get: { Sound.enabled }, set: { Sound.enabled = $0 }))
            } footer: {
                Text("Shuffles, cards and the rest. They follow the silent switch.")
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


/// One game on the hub: its artwork, a line about it, and its ways in —
/// the native version of the web hub's tiles.
private struct GameTile<Art: View, Actions: View>: View {
    let title: String
    let accent: Color
    let blurb: String
    @ViewBuilder var art: Art
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            art
                .frame(maxWidth: .infinity)
                .frame(height: 150)
                .background(
                    LinearGradient(colors: [accent.opacity(0.22), accent.opacity(0.04)], startPoint: .top, endPoint: .bottom),
                    in: RoundedRectangle(cornerRadius: 14))
            Text(title).font(Theme.display(26)).foregroundStyle(Theme.goldBright)
            Text(blurb).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            actions
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.line))
    }
}

/// Three cards mid-fan, the middle one flipped up to a 7 — the web hub's
/// Flip 7 art, in real cards.
private struct Flip7Art: View {
    var body: some View {
        ZStack {
            CardView(card: .number(12), width: 58).rotationEffect(.degrees(-16), anchor: .bottom).offset(x: -46, y: 10)
            CardView(card: .times2, width: 58).rotationEffect(.degrees(16), anchor: .bottom).offset(x: 46, y: 10)
            CardView(card: .number(7), width: 70).offset(y: -2)
        }
        .accessibilityHidden(true)
    }
}

/// ito's scale line on a card, as on the web hub.
private struct ItoArt: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xF4F4F2))
                .frame(width: 210, height: 112)
                .shadow(color: .black.opacity(0.35), radius: 6, y: 4)
            HStack(spacing: 6) {
                dot("1")
                ScaleLine()
                    .stroke(LinearGradient(colors: [Color(hex: 0x4F8CFF), Color(hex: 0x8F7BFF), Color(hex: 0xFF7BC2)],
                                           startPoint: .leading, endPoint: .trailing),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .frame(width: 110, height: 34)
                dot("100")
            }
        }
        .accessibilityHidden(true)
    }

    private func dot(_ label: String) -> some View {
        Text(label).font(.system(size: label.count > 1 ? 10 : 13, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(Color(hex: 0x45474C), in: Circle())
    }
}
