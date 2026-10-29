import SwiftUI

/// A game of Fugitive — the app's play.html. A detective's desk at night:
/// the other player's hand fanned across the table, the trail laid over a
/// street map, the three decks, your own hand nearest you. The Marshal's
/// notepad, the seats and the case notes sit beside the desk on an iPad in
/// landscape and below it anywhere narrower.
///
/// Everything a viewer mustn't see arrives as nil from the server, so the
/// screen can only draw what this device was allowed to know. Pass-and-play
/// covers the desk with a folder between turns.
struct FugitiveTableScreen: View {
    @State var store: FugitiveStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// Compact height: a phone held sideways, which gets its own layout.
    @Environment(\.verticalSizeClass) private var heightClass
    @State private var showingPanels = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var soundOn = Sound.enabled
    @State private var musicOn = Music.enabled
    @State private var rules: WebPage?
    @State private var showingCode = false

    var body: some View {
        let landscape = heightClass == .compact
        GeometryReader { geo in
            let wide = sizeClass == .regular && geo.size.width > geo.size.height
            let cardWidth: CGFloat = sizeClass != .regular ? min(60, geo.size.width / 6.3)
                : wide ? Self.deskCard(height: geo.size.height)
                : max(72, min(88, geo.size.width / 9))
            ZStack {
                DeskBackground().ignoresSafeArea()
                if store.gone {
                    FugitiveGone()
                } else if let payload = store.payload {
                    if landscape {
                        LandscapeTable(store: store, payload: payload, size: geo.size)
                    } else if wide {
                        HStack(alignment: .top, spacing: 18) {
                            ScrollView {
                                VStack(spacing: 14) {
                                    StatusTag(payload: payload, holding: store.revealing)
                                    Desk(store: store, payload: payload, cardWidth: cardWidth, controls: false)
                                }
                                .padding(20)
                            }
                            // Scrolls only when it must: a column that fits doesn't bounce.
                            .scrollBounceBehavior(.basedOnSize)
                            // Hiding happens in the column beside the desk, not in
                            // a bar over the hand: the column has the room.
                            ScrollView {
                                VStack(spacing: 14) {
                                    HidingPanel(store: store)
                                    SidePanels(store: store, payload: payload)
                                }
                                .padding(.vertical, 20)
                            }
                            .scrollBounceBehavior(.basedOnSize)
                            .frame(width: 370)
                            .padding(.trailing, 20)
                        }
                    } else {
                        ScrollView {
                            VStack(spacing: 14) {
                                StatusTag(payload: payload, holding: store.revealing)
                                Desk(store: store, payload: payload, cardWidth: cardWidth)
                                SidePanels(store: store, payload: payload)
                            }
                            .padding(16)
                            .frame(maxWidth: 720)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollBounceBehavior(.basedOnSize)
                        .safeAreaInset(edge: .bottom, spacing: 0) { HideBar.room(store) }
                    }
                } else {
                    ProgressView("Shuffling…").tint(Noir.card).foregroundStyle(Noir.card)
                }

                // Drawn over the table rather than as the scroll view's inset:
                // on iOS 26 the inset gets the scroll edge effect, and the
                // hand showed through it.
                // Sideways, Hide sits in the table's right-hand column instead.
                if !landscape && !wide { VStack { Spacer(); HideBar(store: store) } }
                // Not over a game that's gone: its last payload is still in the store.
                if landscape, showingPanels, !store.gone, let payload = store.payload {
                    LandscapePanels(store: store, payload: payload, showing: $showingPanels)
                        .transition(.move(edge: .trailing))
                }
                if store.game?.phase == .manhunt { SirenWash() }
                if store.flyingAway { PlaneAway() }
                if let stamp = store.stamp { InkStamp(stamp: stamp).id(stamp.id) }
                if let role = store.folderFor, let payload = store.payload {
                    FolderCurtain(store: store, role: role, name: payload.name(role))
                }
            }
            .animation(.easeInOut(duration: 0.25), value: store.folderFor)
            .animation(.easeOut(duration: 0.22), value: showingPanels)
        }
        .navigationTitle(store.game?.myTurn == true ? "● Your turn" : store.inviteURL == nil ? "Fugitive · offline" : "Fugitive")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Noir.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if heightClass == .compact, !store.gone {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingPanels.toggle() } label: { Image(systemName: "sidebar.right") }
                        .accessibilityLabel(showingPanels ? "Hide the seats and case notes" : "Show the seats and case notes")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { rules = WebPage(url: AppSettings.client.webURL("/fugitive/rules")) } label: {
                    Image(systemName: "questionmark.circle")
                }
                .accessibilityLabel("Rules")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    musicOn.toggle()
                    Music.enabled = musicOn
                    if musicOn, let tension = store.tension { Music.shared.play(intensity: tension) }
                } label: {
                    Image(systemName: musicOn ? "music.note" : "music.note.slash")
                }
                .accessibilityLabel(musicOn ? "Music on" : "Music off")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    soundOn.toggle()
                    Sound.enabled = soundOn
                } label: {
                    Image(systemName: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                }
                .accessibilityLabel(soundOn ? "Sounds on" : "Sounds off")
            }
            // The room code behind an icon, not as text squeezed in beside
            // the others: it's wanted when someone joins, not all game. A
            // game kept on this phone has no code anyone else can use.
            if let url = store.inviteURL {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingCode = true } label: { Image(systemName: "qrcode") }
                        .accessibilityLabel("Room code \(store.code.map(String.init).joined(separator: " "))")
                        .sheet(isPresented: $showingCode) { RoomCodeSheet(code: store.code, url: url) }
                }
            }
        }
        .sheet(item: $rules) { page in SafariView(url: page.url).ignoresSafeArea() }
        .overlay(alignment: .bottom) {
            if let notice = store.notice {
                NoticeView(text: notice)
                    .padding(.bottom, 40)
                    .task {
                        try? await Task.sleep(for: .seconds(3.2))
                        if store.notice == notice { store.notice = nil }
                    }
            }
        }
        .onAppear { store.start() }
        .onDisappear {
            store.stop()
            Music.shared.stop()
        }
        // The music follows the hunt, and stops when the game does.
        .onChange(of: store.tension) { _, tension in
            if let tension { Music.shared.play(intensity: tension) } else { Music.shared.stop() }
        }
        .task(id: store.payload == nil) {
            if let tension = store.tension { Music.shared.play(intensity: tension) }
        }
        .keepsScreenAwake()
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.start() } else { store.stop() }
        }
        // An offline game that's just finished: send it home if there's signal.
        .onChange(of: store.game?.isOver == true) { _, over in
            if over && store.inviteURL == nil { Task { await OfflineUploads.sendWaiting() } }
        }
        .task { await Faces.shared.load() }
        .preferredColorScheme(.dark)
    }

    /// An iPad in landscape: cards as big as the height allows. The desk is
    /// about 5.2 card widths tall (both hands, the trail with a sprint card
    /// under it, the decks) plus ~450pt of banner, nameplates, gaps and room
    /// for a trail three sprint cards deep; the hiding controls and Hide are
    /// in the column beside it (`HidingPanel`), not in a bar over the hand.
    /// At a fixed 72 a 13" iPad left a third of the screen empty under the
    /// hand. Never smaller than that 72, and not past what the 240px card
    /// images draw sharply.
    static func deskCard(height: CGFloat) -> CGFloat {
        max(72, min(112, (height - 450) / 5.2))
    }
}

