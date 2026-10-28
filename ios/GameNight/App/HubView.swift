import SwiftUI

/// The app's front page, like the web hub: a way into any game by code (or
/// by scanning its QR), then one panel per game, and "You" in the corner.
struct HubView: View {
    enum Route: Hashable {
        case join, newGame, settings, records
        case table(String)
        case ito(String)
        /// Hosting ito: a room this device started, or nil to start one.
        case itoHost(String?)
        case fugitiveNew, fugitiveRecords
        case fugitiveTable(String)
        /// An offline game kept on this phone; one kept on a nearby phone.
        case fugitiveOffline(String)
        case fugitiveNearby(String)
        /// "You", with a sign-in code when a link or QR brought it.
        case you(String?)
    }

    @State private var path: [Route] = []
    /// Games handed over in full by Join / New game, so the table opens with
    /// cards on it rather than a spinner.
    @State private var handedOver: [String: PlayPayload] = [:]
    @State private var handedOverFugitive: [String: FugitivePayload] = [:]
    @State private var scanning = false
    /// Games dealt on this device, which open with the shuffle and the deal.
    @State private var dealtHere: Set<String> = []
    @State private var resumable: PlayPayload?
    /// The ito room this device last hosted, once it's confirmed still open.
    @State private var itoRoom: String?
    @State private var webPage: WebPage?
    @State private var linkError: String?
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// The screen's width, for how many tiles go side by side on an iPad.
    @State private var width: CGFloat = 0

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

