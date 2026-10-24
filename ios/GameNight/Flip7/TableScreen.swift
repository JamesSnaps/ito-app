import SwiftUI
import CoreImage.CIFilterBuiltins

/// A Flip 7 table, played with a deck you can see. On an iPad in landscape
/// the whole table is one screen: a grid of mats sized to the player count,
/// and a rail with the status, the deck, Stay and the log. Anywhere
/// narrower, your own mat and whoever's turn it is come first, and the deck
/// and Stay sit at the bottom where a thumb reaches them.
///
/// Drawing is done on the deck — tap it, or peel the top card up — and the
/// card flies to the player's mat, turning over on the way. The flying card
/// is drawn over everything, between frames the deck and the mats report.
struct TableScreen: View {
    @State var store: PlayStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingInvite = false
    @State private var deckFrame: CGRect = .zero
    @State private var matFrames: [Int: CGRect] = [:]
    @State private var deckWidth: CGFloat = 96
    @State private var matCardWidths: [Int: CGFloat] = [:]
    @State private var soundOn = Sound.enabled

    var body: some View {
        GeometryReader { geo in
            let wide = sizeClass == .regular && geo.size.width > geo.size.height
            ZStack {
                Theme.background
                if store.gone {
                    GoneView()
                } else if let game = store.game {
                    if wide {
                        WideTable(store: store, game: game, showingInvite: $showingInvite, size: geo.size)
                    } else {
                        CompactTable(store: store, game: game, showingInvite: $showingInvite)
                    }
                } else {
                    ProgressView("Shuffling up…").tint(Theme.cream).foregroundStyle(Theme.cream)
                }
                if let flight = store.flight {
                    FlyingCard(flight: flight, from: deckFrame,
                               to: matFrames[flight.player] ?? CGRect(x: geo.size.width / 2, y: geo.size.height / 2, width: 1, height: 1),
                               startWidth: deckWidth, endWidth: matCardWidths[flight.player] ?? 46)
                        .id(flight.id)
                }
                if let name = store.flip7Flash {
                    Flip7Flash(name: name)
                        .task {
                            try? await Task.sleep(for: .milliseconds(1500))
                            store.flip7Flash = nil
                        }
                }
            }
            .coordinateSpace(.named(TableSpace.name))
            .onPreferenceChange(DeckFrameKey.self) { deckFrame = $0.frame; deckWidth = $0.width }
            .onPreferenceChange(MatFramesKey.self) { frames in
                matFrames = frames.mapValues(\.frame)
                matCardWidths = frames.mapValues(\.width)
            }
        }
        .navigationTitle("Flip 7")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.feltDark, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    soundOn.toggle()
                    Sound.enabled = soundOn
                } label: {
                    Image(systemName: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                }
                .accessibilityLabel(soundOn ? "Sounds on" : "Sounds off")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Text(store.code)
                    .font(Theme.mono(14)).kerning(2.5)
                    .foregroundStyle(Theme.goldBright)
                    .accessibilityLabel("Room code \(store.code.map(String.init).joined(separator: " "))")
            }
        }
        .sheet(isPresented: Binding(get: { store.giveForMe != nil && !store.busy }, set: { _ in })) {
            if let pending = store.giveForMe { GiveSheet(store: store, pending: pending) }
        }
        .sheet(isPresented: $showingInvite) { InviteSheet(store: store) }
        .alert("Game over", isPresented: Binding(get: { store.announcement != nil },
                                                 set: { if !$0 { store.announcement = nil } })) {
            Button("Nice one", role: .cancel) {}
        } message: {
            Text(store.announcement ?? "")
        }
        .overlay(alignment: .bottom) {
            if let notice = store.notice {
                NoticeView(text: notice)
                    .padding(.bottom, 110)
                    .task {
                        try? await Task.sleep(for: .seconds(3.2))
                        if store.notice == notice { store.notice = nil }
                    }
            }
        }
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .keepsScreenAwake()
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.start() } else { store.stop() }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - where things are, for the flying card

enum TableSpace { static let name = "flip7-table" }

struct PlacedFrame: Equatable { var frame: CGRect; var width: CGFloat }

struct DeckFrameKey: PreferenceKey {
    static let defaultValue = PlacedFrame(frame: .zero, width: 96)
    static func reduce(value: inout PlacedFrame, nextValue: () -> PlacedFrame) {
        let next = nextValue()
        if next.frame != .zero { value = next }
    }
}