// MARK: - words

/// The case tag at the top: whose move, and what it is.
private struct StatusTag: View {
    let payload: FugitivePayload
    /// Smaller type and less paper: the right-hand column of a phone held sideways.
    var compact = false
    /// Found cards are still turning over: a catch isn't announced before
    /// the cards that decide it are face up. Any other ending says itself.
    var holding = false

    var body: some View {
        let words = holding && payload.game.isOver ? ("The cards turn over…", "") : Self.words(payload)
        let line = words.0, small = words.1
        let g = payload.game
        let colour = g.winner.map(Noir.colour) ?? g.turn.map(Noir.colour) ?? Noir.card
        HStack(spacing: compact ? 10 : 12) {
            RoundedRectangle(cornerRadius: 2).fill(colour).frame(width: compact ? 5 : 6)
            VStack(alignment: .leading, spacing: compact ? 1 : 3) {
                Text(line).font(Noir.poster(compact ? 22 : 28)).foregroundStyle(Noir.ink)
                if !small.isEmpty {
                    Text(small).font(Noir.type(compact ? 12 : 13)).foregroundStyle(Noir.ink.opacity(0.72))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            // Both players see how the game is being played.
            if !payload.hintsOn {
                Text("NO HINTS").font(Noir.type(compact ? 10 : 11)).kerning(1)
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Noir.ink.opacity(0.5)))
                    .foregroundStyle(Noir.ink.opacity(0.75))
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, compact ? 6 : 10).padding(.horizontal, compact ? 10 : 12)
        .background(Noir.manila, in: RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
        .rotationEffect(.degrees(-0.6))
        .accessibilityElement(children: .combine)
    }

    static func words(_ payload: FugitivePayload) -> (String, String) {
        let g = payload.game, f = payload.name(.fugitive), m = payload.name(.marshal)
        let mine = g.myTurn
        switch g.phase {
        case .gameOver:
            switch g.reason {
            case "caught": return ("\(m) caught \(f)", "Every hideout found.")
            case "escaped": return ("\(f) escaped", "Made it to 42.")
            case "manhunt_failed": return ("\(f) escaped", "\(m) missed in the Manhunt.")
            case "let_go": return ("\(f) escaped", "\(m) let them go.")
            case "resigned":
                let won = g.winner == .fugitive
                return ("\(won ? f : m) wins", "\(won ? m : f) gave up.")
            default: return ("Game over", "")
            }
        case .fugitiveDraw:
            return (mine ? "Your move — draw a card" : "\(f) is drawing", "From any deck. The Marshal sees which one.")
        case .fugitiveHide:
            let small = g.firstTurn
                ? (g.hidesLeft == 2 ? "First turn: one or two hideouts." : "One more, or stop there.")
                : "Lay a hideout, or draw an extra card instead."
            return (mine ? "Your move — hide" : "\(f) is on the run", small)
        case .marshalDraw:
            return (mine ? "Your move — draw \(g.drawsLeft == 2 ? "two cards" : "a card")" : "\(m) is drawing",
                    "Cards the Marshal holds can’t be hideouts.")
        case .marshalGuess:
            return (mine ? "Your move — guess" : "\(m) is guessing", "One number, or several — then every one must be right.")
        case .manhunt:
            return ("Manhunt!", "\(m) must find every hideout left, one guess at a time. One miss and \(f) is gone.")
        }
    }
}

/// play.html's `describe`: one line of the case notes.
func fugitiveNote(_ e: FugitiveEvent, in payload: FugitivePayload) -> String? {
    let f = payload.name(.fugitive), m = payload.name(.marshal)
    let name = e.role.map { payload.name($0) } ?? ""
    switch e.kind {
    case "drew":
        let deck = e.deck.flatMap { Decks.labels.indices.contains($0) ? Decks.labels[$0] : nil } ?? "a deck"
        return "\(name) drew from \(deck)" + (e.card.map { " — \($0)" } ?? "")
    case "hid":
        let hideouts = payload.game.hideouts
        let count = e.index.flatMap { hideouts.indices.contains($0) ? hideouts[$0].sprintCount : nil } ?? 0
        return "\(f) hid" + (e.card.map { " at \($0)" } ?? "")
            + (count > 0 ? ", sprinting with \(count) card\(count > 1 ? "s" : "")" : "")
    case "passed":
        return "\(f) didn’t hide, and drew an extra card"
    case "guessed":
        let numbers = e.numbers ?? []
        let list = numbers.map(String.init).joined(separator: ", ")
        if e.hit == true { return "\(m) guessed \(list) — found!" }
        return numbers.count > 1 ? "\(m) guessed \(list) — not all right, nothing turned over" : "\(m) guessed \(list) — nothing there"
    case "manhunt":
        return "\(f) reached 42 — Manhunt!"
    default:
        return nil
    }
}

// MARK: - the desk

private struct Desk: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    let cardWidth: CGFloat
    /// The hiding controls and the Marshal's hint under the hand; an iPad in
    /// landscape has them in the column beside the desk instead.
    var controls = true

    var body: some View {
        let g = payload.game
        let me = g.viewerRole
        // Across the table: the other player. The table itself seats the
        // Marshal across and the Fugitive near.
        let across: FugitiveRole = me == .marshal ? .fugitive : .marshal
        let near: FugitiveRole = me ?? .fugitive
        VStack(spacing: 14) {
            Plate(store: store, payload: payload, role: across, mine: false, cardWidth: cardWidth * 0.66)
            Trail(store: store, payload: payload, cardWidth: cardWidth)
            Decks(store: store, game: g, cardWidth: cardWidth * 0.86)
            Plate(store: store, payload: payload, role: near, mine: near == me, cardWidth: cardWidth)
            if controls, me == .fugitive { FugitiveControls(store: store, game: g) }
            if controls, me == .marshal { MarshalHint(game: g) }
        }
    }
}

/// A player's place at the table: their face and name, and their hand
/// fanned — faces for your own, backs for anyone else's.
private struct Plate: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    let role: FugitiveRole
    let mine: Bool
    let cardWidth: CGFloat
    /// One line for the name and a tighter frame: a phone held sideways.
    var compact = false
    /// The opening deal: off the table, then in one at a time.
    @State private var dealtIn = true

    var body: some View {
        let g = payload.game
        let count = g.handCount(role)
        let turn = g.turn == role && !g.isOver
        VStack(spacing: compact ? 2 : 6) {
            HStack(spacing: compact ? 8 : 10) {
                Mugshot(name: payload.name(role), role: role, size: compact ? 26 : 40)
                if compact {
                    Text(payload.name(role)).font(Noir.poster(19)).foregroundStyle(Noir.card)
                    Text("\(role.title) · \(count) card\(count == 1 ? "" : "s")")
                        .font(Noir.type(12)).foregroundStyle(Noir.card.opacity(0.6))
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(payload.name(role)).font(Noir.poster(24)).foregroundStyle(Noir.card)
                        Text("\(role.title) · \(count) card\(count == 1 ? "" : "s")")
                            .font(Noir.type(12)).foregroundStyle(Noir.card.opacity(0.6))
                    }
                }
                Spacer()
                if turn {
                    Text(mine ? "YOUR MOVE" : "THEIR MOVE")
                        .font(Noir.type(11)).kerning(1)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Noir.colour(role), in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(Noir.ink)
                }
            }
            Fan(store: store, game: g, cards: store.shownHand(role),
                hiding: mine && role == .fugitive && g.turn == .fugitive && g.phase == .fugitiveHide,
                cardWidth: cardWidth, dealtIn: dealtIn)
        }
        .padding(.horizontal, 12).padding(.vertical, compact ? 6 : 12)
        .background(Color.black.opacity(turn ? 0.34 : 0.22), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .strokeBorder(turn ? Noir.colour(role).opacity(0.85) : Noir.line, lineWidth: turn ? 2 : 1))
        .task(id: store.dealing) {
            guard store.dealing else { return }
            dealtIn = false
            try? await Task.sleep(for: .milliseconds(60))
            dealtIn = true
        }
    }
}