                        tiles
                    }
                    .padding(sizeClass == .regular ? 40 : 24)
                    // An iPad uses its width: at 1000 the tiles were too narrow
                    // for their buttons, and the screen was mostly margin.
                    .frame(maxWidth: sizeClass == .regular ? 1280 : 560, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Theme.cream)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { path.append(.you(nil)) } label: {
                        if let me = Faces.shared.me {
                            HStack(spacing: 6) {
                                AvatarView(name: me.name, size: 28)
                                Text(me.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            }
                        } else {
                            Label("You", systemImage: "person.crop.circle")
                        }
                    }
                    .accessibilityLabel(Faces.shared.me.map { "You: \($0.name)" } ?? "You")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { scanning = true } label: { Image(systemName: "qrcode.viewfinder") }
                        .accessibilityLabel("Scan a code")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { path.append(.settings) } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .toolbarBackground(Theme.feltDark, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .navigationDestination(for: Route.self, destination: destination)
            .task(id: path.isEmpty) {
                if path.isEmpty {
                    // A game handed over is for the screen it opened, once. Kept,
                    // it opened the table again later as it was at the deal —
                    // seen as the dealer, which told the store its seat was gone.
                    handedOver = [:]
                    handedOverFugitive = [:]
                    // Offline games waiting for a signal go home quietly.
                    Task { await OfflineUploads.sendWaiting() }
                    await Faces.shared.load()
                    await checkResume()
                    await checkItoRoom()
                }
            }
        }
        .sheet(item: $webPage) { page in SafariView(url: page.url).ignoresSafeArea() }
        .sheet(isPresented: $scanning) {
            ScanSheet { url in Task { await openLink(url) } }
        }
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
        case .itoHost(let code):
            ItoHostView(code: code)
        case .table(let code):
            if let payload = handedOver[code] {
                TableScreen(store: PlayStore(payload: payload, fromTheTop: dealtHere.contains(code)))
            } else {
                TableScreen(store: PlayStore(code: code))
            }
        case .fugitiveNew:
            FugitiveSetupView(onDealt: { go(.fugitive($0)) },
                              onResume: { path = [.fugitiveTable($0)] },
                              onOffline: { path = [.fugitiveOffline($0)] },
                              onNearby: { path = [.fugitiveNearby($0)] },
                              onRecords: { path.append(.fugitiveRecords) })
        case .fugitiveRecords:
            FugitiveRecordsView()
        case .fugitiveTable(let code):
            if let payload = handedOverFugitive[code] {
                FugitiveTableScreen(store: FugitiveStore(payload: payload))
            } else {
                FugitiveTableScreen(store: FugitiveStore(code: code))
            }
        case .fugitiveOffline(let code):
            OfflineFugitiveScreen(code: code)
        case .fugitiveNearby(let code):
            NearbyFugitiveScreen(code: code)
        case .you(let code):
            YouScreen(linkCode: code)
        }
    }

    /// Stacked on a phone. On an iPad three across when each tile gets room
    /// for its buttons (landscape), else two and one under — three across a
    /// portrait iPad broke "Records" over two lines. A Grid, so the tiles in
    /// a row are one height and their buttons line up.
    @ViewBuilder private var tiles: some View {
        if sizeClass != .regular {
            VStack(spacing: 16) {
                flip7Tile
                fugitiveTile
                itoTile
            }
        } else if width >= 1100 {
            Grid(horizontalSpacing: 20) {
                GridRow {
                    flip7Tile
                    fugitiveTile
                    itoTile
                }
            }
        } else {
            Grid(horizontalSpacing: 20, verticalSpacing: 20) {
                GridRow {
                    flip7Tile
                    fugitiveTile
                }
                GridRow {
                    itoTile
                    Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                }
            }
        }
    }

    // Every tile is the same shape: one button across, then Records and Rules.

    private var flip7Tile: some View {
        GameTile(title: "Flip 7", accent: Theme.gold,
                 blurb: "Push your luck, bank your cards — first to 200 takes it. The app is the deck: it shuffles, deals and adds it all up.") {
            Flip7Art()
        } actions: {
            Button { path.append(.newGame) } label: {
                Label("Start a game", systemImage: "suit.spade.fill")
            }
            .buttonStyle(FeltButtonStyle(kind: resumable == nil ? .gold : .ghost))
            moreRow(records: { path.append(.records) }, rules: "/flip7/rules")
        }
    }

    private var fugitiveTile: some View {
        GameTile(title: "Fugitive", accent: Noir.fugitive,
                 blurb: "One runs, one hunts — a trail of hideouts from the cell to the plane out at 42. Two players, on two phones or one passed across.") {
            FugitiveArt()
        } actions: {
            Button { path.append(.fugitiveNew) } label: {
                Label("Start a game", systemImage: "figure.run")
            }
            // Flip 7's Start keeps the gold: one gold button at a time.
            .buttonStyle(FeltButtonStyle(kind: .ghost))
            moreRow(records: { path.append(.fugitiveRecords) }, rules: "/fugitive/rules")
        }
    }

    private var itoTile: some View {
        GameTile(title: "ito", accent: Color(hex: 0x8F7BFF),
                 blurb: "Get the numbers in order without saying them. Host a room for the topic cards, or join with the host’s code to see them on this screen.") {
            ItoArt()
        } actions: {
            Group {
                if let room = itoRoom {
                    HStack(spacing: 10) {
                        Button { path.append(.itoHost(room)) } label: {
                            Label("Back to \(room)", systemImage: "arrow.uturn.backward")
                        }
                        Button { path.append(.itoHost(nil)) } label: { Label("New room", systemImage: "plus") }
                    }
                } else {
                    Button { path.append(.itoHost(nil)) } label: {
                        Label("Host a room", systemImage: "rectangle.on.rectangle")
                    }
                }
            }
            .buttonStyle(FeltButtonStyle(kind: .ghost))
            // ito's records are the server's stats page.
            moreRow(records: { open("/ito/stats") }, rules: "/ito/rules")
        }
    }

    private func moreRow(records: @escaping () -> Void, rules: String) -> some View {
        HStack(spacing: 10) {
            Button(action: records) { Label("Records", systemImage: "star") }
            Button { open(rules) } label: { Label("Rules", systemImage: "questionmark.circle") }
        }
        .buttonStyle(FeltButtonStyle(kind: .ghost))
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
        case .fugitive(let payload):
            handedOverFugitive[payload.code] = payload
            path = [.fugitiveTable(payload.code)]
        case .ito(let code):
            // Your own room's code (or its QR) brings you back to the deck.
            path = [ItoHostTokens().token(for: code) == nil ? .ito(code) : .itoHost(code)]
        case .profileLink(let code):
            path = [.you(code)]
        case .web(let url):
            webPage = WebPage(url: url)
        }
    }

    private func open(_ serverPath: String) {
        webPage = WebPage(url: AppSettings.client.webURL(serverPath))
    }

    /// A link from outside, or a QR scanned here: a room, or a code for
    /// signing this device in to a profile.
    private func openLink(_ url: URL) async {
        do {
            guard let destination = try await Joining.destination(for: url) else {
                linkError = "That link isn’t to a Game Night room."
                return
            }
            go(destination)
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            linkError = "Room \(Joining.code(in: url) ?? "") has ended or expired."
        } catch {
            linkError = error.localizedDescription
        }
    }

    /// The ito room this device hosted last, offered back only while it's
    /// still open — as the web landing page's "Resume your game" does.
    private func checkItoRoom() async {
        let tokens = ItoHostTokens()
        guard let code = tokens.lastRoom, tokens.token(for: code) != nil else { itoRoom = nil; return }
        do {
            _ = try await AppSettings.client.itoState(code: code)
            itoRoom = code
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            tokens.lastRoom = nil
            itoRoom = nil
        } catch {
            itoRoom = nil
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
            // One line each: a label broken mid-word ("Record / s") made
            // the buttons in a row different heights.
            actions.lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(18)
        // Fills its Grid cell, so tiles side by side end level.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
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

/// The trail, as on the web hub: two face-down hideouts, footprints between,
/// and 42 turned up — the plane out.
private struct FugitiveArt: View {
    var body: some View {
        HStack(spacing: 6) {
            FugitiveCard(number: nil, width: 54).rotationEffect(.degrees(-6))
            Image(systemName: "shoeprints.fill").font(.system(size: 16)).foregroundStyle(Noir.card.opacity(0.55))
                .rotationEffect(.degrees(90))
            FugitiveCard(number: nil, width: 54).rotationEffect(.degrees(3))
            Image(systemName: "shoeprints.fill").font(.system(size: 16)).foregroundStyle(Noir.card.opacity(0.55))
                .rotationEffect(.degrees(90))
            FugitiveCard(number: 42, width: 66).rotationEffect(.degrees(8))
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