struct MatFramesKey: PreferenceKey {
    static let defaultValue: [Int: PlacedFrame] = [:]
    static func reduce(value: inout [Int: PlacedFrame], nextValue: () -> [Int: PlacedFrame]) {
        value.merge(nextValue()) { $1 }
    }
}

extension View {
    /// Reports this view's frame in the table's coordinate space.
    func reportsFrame<K: PreferenceKey>(_ key: K.Type, _ make: @escaping (CGRect) -> K.Value) -> some View {
        background(GeometryReader { proxy in
            Color.clear.preference(key: key, value: make(proxy.frame(in: .named(TableSpace.name))))
        })
    }
}

// MARK: - layouts

private struct WideTable: View {
    let store: PlayStore
    let game: Game
    @Binding var showingInvite: Bool
    let size: CGSize

    var body: some View {
        let railWidth = min(360, max(300, size.width * 0.27))
        HStack(alignment: .top, spacing: 24) {
            MatGrid(store: store, game: game)
            VStack(alignment: .leading, spacing: 18) {
                if store.offersSeat { SeatPicker(store: store) }
                StatusPanel(store: store, game: game)
                Spacer(minLength: 0)
                TableDeck(store: store, game: game, width: min(150, railWidth * 0.42))
                    .frame(maxWidth: .infinity)
                Controls(store: store, game: game, vertical: true)
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 8) {
                    Text(infoLine(game)).font(.caption).foregroundStyle(Theme.cream.opacity(0.55))
                    EventLog(game: game, limit: 5)
                }
                if store.hostToken != nil { InviteButton(store: store, showing: $showingInvite) }
            }
            .frame(width: railWidth)
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
    }
}

private struct CompactTable: View {
    let store: PlayStore
    let game: Game
    @Binding var showingInvite: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// You first, then whoever the table's waiting on, then everyone else in
    /// seat order.
    private var order: [Int] {
        let seats = Array(game.players.indices)
        let first = [store.mySeat, store.actingSeat].compactMap { $0 }
        var seen = Set<Int>()
        return (first + seats).filter { seen.insert($0).inserted }
    }

    var body: some View {
        // iPad portrait: two columns of mats, the acting one across the top.
        let columns = sizeClass == .regular ? 2 : 1
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if store.offersSeat { SeatPicker(store: store) }
                StatusPanel(store: store, game: game)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 12) {
                    ForEach(order, id: \.self) { i in
                        MatView(player: game.players[i], index: i, store: store, cardWidth: sizeClass == .regular ? 56 : 46)
                            .frame(minHeight: sizeClass == .regular ? 190 : 150)
                    }
                }
                Text(infoLine(game)).font(.caption).foregroundStyle(Theme.cream.opacity(0.55))
                EventLog(game: game, limit: 3)
                if store.hostToken != nil { InviteButton(store: store, showing: $showingInvite) }
            }
            .padding(16)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
            .animation(.default, value: order)
        }
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .center, spacing: 14) {
                Controls(store: store, game: game, vertical: false)
                if game.phase == .playing {
                    TableDeck(store: store, game: game, width: sizeClass == .regular ? 72 : 56, compact: true)
                }
            }
            .frame(maxWidth: 900)
            .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [Theme.feltDark.opacity(0), Theme.feltDark.opacity(0.96), Theme.feltDark],
                                       startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.35)))
        }
    }
}

/// The deck, wired to the table: its count includes cards still waiting to
/// be dealt, it riffles on a shuffle, and it's the way to hit when this
/// device may play the turn.
private struct TableDeck: View {
    let store: PlayStore
    let game: Game
    let width: CGFloat
    var compact = false

    var body: some View {
        let pending = game.pending
        let canDraw = !store.busy && !store.animating && game.phase == .playing
            && pending?.kind == .turn && pending.map { store.canAct($0.player) } == true
        VStack(spacing: compact ? 6 : 10) {
            DeckView(count: store.deckShown, shuffles: store.shuffles, canDraw: canDraw, width: width) {
                if let p = pending?.player { Task { await store.send(.hit, player: p) } }
            }
            .reportsFrame(DeckFrameKey.self) { PlacedFrame(frame: $0, width: width) }
            Text(canDraw ? (compact ? "Draw" : "Tap the deck, or drag a card up") : "\(store.deckShown) cards")
                .font(compact ? .caption2.weight(.bold) : .footnote.weight(.semibold))
                .foregroundStyle(canDraw ? Theme.goldBright : Theme.cream.opacity(0.5))
                .multilineTextAlignment(.center)
        }
    }
}