private struct Fan: View {
    let store: FugitiveStore
    let game: FugitiveGame
    let cards: [Int?]
    let hiding: Bool
    let cardWidth: CGFloat
    let dealtIn: Bool

    private struct Item: Identifiable {
        let id: String
        let number: Int?
        let index: Int
    }

    var body: some View {
        let items = cards.enumerated().map { i, n in Item(id: n.map { "c\($0)" } ?? "b\(i)", number: n, index: i) }
        let n = items.count
        let spread = min(7, 44 / Double(max(n, 1)))
        // Read here, in body, so a change to it redraws the fan. Read only
        // inside ForEach's content, it isn't tracked, and a switch of step
        // left the badges showing the last one.
        let choice = store.hiding
        GeometryReader { geo in
            let step = n > 1 ? min(cardWidth * 0.64, (geo.size.width - cardWidth) / CGFloat(n - 1)) : 0
            ZStack {
                if n == 0 {
                    Text("No cards").font(Noir.type(12)).foregroundStyle(Noir.card.opacity(0.4))
                }
                ForEach(items) { item in
                    let d = CGFloat(item.index) - CGFloat(n - 1) / 2
                    card(item, choice)
                        .rotationEffect(.degrees(Double(d) * spread), anchor: .bottom)
                        .offset(x: d * step, y: d * d * 0.9)
                        .offset(y: dealtIn ? 0 : -260)
                        .opacity(dealtIn ? 1 : 0)
                        .animation(dealtIn ? .spring(response: 0.45, dampingFraction: 0.8).delay(Double(item.index) * 0.07) : nil,
                                   value: dealtIn)
                        .zIndex(Double(item.index))
                        .transition(.asymmetric(insertion: .offset(y: -120).combined(with: .opacity), removal: .opacity))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: cardWidth * 1.4 + 26)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: cards)
        .animation(.spring(response: 0.25, dampingFraction: 0.75), value: choice)
    }

    @ViewBuilder private func card(_ item: Item, _ choice: FugitiveHiding) -> some View {
        if hiding, let number = item.number {
            let picked = choice.pick == number
            let sprinting = choice.sprints.contains(number)
            let badge = badge(number, choice, picked: picked, sprinting: sprinting)
            let dim = !picked && !sprinting && !choice.canTap(number, in: game)
            Button { store.tap(number) } label: {
                FugitiveCard(number: number, width: cardWidth)
                    .overlay {
                        if picked || sprinting {
                            RoundedRectangle(cornerRadius: cardWidth * 0.08)
                                .strokeBorder(picked ? Noir.fugitive : Noir.marshal, lineWidth: 3)
                        }
                    }
                    .overlay(alignment: .top) {
                        // Over the left of the card: the part the next card in the fan leaves showing.
                        if let badge { HandBadge(badge: badge).offset(x: -cardWidth * 0.17, y: -9) }
                    }
                    .offset(y: picked ? -22 : sprinting ? -12 : 0)
                    .opacity(dim ? 0.35 : 1)
            }
            .buttonStyle(PaperPress())
            .disabled(store.busy || store.animating || dim)
            .accessibilityLabel(cardLabel(number, badge: badge))
            .accessibilityAddTraits(picked || sprinting ? .isSelected : [])
        } else {
            FugitiveCard(number: item.number, width: cardWidth)
        }
    }

    /// What the card shows it would do: its cost as a hideout while choosing
    /// one, its footprints while sprinting, and what it's been chosen for.
    private func badge(_ number: Int, _ choice: FugitiveHiding, picked: Bool, sprinting: Bool) -> HandBadge.Kind? {
        if picked { return .hide }
        let steps = game.steps(number)
        if sprinting { return .sprint(steps) }
        // Without hints the hand shows only what's been chosen.
        guard choice.hints else { return nil }
        switch choice.mode {
        case .hideout:
            switch FugitiveHiding.cost(number, in: game) {
            case .inReach: return .inReach
            case .needs(let n): return .needs(n)
            case .outOfReach: return nil
            }
        case .sprint:
            return steps > 0 ? .steps(steps) : nil
        }
    }

    private func cardLabel(_ number: Int, badge: HandBadge.Kind?) -> String {
        switch badge {
        case .hide: return "\(number), hiding here"
        case .sprint(let n): return "\(number), sprinting, \(n) footprint\(n == 1 ? "" : "s")"
        case .inReach: return "\(number), in reach"
        case .needs(let n): return "\(number), needs \(n) more footprint\(n == 1 ? "" : "s")"
        case .steps(let n): return "\(number), sprint for \(n) footprint\(n == 1 ? "" : "s")"
        case nil: return store.hiding.hints ? "\(number), out of reach" : "\(number)"
        }
    }
}

/// The tag over a card in the Fugitive's hand while hiding.
private struct HandBadge: View {
    enum Kind: Equatable {
        case inReach, needs(Int), steps(Int), hide, sprint(Int)
    }
    let badge: Kind

    var body: some View {
        HStack(spacing: 2) {
            switch badge {
            case .inReach:
                Image(systemName: "checkmark").font(.system(size: 9, weight: .black))
            case .hide:
                Text("HIDE")
            case .needs(let n), .steps(let n), .sprint(let n):
                Image(systemName: "shoeprints.fill").font(.system(size: 8))
                Text("+\(n)")
            }
        }
        .font(Noir.poster(13))
        .foregroundStyle(filled ? Noir.ink : Noir.card)
        .padding(.horizontal, badge == .inReach ? 4 : 5)
        .frame(minWidth: 20, minHeight: 20)
        .background(Capsule().fill(fill))
        .overlay(Capsule().strokeBorder(edge, lineWidth: 1.5))
        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
        .accessibilityHidden(true)
    }

    private var filled: Bool {
        switch badge {
        case .inReach, .hide, .sprint: true
        case .needs, .steps: false
        }
    }
    private var fill: Color {
        switch badge {
        case .inReach, .hide: Noir.fugitive
        case .sprint: Noir.marshal
        case .needs, .steps: Noir.night.opacity(0.92)
        }
    }
    private var edge: Color {
        switch badge {
        case .steps: Noir.marshal
        case .needs: Noir.fugitive
        default: .clear
        }
    }
}

/// The trail across the map: the cell at 0, then each hideout with its
/// sprint cards tucked beneath, peeking out below it as on a real table.
private struct Trail: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    let cardWidth: CGFloat

    var body: some View {
        let g = payload.game
        let showSlot = g.viewerRole == .fugitive && g.turn == .fugitive && g.phase == .fugitiveHide
        let tuck = cardWidth * 0.24
        let deepest = max(g.hideouts.map(\.sprintCount).max() ?? 0, showSlot ? store.sprints.count : 0)
        let hints = store.assist && g.candidates != nil
        // Read here, in body: read only inside ForEach's content, a hideout
        // landing wasn't tracked, and it stayed invisible until something
        // else redrew the trail — after a first-turn hideout, nothing did.
        let landing = store.landing
        // Read too, so the trail draws again once the table settles. A
        // hideout with sprint cards under it sometimes missed the change to
        // `landing` alone and stayed invisible until the next move.
        let settled = !store.animating
        // Found but not yet turned over: still drawn as the Marshal saw it.
        let turning = settled ? [] : store.turning
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: cardWidth * 0.22) {
                    ForEach(Array(g.hideouts.enumerated()), id: \.offset) { i, hideout in
                        let shown = turning.contains(i) ? hideout.unturned(for: g.viewerRole) : hideout
                        Stop(hideout: shown, found: shown.revealed && i > 0 && shown.card != 42,
                             hint: hint(g, i), width: cardWidth)
                            .offset(y: landing.contains(i) && !settled ? 170 : 0)
                            .opacity(landing.contains(i) && !settled ? 0 : 1)
                    }
                    if showSlot { Slot(store: store, width: cardWidth) }
                    Color.clear.frame(width: 1, height: 1).id("end")
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
            }
            .onAppear { proxy.scrollTo("end", anchor: .trailing) }
            .onChange(of: g.hideouts.count) {
                withAnimation(.easeOut(duration: 0.35)) { proxy.scrollTo("end", anchor: .trailing) }
            }
            .onChange(of: store.pick) { proxy.scrollTo("end", anchor: .trailing) }
        }
        .frame(height: cardWidth * 1.4 + CGFloat(deepest) * tuck + 28 + (hints ? 24 : 0))
        .background(CityMap(code: payload.code))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Noir.line, lineWidth: 1.5))
        .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
        .modifier(Shake(phase: CGFloat(store.shakes)))
        .animation(.linear(duration: 0.45), value: store.shakes)
    }

    /// The Marshal's pencilled range under a face-down hideout.
    private func hint(_ g: FugitiveGame, _ i: Int) -> String? {
        guard store.assist, let sets = g.candidates, sets.indices.contains(i), g.hideouts[i].card == nil,
              let first = sets[i].first, let last = sets[i].last else { return nil }
        return sets[i].count <= 4 ? sets[i].map(String.init).joined(separator: " · ") : "\(first)–\(last)"
    }
}

private struct Stop: View {
    let hideout: Hideout
    let found: Bool
    let hint: String?
    let width: CGFloat

    var body: some View {
        let tuck = width * 0.24
        let under: [Int?] = hideout.sprints.map { $0.map { Optional($0) } } ?? Array(repeating: nil, count: hideout.sprintCount)
        VStack(spacing: 4) {
            ZStack(alignment: .top) {
                ForEach(Array(under.enumerated().reversed()), id: \.offset) { k, card in
                    FugitiveCard(number: card, width: width).offset(y: CGFloat(k + 1) * tuck)
                }
                FugitiveCard(number: hideout.card, width: width)
                    .overlay {
                        if found {
                            RoundedRectangle(cornerRadius: width * 0.08).strokeBorder(Noir.found, lineWidth: 3)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        // Known to this viewer, still face down to the Marshal.
                        if hideout.card != nil && !hideout.revealed {
                            Image(systemName: "eye.slash.fill")
                                .font(.system(size: 9, weight: .bold))
                                .padding(4)
                                .background(Circle().fill(Noir.ink.opacity(0.85)))
                                .foregroundStyle(Noir.card)
                                .offset(x: 5, y: -5)
                                .accessibilityLabel("Still face down to the Marshal")
                        }
                    }
                    .id(hideout.card.map { "c\($0)" } ?? "back")
                    .transition(.turnOver)
            }
            .frame(height: width * 1.4 + CGFloat(under.count) * tuck, alignment: .top)
            .animation(.easeOut(duration: 0.45), value: hideout.card)
            if let hint {
                Text(hint).font(Noir.hand(17)).foregroundStyle(Noir.card.opacity(0.85))
                    .lineLimit(1).fixedSize()
            }
        }
    }
}

/// Where the next hideout would go, while the Fugitive is choosing.
private struct Slot: View {
    let store: FugitiveStore
    let width: CGFloat

    var body: some View {
        let tuck = width * 0.24
        let sprints = store.sprints.sorted()
        if let pick = store.pick {
            ZStack(alignment: .top) {
                ForEach(Array(sprints.enumerated().reversed()), id: \.element) { k, card in
                    FugitiveCard(number: card, width: width).offset(y: CGFloat(k + 1) * tuck)
                }
                FugitiveCard(number: pick, width: width)
                    .overlay(RoundedRectangle(cornerRadius: width * 0.08)
                        .strokeBorder(store.canHide ? Noir.fugitive : Noir.miss, style: StrokeStyle(lineWidth: 3, dash: [6, 4])))
                    .opacity(0.92)
            }
            .frame(height: width * 1.4 + CGFloat(sprints.count) * tuck, alignment: .top)
        } else {
            VStack(spacing: 0) {
                // Without hints the slot doesn't say how far you reach.
                if store.hiding.hints {
                    Text("up to").font(Noir.type(11))
                    Text("\(store.reach)").font(Noir.poster(width * 0.5))
                } else {
                    Text("next").font(Noir.type(12))
                }
            }
            .foregroundStyle(Noir.card.opacity(0.8))
            .frame(width: width, height: width * 1.4)
            .overlay(RoundedRectangle(cornerRadius: width * 0.08)
                .strokeBorder(Noir.card.opacity(0.5), style: StrokeStyle(lineWidth: 2, dash: [5, 4])))
        }
    }
}

/// The three decks, by era: on foot, by car, the airfield.
struct Decks: View {
    let store: FugitiveStore
    let game: FugitiveGame
    let cardWidth: CGFloat
    /// Just the icon under each pile, not its range: a phone held sideways.
    var compact = false

    static let labels = ["4–14", "15–28", "29–41"]
    static let icons = ["figure.walk", "car.fill", "airplane"]

    var body: some View {
        let canDraw = game.myTurn && (game.phase == .fugitiveDraw || game.phase == .marshalDraw)
            && !store.animating && !store.busy
        let colour = game.turn.map(Noir.colour) ?? Noir.card
        HStack(spacing: compact ? 16 : 20) {
            ForEach(game.deckCounts.indices, id: \.self) { i in
                let n = game.deckCounts[i]
                if canDraw && n > 0 {
                    Button { Task { await store.draw(from: i) } } label: { pile(i, n, live: colour) }
                        .buttonStyle(PaperPress())
                        .accessibilityLabel("Draw from \(Self.labels[i]) (\(n) left)")
                } else {
                    pile(i, n, live: nil)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(Self.labels[i]): \(n) left")
                }
            }
        }
    }