/// Mats in a grid shaped to the player count, each the same size, with card
/// sizes worked out from the mat — so twelve players still fit one screen.
private struct MatGrid: View {
    let store: PlayStore
    let game: Game

    private var shape: (cols: Int, rows: Int) {
        switch game.players.count {
        case ...3: (game.players.count, 1)
        case 4: (2, 2)
        case 5...6: (3, 2)
        case 7...8: (4, 2)
        case 9: (3, 3)
        default: (4, 3)
        }
    }

    var body: some View {
        GeometryReader { geo in
            let gap: CGFloat = 14
            let (cols, rows) = shape
            let w = (geo.size.width - gap * CGFloat(cols - 1)) / CGFloat(cols)
            let room = (geo.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows)
            // Bounded by width and height, so a big hand wraps into rows that
            // still fit the mat — and as big as that allows, because these are
            // the cards everyone round the table is reading.
            let card = min(max(min(w * 0.2, (room - 90) / 2.9), 34), 112)
            // No taller than two rows of those cards need: with two or three
            // players a full-height mat was mostly empty felt.
            let h = min(room, 100 + card * 3.1)
            let columns = Array(repeating: GridItem(.fixed(w), spacing: gap), count: cols)
            LazyVGrid(columns: columns, spacing: gap) {
                ForEach(game.players.indices, id: \.self) { i in
                    MatView(player: game.players[i], index: i, store: store, cardWidth: card)
                        .frame(width: w, height: h)
                }
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
    }
}

private func infoLine(_ game: Game) -> String {
    let dealer = game.players.indices.contains(game.dealer) ? game.players[game.dealer].name : "?"
    return "Round \(game.round) · \(dealer) dealt · \(game.deckCount) in the deck · \(game.discardCount) discarded"
}

// MARK: - pieces

private struct StatusPanel: View {
    let store: PlayStore
    let game: Game

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(head).font(Theme.display(26)).foregroundStyle(Theme.goldBright)
            if let sub { Text(sub).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75)) }
            if game.phase != .playing { RoundSummary(store: store, game: game).padding(.top, 8) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func name(_ i: Int) -> String { game.players[i].name }

    private var head: String {
        switch game.phase {
        case .gameOver:
            let names = game.winners.map(name)
            return names.count > 1 ? "\(names.joined(separator: " & ")) share it!" : "\(names.first ?? "?") wins!"
        case .roundOver:
            return "Round \(game.round) is over"
        case .playing:
            guard let pending = game.pending else { return "" }
            let mine = pending.player == store.mySeat
            if pending.kind == .give, let card = pending.card.flatMap(Card.init) {
                return "\(mine ? "You" : name(pending.player)) drew \(card.withArticle)"
            }
            return mine ? "Your turn" : "\(name(pending.player))’s turn"
        }
    }

    private var sub: String? {
        if game.phase != .playing {
            guard let last = game.lastRound else { return nil }
            if let p = last.flip7By { return "\(name(p)) flipped 7." }
            return last.exhausted ? "The deck ran out." : "Everyone’s stayed or bust."
        }
        guard let pending = game.pending else { return nil }
        if pending.kind == .give {
            return store.canAct(pending.player) ? "Who gets it?" : "Deciding who gets it…"
        }
        if !store.canAct(pending.player) {
            return store.takenByPhone(pending.player) ? "On their phone." : "On the dealer’s device."
        }
        let player = game.players[pending.player]
        return player.hand.isEmpty ? "No cards yet — hit to get one." : "Hit for another card, or stay on \(player.roundScore)."
    }
}

private struct RoundSummary: View {
    let store: PlayStore
    let game: Game