    private func pile(_ i: Int, _ n: Int, live: Color?) -> some View {
        let layers = min(4, (n + 3) / 4)
        return VStack(spacing: compact ? 4 : 6) {
            ZStack {
                if n == 0 {
                    RoundedRectangle(cornerRadius: cardWidth * 0.08)
                        .strokeBorder(Noir.card.opacity(0.25), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                        .frame(width: cardWidth, height: cardWidth * 1.4)
                }
                ForEach(0..<layers, id: \.self) { k in
                    FugitiveCard(number: nil, width: cardWidth)
                        .offset(x: CGFloat(layers - 1 - k) * -1.5, y: CGFloat(layers - 1 - k) * 2)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if n > 0 {
                    Text("\(n)").font(Noir.poster(15))
                        .frame(minWidth: 22, minHeight: 22)
                        .background(Circle().fill(Noir.night))
                        .overlay(Circle().strokeBorder(Noir.card.opacity(0.4)))
                        .foregroundStyle(Noir.card)
                        .offset(x: 8, y: 6)
                }
            }
            .shadow(color: (live ?? .clear).opacity(0.9), radius: live == nil ? 0 : 12)
            .scaleEffect(live == nil ? 1 : 1.05)
            Group {
                if compact {
                    Image(systemName: Self.icons[i]).font(.system(size: 11))
                } else {
                    Label(Self.labels[i], systemImage: Self.icons[i]).font(Noir.type(12))
                }
            }
            .foregroundStyle(Noir.card.opacity(live == nil ? 0.6 : 1))
        }
    }
}

private struct FugitiveControls: View {
    let store: FugitiveStore
    let game: FugitiveGame
    /// Sideways, the column is short: the heading loses "First turn" (the
    /// banner above says it), and the hint shows only once a hideout is
    /// picked — before then the badges on the cards say the same.
    var compact = false

    var body: some View {
        if game.turn == .fugitive, game.viewerRole == .fugitive {
            if game.phase == .fugitiveDraw {
                ControlHint(text: "Tap a deck to draw.")
            } else if game.phase == .fugitiveHide {
                VStack(spacing: compact ? 8 : 10) {
                    if let heading = FugitiveHiding.heading(game) {
                        Text((compact ? heading.replacingOccurrences(of: "First turn · ", with: "") : heading).uppercased())
                            .font(Noir.type(13)).foregroundStyle(Noir.fugitive)
                            .multilineTextAlignment(.center)
                    }
                    HidingSteps(store: store)
                    if !compact || store.pick != nil {
                        ControlHint(text: store.hiding.hint(game))
                    }
                    // Hide and the way out are in HideBar, pinned to the bottom.
                }
            }
        }
    }

}

/// The room's code, big, and its invite QR: what the toolbar's QR icon opens.
private struct RoomCodeSheet: View {
    let code: String
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 18) {
            Text("ROOM CODE").font(Noir.type(14)).kerning(2).foregroundStyle(Noir.card.opacity(0.7))
            Text(code).font(Noir.poster(64)).kerning(8).foregroundStyle(Noir.fugitive)
                .accessibilityLabel(code.map(String.init).joined(separator: " "))
            if let qr = QRCode.image(url.absoluteString) {
                Image(uiImage: qr).interpolation(.none).resizable()
                    .frame(width: 200, height: 200)
                    .padding(12)
                    .background(Noir.card, in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel("QR code for game \(code)")
            }
            Text("Scan to open this game, send the link, or enter the code under “Join with a code”.")
                .font(.footnote).foregroundStyle(Noir.card.opacity(0.75))
                .multilineTextAlignment(.center)
            InviteLink(url: url, message: "Play Fugitive with me on Game Night — code \(code)")
                .buttonStyle(NoirButtonStyle())
            Button("Done") { dismiss() }.buttonStyle(NoirButtonStyle(fill: nil))
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Noir.night.ignoresSafeArea())
        // Large only: at medium the QR and Done fell below the fold.
        .presentationDetents([.large])
        .preferredColorScheme(.dark)
    }
}

/// While hiding, Hide and the way out of it sit in a bar pinned to the
/// bottom of the screen. Below the hand and the hint, Hide was off-screen
/// on a phone, and it wasn't clear a chosen hideout still had to be
/// confirmed; the way out was a second half-width button that wrapped.
struct HideBar: View {
    let store: FugitiveStore

    static func shown(_ store: FugitiveStore) -> FugitiveGame? {
        // Not over a game that's gone: its last payload is still in the store.
        guard !store.gone, let game = store.game, game.turn == .fugitive, game.viewerRole == .fugitive,
              game.phase == .fugitiveHide, store.folderFor == nil else { return nil }
        return game
    }

    /// Room at the end of the scroll for the bar drawn over it, so the last
    /// of the table can still be scrolled clear of it.
    @ViewBuilder static func room(_ store: FugitiveStore) -> some View {
        if let game = shown(store) {
            Color.clear.frame(height: FugitiveHiding.passLabel(game) == nil ? 78 : 116)
        }
    }

    var body: some View {
        if Self.shown(store) != nil {
            HideActions(store: store)
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .background(Noir.night.ignoresSafeArea(edges: .bottom))
            .overlay(alignment: .top) { Rectangle().fill(Noir.line).frame(height: 1) }
        }
    }
}

/// An iPad in landscape: the hiding step, its hint and Hide at the top of
/// the column beside the desk, where the bar would have covered the hand.
private struct HidingPanel: View {
    let store: FugitiveStore

    var body: some View {
        if let game = HideBar.shown(store) {
            NoirPanel(title: "Your move") {
                VStack(spacing: 12) {
                    FugitiveControls(store: store, game: game)
                    HideActions(store: store)
                }
            }
        } else if let game = store.game, game.viewerRole == .fugitive, game.turn == .fugitive, game.phase == .fugitiveDraw {
            NoirPanel(title: "Your move") { ControlHint(text: "Tap a deck to draw.") }
        } else if let game = store.game, game.viewerRole == .marshal, game.turn == .marshal,
                  [.marshalDraw, .marshalGuess, .manhunt].contains(game.phase) {
            NoirPanel(title: "Your move") { MarshalHint(game: game) }
        }
    }
}

/// Hide, and the way out of hiding under it: the bar's contents, and the
/// right-hand column's on a phone held sideways.
struct HideActions: View {
    let store: FugitiveStore

    var body: some View {
        if let game = HideBar.shown(store) {
            VStack(spacing: 4) {
                Button {
                    Task { await store.hide() }
                } label: {
                    Text(store.pick.map { "Hide at \($0)" } ?? "Choose a hideout")
                }
                .buttonStyle(NoirButtonStyle(fill: Noir.fugitive))
                .disabled(!store.canHide || store.busy || store.animating)
                if let pass = FugitiveHiding.passLabel(game) {
                    Button {
                        Task { await store.pass() }
                    } label: {
                        Text(pass).font(Noir.type(15)).foregroundStyle(Noir.card.opacity(0.9))
                            .padding(.vertical, 8).frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(store.busy || store.animating)
                }
            }
        }
    }
}

/// A phone held sideways: the whole table on one screen. The trail across
/// the top, the decks and your hand under it, and a column on the right for
/// what you act on now — the turn's banner and the hiding controls, or the
/// Marshal's notepad. The seats and case notes are a panel away, behind the
/// toolbar's sidebar button. The portrait desk stacked everything in one
/// long column; on the biggest iPhones, which are regular width sideways,
/// it got the iPad's layout with a 370pt side column beside that column.
private struct LandscapeTable: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    let size: CGSize

    var body: some View {
        let g = payload.game
        let me = g.viewerRole
        let across: FugitiveRole = me == .marshal ? .fugitive : .marshal
        let near: FugitiveRole = me ?? .fugitive
        // Cards sized so the opponent's line, the trail and the hand fit the
        // height: two rows of cards at 1.4x their width, plus the chrome.
        let cardWidth = max(36, min(62, (size.height - 150) / 3.1))
        let guessing = me == .marshal && GuessActions.shown(g)
        HStack(alignment: .top, spacing: 14) {
            // Scrolls only if it has to (a trail deep in sprint cards).
            ScrollView {
                VStack(spacing: 6) {
                    OpponentLine(payload: payload, role: across)
                    Trail(store: store, payload: payload, cardWidth: cardWidth)
                    Plate(store: store, payload: payload, role: near, mine: near == me, cardWidth: cardWidth, compact: true)
                }
                .padding(.vertical, 4)
            }
            .scrollBounceBehavior(.basedOnSize)
            // The column: what to do now, scrolling if it must, with Hide or
            // Guess pinned under it so they're never scrolled away.
            VStack(spacing: 8) {
            ScrollView {
                VStack(spacing: 10) {
                    StatusTag(payload: payload, compact: true, holding: store.revealing)
                    // A guessing Marshal can't draw, and the notepad needs
                    // the room: the decks are back for the next draw.
                    if !guessing { Decks(store: store, game: g, cardWidth: cardWidth * 0.6, compact: true) }
                    if me == .fugitive { FugitiveControls(store: store, game: g, compact: true) }
                    // No MarshalHint: the banner says the same, and the notepad is the hint.
                    if me == .marshal { Notepad(store: store, payload: payload, compact: true) }
                    if me == nil { SeatsPanel(store: store, payload: payload) }
                }
                .padding(.vertical, 6)
            }
            .scrollBounceBehavior(.basedOnSize)
            HideActions(store: store).padding(.bottom, 4)
            if guessing { GuessActions(store: store, payload: payload, compact: true).padding(.bottom, 4) }
            }
            .frame(width: min(330, size.width * 0.38))
        }
        .padding(.horizontal, 10)
    }
}

/// The other player, on one line above the trail when sideways.
private struct OpponentLine: View {
    let payload: FugitivePayload
    let role: FugitiveRole