    var body: some View {
        let order = game.players.indices.sorted { game.players[$0].total > game.players[$1].total }
        VStack(spacing: 0) {
            ForEach(order, id: \.self) { i in
                let player = game.players[i]
                let last = player.rounds.last
                HStack {
                    Text(player.name).font(.body.weight(.bold))
                        .foregroundStyle(i == store.mySeat ? Theme.goldBright : Theme.cream)
                    Spacer()
                    Text(last.map { $0.bust ? "bust" : "+\($0.score)" } ?? "")
                        .font(Theme.mono(15))
                        .foregroundStyle(last?.bust == true ? Color(hex: 0xF3A08C) : last?.flip7 == true ? Theme.goldBright : Theme.green)
                    Text("\(player.total)").font(Theme.mono(17))
                        .foregroundStyle(player.total >= game.target ? Theme.green : Theme.goldBright)
                        .frame(minWidth: 48, alignment: .trailing)
                }
                .padding(.vertical, 6)
                Divider().overlay(Theme.line)
            }
        }
    }
}

private struct EventLog: View {
    let game: Game
    let limit: Int

    var body: some View {
        let names = game.players.map(\.name)
        let lines = game.log.suffix(limit + 4).reversed().compactMap { event in
            event.describe(names: names).map { (event.id, $0) }
        }.prefix(limit)
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.element.0) { offset, line in
                Text(line.1)
                    .font(.footnote.weight(offset == 0 ? .semibold : .regular))
                    .foregroundStyle(Theme.cream.opacity(offset == 0 ? 1 : 0.5))
            }
        }
    }
}

/// Stay, and the between-rounds buttons. Hitting is done on the deck.
private struct Controls: View {
    let store: PlayStore
    let game: Game
    let vertical: Bool

    var body: some View {
        let pending = game.pending
        Group {
            if store.mode == .watch {
                note("Watching — moves are made at the table.")
            } else if store.animating {
                note(" ")
            } else if game.phase == .roundOver {
                Button {
                    Task { await store.send(.nextRound, player: store.mySeat) }
                } label: {
                    Label("Deal round \(game.round + 1)", systemImage: "arrow.right")
                }
                .buttonStyle(FeltButtonStyle(big: true))
            } else if game.phase == .gameOver {
                if store.hostToken != nil {
                    Button("New game, same players") { Task { await store.rematch() } }
                        .buttonStyle(FeltButtonStyle(big: true))
                } else {
                    note("If the dealer starts another game, this phone follows.")
                }
            } else if let pending, store.canAct(pending.player) {
                if pending.kind == .turn {
                    stayButton(pending.player)
                } else {
                    note("Choose who gets the \(pending.card.flatMap(Card.init)?.name ?? "card").")
                }
            } else if let pending {
                VStack(spacing: 8) {
                    note("Waiting for \(game.players[pending.player].name)…")
                    // The dealer's device can always step in — a phone that's
                    // gone to sleep shouldn't hold up the table.
                    if store.hostToken != nil {
                        Button("Play \(game.players[pending.player].name)’s turn") {
                            store.actingFor = pending.player
                        }
                        .buttonStyle(FeltButtonStyle(kind: .ghost))
                    }
                }
            }
        }
        .disabled(store.busy)
        .frame(maxWidth: vertical ? .infinity : nil)
    }

    private func stayButton(_ p: Int) -> some View {
        let player = game.players[p]
        let covering = p == store.actingFor || (store.mode == .player && p != store.mySeat)
        return Button {
            Task { await store.send(.stay, player: p) }
        } label: {
            Label(covering ? "Stay for \(player.name)" : "Stay on \(player.roundScore)", systemImage: "hand.raised.fill")
        }
        .buttonStyle(FeltButtonStyle(kind: .ghost, big: true))
        .disabled(player.hand.isEmpty)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.6))
            .multilineTextAlignment(.center).frame(maxWidth: .infinity)
    }
}

/// Offered to anyone watching while there's still a seat free.
private struct SeatPicker: View {
    let store: PlayStore

    var body: some View {
        Panel(title: "Which one are you?") {
            Text("Tap your name to play your own turns from this device.")
                .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.7))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                ForEach(store.game?.players.indices ?? 0..<0, id: \.self) { i in
                    let taken = store.seats.indices.contains(i) && store.seats[i].taken
                    Button {
                        Task { await store.sit(at: i) }
                    } label: {
                        VStack(spacing: 2) {
                            Text(store.game?.players[i].name ?? "")
                            if taken { Text("taken").font(.caption2) }
                        }
                    }
                    .buttonStyle(FeltButtonStyle(kind: .ghost))
                    .disabled(taken || store.busy)
                }
            }
            Button("Just watching") { store.justWatching = true }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.cream.opacity(0.7))
        }
    }
}