    var body: some View {
        let g = payload.game
        let count = g.handCount(role)
        HStack(spacing: 8) {
            Mugshot(name: payload.name(role), role: role, size: 28)
            Text(payload.name(role)).font(Noir.poster(20)).foregroundStyle(Noir.card)
            Text("\(role.title) · \(count) card\(count == 1 ? "" : "s")")
                .font(Noir.type(12)).foregroundStyle(Noir.card.opacity(0.6))
            if g.turn == role && !g.isOver {
                Text("THEIR MOVE").font(Noir.type(11)).kerning(1)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Noir.colour(role), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(Noir.ink)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The seats and case notes, slid in from the right over a table held
/// sideways. Tapping the table behind closes it.
private struct LandscapePanels: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    @Binding var showing: Bool

    var body: some View {
        ZStack(alignment: .trailing) {
            Color.black.opacity(0.35).ignoresSafeArea()
                .onTapGesture { showing = false }
            ScrollView {
                VStack(spacing: 14) {
                    SeatsPanel(store: store, payload: payload)
                    CaseNotes(payload: payload)
                }
                .padding(14)
            }
            .frame(width: 360)
            // Not up under the navigation bar: the title is centred on the
            // screen, and the panel's edge ran through it.
            .background(Noir.night.ignoresSafeArea(edges: [.bottom, .horizontal]))
            .overlay(alignment: .leading) { Rectangle().fill(Noir.line).frame(width: 1) }
        }
    }
}

/// Which step a tap in the hand is for: where to hide, or sprint cards.
private struct HidingSteps: View {
    let store: FugitiveStore

    var body: some View {
        HStack(spacing: 0) {
            step(.hideout, "1 · Hideout")
            step(.sprint, "2 · Sprint")
        }
        .padding(3)
        .background(Capsule().fill(Color.black.opacity(0.35)))
        .overlay(Capsule().strokeBorder(Noir.line))
        .animation(.easeOut(duration: 0.15), value: store.hiding.mode)
    }

    private func step(_ mode: FugitiveHiding.Mode, _ title: String) -> some View {
        let on = store.hiding.mode == mode
        return Button {
            store.switchHiding(to: mode)
        } label: {
            Text(title)
                .font(Noir.type(14))
                .foregroundStyle(on ? Noir.ink : Noir.card.opacity(0.8))
                .padding(.horizontal, 16).padding(.vertical, 7)
                .background(Capsule().fill(on ? (mode == .hideout ? Noir.fugitive : Noir.marshal) : .clear))
        }
        .buttonStyle(.plain)
        .disabled(mode == .sprint && store.pick == nil)
        .opacity(mode == .sprint && store.pick == nil ? 0.45 : 1)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct MarshalHint: View {
    let game: FugitiveGame

    var body: some View {
        if game.viewerRole == .marshal, game.turn == .marshal {
            switch game.phase {
            case .marshalDraw:
                ControlHint(text: "Tap a deck to draw\(game.drawsLeft == 2 ? " — two this turn" : "").")
            case .marshalGuess:
                ControlHint(text: "Circle a number on your notepad — or several, if you’re sure.")
            case .manhunt:
                ControlHint(text: "Manhunt — circle one number at a time on your notepad.")
            default:
                EmptyView()
            }
        }
    }
}

private struct ControlHint: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Noir.type(14))
            .foregroundStyle(Noir.card.opacity(0.9))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - beside the desk

private struct SidePanels: View {
    let store: FugitiveStore
    let payload: FugitivePayload

    var body: some View {
        VStack(spacing: 14) {
            if payload.game.viewerRole == .marshal { Notepad(store: store, payload: payload) }
            SeatsPanel(store: store, payload: payload)
            CaseNotes(payload: payload)
        }
    }
}

/// The Marshal's notepad: 1 to 41 on lined paper. Circle to guess; your
/// own cards and the sprints you've seen are struck through in pen, wrong
/// single guesses in pencil, finds circled green.
private struct Notepad: View {
    @Bindable var store: FugitiveStore
    let payload: FugitivePayload
    /// A phone held sideways: eleven to a row in smaller writing, so the
    /// page is four rows, and Guess is pinned under the column instead.
    var compact = false

    private struct Marks {
        var found: Set<Int> = []
        var struck: Set<Int> = []
        var missed: Set<Int> = []
        var possible: Set<Int>?
        /// Your own pencil.
        var mine: Set<Int> = []
    }

    var body: some View {
        let g = payload.game
        let guessing = GuessActions.shown(g)
        let marks = noted(g)
        VStack(alignment: .leading, spacing: compact ? 4 : 10) {
            HStack {
                // Sideways the row holds two switches, so the title gives way.
                if !compact {
                    Text("\(payload.name(.marshal))’s notes").font(Noir.hand(26)).foregroundStyle(Noir.pen)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Spacer(minLength: 6)
                }
                // Your own pencil: a tap crosses a number out, or clears it.
                Picker("A tap on the notepad", selection: $store.marking) {
                    Text(guessing ? "Guess" : "Look").tag(false)
                    Text("✎ Mark").tag(true)
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .controlSize(compact ? .mini : .small)
                .environment(\.colorScheme, .light)
                // Sideways there's no row to spare: the switch shares the title's.
                if compact, g.candidates != nil {
                    Spacer(minLength: 8)
                    Toggle("Pencil in", isOn: $store.assist)
                        .font(.caption).controlSize(.mini)
                        .tint(Noir.pen).foregroundStyle(Noir.ink)
                        .fixedSize()
                        .accessibilityLabel("Pencil in what each hideout could be")
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: compact ? 11 : 7), spacing: compact ? 0 : 2) {
                ForEach(1...41, id: \.self) { n in
                    number(n, marks: marks)
                        .disabled(marks.found.contains(n) || (!store.marking && (!guessing || store.busy || store.animating)))
                }
            }
            if guessing && !compact { GuessActions(store: store, payload: payload) }
            if !compact, g.candidates != nil {
                Toggle("Pencil in what each hideout could be", isOn: $store.assist)
                    .font(.footnote)
                    .tint(Noir.pen)
                    .foregroundStyle(Noir.ink)
            }
        }
        .padding(.leading, compact ? 22 : 26).padding([.trailing, .vertical], compact ? 8 : 14)
        .background(LinedPaper())
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
        .rotationEffect(.degrees(0.4))
    }

    private func number(_ n: Int, marks: Marks) -> some View {
        let found = marks.found.contains(n)
        let struck = marks.struck.contains(n)
        let missed = marks.missed.contains(n) && !found
        let mine = marks.mine.contains(n) && !found
        let faint = marks.possible.map { !$0.contains(n) && !found && !struck } ?? false
        let picked = store.guesses.contains(n)
        let inset: CGFloat = compact ? 2 : 5
        return Button { if store.marking { store.toggleMark(n) } else { store.toggleGuess(n) } } label: {
            Text("\(n)")
                .font(Noir.hand(compact ? 21 : 25))
                .foregroundStyle(found ? Noir.found : Noir.pen)
                .opacity(faint ? 0.28 : 1)
                .frame(maxWidth: .infinity, minHeight: compact ? 29 : 38)
                .overlay {
                    if struck {
                        Capsule().fill(Noir.pen).frame(height: 2.2).padding(.horizontal, inset + 3).rotationEffect(.degrees(-14))
                    } else if mine {
                        // Your own mark: pencil, the other way.
                        Capsule().fill(Color.gray).frame(height: 2).padding(.horizontal, inset + 3).rotationEffect(.degrees(18))
                    }
                }
                .overlay(alignment: .topTrailing) {
                    // A wrong single guess: a pencil tick, not a strike — it
                    // wasn't there then, but a later hideout could still be.
                    if missed {
                        Text("✓").font(Noir.hand(compact ? 11 : 13)).foregroundStyle(Color.gray)
                            .padding(.trailing, compact ? 0 : 2)
                    }
                }
                .overlay {
                    if picked {
                        Ellipse().stroke(Noir.miss, lineWidth: 2.2).padding(.horizontal, inset).padding(.vertical, 2)
                    } else if found {
                        Ellipse().stroke(Noir.found, lineWidth: 2).padding(.horizontal, inset).padding(.vertical, 2)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PaperPress())
        .accessibilityLabel(Self.label(n, found: found, struck: struck || mine, missed: missed))
        .accessibilityAddTraits(picked ? .isSelected : [])
    }

    private static func label(_ n: Int, found: Bool, struck: Bool, missed: Bool) -> String {
        if found { return "\(n), found" }
        if struck { return "\(n), ruled out" }
        if missed { return "\(n), guessed wrong" }
        return "\(n)"
    }

    private func noted(_ g: FugitiveGame) -> Marks {
        var marks = Marks()
        // Found cards are face up on the table, so they're circled either
        // way; your own pencil is yours. Everything else the app writes in
        // is a hint, and left off in a game without them.
        marks.found = Set(g.hideouts.filter(\.revealed).compactMap(\.card))
        marks.mine = store.marks
        guard payload.hintsOn else { return marks }
        marks.struck = Set(g.hand ?? [])
        for hideout in g.hideouts { marks.struck.formUnion(hideout.sprints ?? []) }
        for event in g.log where event.kind == "guessed" && event.hit != true {
            if let numbers = event.numbers, numbers.count == 1 { marks.missed.insert(numbers[0]) }
        }
        if store.assist, let sets = g.candidates {
            var possible = Set<Int>()
            for (i, set) in sets.enumerated() where g.hideouts.indices.contains(i) && !g.hideouts[i].revealed {
                possible.formUnion(set)
            }
            marks.possible = possible
        }
        return marks
    }
}

/// Guess, and in a Manhunt the way out: under the notepad, or pinned at the
/// foot of the right-hand column on a phone held sideways.
private struct GuessActions: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    /// Side by side, so a Manhunt's two buttons take one row.
    var compact = false
    @State private var confirmingLetGo = false

    static func shown(_ g: FugitiveGame) -> Bool {
        g.turn == .marshal && (g.phase == .marshalGuess || g.phase == .manhunt)
    }

    var body: some View {
        let numbers = store.guesses.sorted()
        let label = numbers.isEmpty ? "Circle a number"
            : numbers.count == 1 ? "Guess \(numbers[0])"
            : compact ? "Guess all \(numbers.count)" : "Guess all \(numbers.count) — every one must be right"
        let layout = compact ? AnyLayout(HStackLayout(spacing: 8)) : AnyLayout(VStackLayout(spacing: 8))
        layout {
            Button(label) { Task { await store.guess() } }
                .buttonStyle(NoirButtonStyle(fill: Noir.marshal))
                .disabled(numbers.isEmpty || store.busy || store.animating)
            if payload.game.phase == .manhunt {
                Button("Let them go") { confirmingLetGo = true }
                    .buttonStyle(NoirButtonStyle(fill: Noir.manila))
                    .disabled(store.busy || store.animating)
            }
        }
        .confirmationDialog("Let \(payload.name(.fugitive)) escape?", isPresented: $confirmingLetGo, titleVisibility: .visible) {
            Button("Let them go", role: .destructive) { Task { await store.letGo() } }
        }
    }
}

/// Paper with blue lines and a red margin.
private struct LinedPaper: View {
    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Noir.paper))
            var y: CGFloat = 40
            while y < size.height {
                context.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(Color(hex: 0x9DB8D9).opacity(0.55)))
                y += 26
            }
            context.fill(Path(CGRect(x: 16, y: 0, width: 1.5, height: size.height)), with: .color(Noir.miss.opacity(0.55)))
        }
    }
}

private struct SeatsPanel: View {
    let store: FugitiveStore
    let payload: FugitivePayload
    @State private var confirmingResign = false
    /// Opened by hand while it would otherwise be folded.
    @State private var opened = false

    var body: some View {
        let g = payload.game
        let open = FugitiveRole.allCases.contains { !payload.taken($0) }
        // Folded to one line once everyone's sitting and the game's going:
        // the whole panel is only wanted when someone joins, or at the end.
        if !open && !g.isOver && !opened {
            folded
        } else {
            full(g, open: open)
        }
    }

    /// Both faces and names on one line; a tap opens the panel.
    private var folded: some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { opened = true }
        } label: {
            HStack(spacing: 8) {
                Text("AT THE TABLE").font(Noir.type(12)).kerning(1.2).foregroundStyle(Noir.fugitive)
                Spacer(minLength: 4)
                ForEach(FugitiveRole.allCases) { role in
                    Mugshot(name: payload.name(role), role: role, size: 24)
                    Text(payload.name(role)).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                Image(systemName: "chevron.down").font(.caption.weight(.bold)).foregroundStyle(Noir.card.opacity(0.6))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Noir.panel.opacity(0.94), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Noir.line))
            .foregroundStyle(Noir.card)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("At the table: \(payload.name(.fugitive)) and \(payload.name(.marshal)). Show seats and Give up.")
    }

    private func full(_ g: FugitiveGame, open: Bool) -> some View {
        NoirPanel(title: "At the table") {
            if opened && !open && !g.isOver {
                Button("Fold away") { withAnimation(.easeOut(duration: 0.2)) { opened = false } }
                    .font(.footnote).buttonStyle(.plain).foregroundStyle(Noir.card.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            ForEach(FugitiveRole.allCases) { role in row(role) }
            if store.isDealer, open, !g.isOver,
               let qr = store.inviteURL.flatMap({ QRCode.image($0.absoluteString) }) {
                VStack(spacing: 8) {
                    Image(uiImage: qr).interpolation(.none).resizable()
                        .frame(width: 170, height: 170)
                        .padding(10)
                        .background(Noir.card, in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityLabel("QR code for game \(payload.code)")
                    if let url = store.inviteURL {
                        InviteLink(url: url, message: "Play Fugitive with me on Game Night — code \(payload.code)")
                            .buttonStyle(NoirButtonStyle(fill: nil))
                    }
                    Text("Scan to sit down, send the link, or enter \(payload.code) in the app or at /join.")
                        .font(.footnote).foregroundStyle(Noir.card.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
            }
            if store.isDealer, open, !g.isOver, store.inviteURL == nil {
                Text("No internet needed: on the other phone, open Fugitive and tap “Join a nearby game”.")
                    .font(.footnote).foregroundStyle(Noir.card.opacity(0.7))
            }
            if g.isOver {
                if store.isDealer {
                    Button("Rematch — swap roles") { Task { await store.rematch() } }
                        .buttonStyle(NoirButtonStyle(fill: Noir.fugitive))
                        .disabled(store.busy)
                } else {
                    Text("The device that dealt can start a rematch.").font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
                }
            } else if g.viewerRole != nil {
                Button("Give up") { confirmingResign = true }
                    .buttonStyle(NoirButtonStyle(fill: nil))
                    .disabled(store.busy || store.animating)
            } else if store.device.seats.isEmpty && !store.isDealer {
                Text("You’re watching. Take a free seat to play.").font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
            }
        }
        .confirmationDialog("Give up this game?", isPresented: $confirmingResign, titleVisibility: .visible) {
            Button("Give up", role: .destructive) { Task { await store.resign() } }
        } message: {
            Text("It counts as a win for the other side.")
        }
    }

    private func row(_ role: FugitiveRole) -> some View {
        let name = payload.name(role)
        let isMe = Faces.shared.me.map { Faces.fold($0.name) == Faces.fold(name) } ?? false
        return HStack(spacing: 10) {
            Mugshot(name: name, role: role, size: 36)
            VStack(alignment: .leading, spacing: 0) {
                Text(name).font(.body.weight(.bold))
                Text(role.title.uppercased()).font(Noir.type(11)).foregroundStyle(Noir.colour(role))
            }
            Spacer()
            if store.device.seat(role) != nil {
                Text("This device").font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
            } else if let computer = payload.computer, computer.role == role {
                // Its seat can't be freed: nobody could ever sit in it.
                Text(computer.label).font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
            } else if payload.taken(role) {
                if store.isDealer {
                    Button("Free seat") { Task { await store.free(role) } }
                        .buttonStyle(.bordered).controlSize(.small)
                } else {
                    Text("Seated").font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
                }
            } else if !payload.game.isOver {
                Button(isMe ? "That’s me — sit" : "Sit here") { Task { await store.sit(as: role) } }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .tint(Noir.colour(role))
                    .foregroundStyle(Noir.ink)
            }
        }
        .disabled(store.busy)
    }
}

private struct CaseNotes: View {
    let payload: FugitivePayload

    var body: some View {
        let lines = Array(payload.game.log.reversed().compactMap { fugitiveNote($0, in: payload) }.prefix(14))
        NoirPanel(title: "Case notes") {
            if lines.isEmpty {
                Text("Nothing yet — the Fugitive moves first.").font(.footnote).foregroundStyle(Noir.card.opacity(0.6))
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                Text(line)
                    .font(Noir.type(13))
                    .foregroundStyle(Noir.card.opacity(i == 0 ? 1 : 0.7))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct NoirPanel<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(Noir.type(14)).kerning(1.5).foregroundStyle(Noir.fugitive)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Noir.panel.opacity(0.94), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Noir.line))
        .foregroundStyle(Noir.card)
    }
}

// MARK: - over the desk

/// Pass-and-play: the device is changing hands, so the desk is covered
/// until the player whose turn it is opens the folder.
private struct FolderCurtain: View {
    let store: FugitiveStore
    let role: FugitiveRole
    let name: String

    var body: some View {
        ZStack {
            // Opaque: behind it may still be the last mover's hand.
            DeskBackground().ignoresSafeArea()
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) {
                Mugshot(name: name, role: role, size: 112)
                Text("For \(name)’s eyes only").font(Noir.poster(34)).multilineTextAlignment(.center)
                Text("The \(role.title)’s turn. Pass the device over, and tap when only \(name) can see it.")
                    .font(Noir.type(15)).multilineTextAlignment(.center)
                Button("I’m \(name) — open it") { store.openFolder() }
                    .buttonStyle(NoirButtonStyle(fill: Noir.colour(role)))
            }
            .foregroundStyle(Noir.ink)
            .padding(.horizontal, 24).padding(.top, 34).padding(.bottom, 24)
            .frame(maxWidth: 420)
            .background(Noir.manila, in: RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topLeading) {
                Text("CONFIDENTIAL")
                    .font(Noir.type(13)).kerning(2)
                    .foregroundStyle(Noir.miss)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Noir.miss, lineWidth: 1.5))
                    .rotationEffect(.degrees(-4))
                    .padding(12)
            }
            .shadow(color: .black.opacity(0.6), radius: 20, y: 10)
            .padding(24)
        }
        .transition(.opacity)
    }
}

/// The Manhunt: red and blue washing over the desk.
private struct SirenWash: View {
    @State private var red = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(colors: [Noir.miss.opacity(0.3), .clear, Noir.marshal.opacity(0.3)],
                           startPoint: .leading, endPoint: .trailing)
                .opacity(red ? 1 : 0)
            LinearGradient(colors: [Noir.marshal.opacity(0.3), .clear, Noir.miss.opacity(0.3)],
                           startPoint: .leading, endPoint: .trailing)
                .opacity(red ? 0 : 1)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { red = false }
        }
    }
}

/// The plane out at 42, taking off across the screen.
private struct PlaneAway: View {
    @State private var gone = false

    var body: some View {
        GeometryReader { geo in
            Image(systemName: "airplane")
                .font(.system(size: 58))
                .foregroundStyle(Noir.card)
                .shadow(color: Noir.fugitive.opacity(0.7), radius: 12)
                .rotationEffect(.degrees(-28))
                .scaleEffect(gone ? 0.45 : 1.3)
                .position(x: gone ? geo.size.width + 90 : -90, y: geo.size.height * (gone ? 0.12 : 0.78))
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear { withAnimation(.easeIn(duration: 1.35)) { gone = true } }
    }
}

/// A shake of the trail at a wrong guess.
private struct Shake: ViewModifier, Animatable {
    var phase: CGFloat

    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    func body(content: Content) -> some View {
        content.offset(x: 9 * sin(phase * .pi * 6))
    }
}

/// A button that's just its label, pressed down a touch — for cards and
/// numbers, which mustn't dim when they're not tappable.
struct PaperPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

private struct FugitiveGone: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NoirPanel(title: "Case closed") {
            Text("This game has ended or expired.").font(.headline)
            Button("Back") { dismiss() }.buttonStyle(NoirButtonStyle(fill: Noir.manila))
        }
        .padding(24)
        .frame(maxWidth: 420)
    }
}