private struct InviteButton: View {
    let store: PlayStore
    @Binding var showing: Bool

    var body: some View {
        let seated = store.seats.filter(\.taken).count
        Button {
            showing = true
        } label: {
            Label(seated > 0 ? "Phones · \(seated) of \(store.seats.count) seated" : "Play on your own phones",
                  systemImage: "iphone")
                .font(.subheadline.weight(.bold))
        }
        .buttonStyle(FeltButtonStyle(kind: .ghost))
    }
}

// MARK: - sheets

/// Handing out an action card. No cancel: the rules say it has to go to
/// someone, so the only way out is to pick.
private struct GiveSheet: View {
    let store: PlayStore
    let pending: Pending

    var body: some View {
        let card = pending.card.flatMap(Card.init) ?? .freeze
        let game = store.game
        let chooser = pending.player == store.mySeat ? "You" : game?.players[pending.player].name ?? "?"
        ScrollView {
            VStack(spacing: 14) {
                CardView(card: card, width: 64).padding(.top, 24)
                Text("\(chooser) drew \(card.withArticle)")
                    .font(Theme.display(24)).foregroundStyle(Theme.goldBright)
                    .multilineTextAlignment(.center)
                Text(card.giveExplanation).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.8))
                    .multilineTextAlignment(.center)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(pending.options ?? [], id: \.self) { i in
                        if let player = game?.players[i] {
                            Button {
                                Task { await store.send(.give, player: pending.player, target: i) }
                            } label: {
                                VStack(spacing: 4) {
                                    Text(i == pending.player ? "\(i == store.mySeat ? "Me" : player.name) (keep it)" : player.name)
                                    Text("\(player.total) banked · \(player.hand.numbers.count)/7 · +\(player.roundScore)")
                                        .font(Theme.mono(11, weight: .regular)).opacity(0.65)
                                }
                            }
                            .buttonStyle(FeltButtonStyle(kind: .ghost))
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.felt)
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled()
        .preferredColorScheme(.dark)
    }
}

/// The dealer's view of the phones: a QR into the game (it opens the web
/// table, so phones without the app can join too) and who's sitting where.
private struct InviteSheet: View {
    let store: PlayStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let qr = qrImage(AppSettings.client.tableURL(code: store.code).absoluteString) {
                        Image(uiImage: qr).interpolation(.none).resizable()
                            .frame(width: 180, height: 180)
                            .padding(10)
                            .background(Theme.cream, in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("QR code for game \(store.code)")
                    }
                    Text(store.code).font(Theme.mono(30)).kerning(6).foregroundStyle(Theme.goldBright)
                    Text("Scan it, or enter the code in the app or at /join, then tap your name. Seats left at the table are played from here.")
                        .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                        .multilineTextAlignment(.center)
                    VStack(spacing: 0) {
                        ForEach(store.game?.players.indices ?? 0..<0, id: \.self) { i in
                            seatRow(i)
                            Divider().overlay(Theme.line)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.felt)
            .navigationTitle("Play on your phones")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .preferredColorScheme(.dark)
    }

    private func seatRow(_ i: Int) -> some View {
        let taken = store.seats.indices.contains(i) && store.seats[i].taken
        let mine = i == store.mySeat
        return HStack {
            Text(store.game?.players[i].name ?? "").font(.body.weight(.bold))
            Spacer()
            Text(mine ? "this device" : taken ? "on their phone" : "at the table")
                .font(.footnote).foregroundStyle(Theme.cream.opacity(0.6))
            if taken {
                Button(mine ? "Leave" : "Free seat") { Task { await store.free(seat: i) } }
                    .buttonStyle(.bordered).controlSize(.small)
            } else if store.mySeat == nil {
                Button("That’s me") { Task { await store.sit(at: i) } }
                    .buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.vertical, 8)
        .disabled(store.busy)
    }

    private func qrImage(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        guard let output = filter.outputImage,
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

private struct GoneView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Panel {
            Text("This game has ended or expired.").font(.headline)
            Button("Back") { dismiss() }.buttonStyle(FeltButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: 420)
    }
}

struct NoticeView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.bold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Theme.cream, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(Theme.ink)
            .shadow(color: .black.opacity(0.45), radius: 15, y: 10)
            .padding(.horizontal, 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
