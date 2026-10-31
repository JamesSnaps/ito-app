import SwiftUI

/// The table: everyone else across the top, the draw pile and the pile in
/// the middle, your hand at the bottom — play.html's table, in the app.
/// On an iPad the seats and the log sit in a column beside it.
struct WildwoodTableScreen: View {
    @State var store: WildwoodStore
    @State private var choosingColourFor: String?
    @State private var showingCode = false
    @State private var webPage: WebPage?
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ZStack {
            Woods.backdrop
            if store.gone {
                WoodPanel {
                    Text("This game has ended or expired.").font(.headline)
                }
                .padding(24).frame(maxWidth: 420)
            } else if let payload = store.payload {
                content(payload)
            } else {
                ProgressView().tint(Woods.cream)
            }
            if let seat = store.curtainFor, let payload = store.payload {
                curtain(payload, seat: seat).transition(.opacity)
            }
            if let burst = store.burst {
                BurstView(burst: burst).allowsHitTesting(false).transition(.scale.combined(with: .opacity))
            }
        }
        .foregroundStyle(Woods.cream)
        .navigationTitle(store.game?.myTurn == true ? "● Your turn" : store.inviteURL == nil ? "Wildwood · offline" : "Wildwood")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Woods.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if let url = store.inviteURL {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingCode = true } label: { Image(systemName: "qrcode") }
                        .accessibilityLabel("Room code \(store.code)")
                        .sheet(isPresented: $showingCode) { WildwoodCodeSheet(code: store.code, url: url) }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { webPage = WebPage(url: AppSettings.client.webURL("/wildwood/rules")) } label: {
                    Image(systemName: "questionmark.circle")
                }
                .accessibilityLabel("Rules")
            }
        }
        .sheet(item: $webPage) { page in SafariView(url: page.url).ignoresSafeArea() }
        .sheet(item: Binding(get: { choosingColourFor.map(Choice.init) }, set: { choosingColourFor = $0?.card })) { choice in
            ColourPicker { colour in
                choosingColourFor = nil
                Task { await store.play(choice.card, colour: colour) }
            }
            .presentationDetents([.height(340)])
            .preferredColorScheme(.dark)
        }
        .alert("Wildwood", isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(store.notice ?? "") }
        .keepsScreenAwake()
        .reconnecting(store.connection)
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .animation(.easeInOut(duration: 0.2), value: store.curtainFor)
        // An offline game that just ended goes home as soon as there's signal.
        .onChange(of: store.game?.isOver) { _, over in
            if over == true && store.inviteURL == nil { Task { await WildwoodOfflineUploads.sendWaiting() } }
        }
    }

    private struct Choice: Identifiable { let card: String; var id: String { card } }

    // MARK: - layout

    @ViewBuilder private func content(_ payload: WildwoodPayload) -> some View {
        if sizeClass == .regular {
            HStack(alignment: .top, spacing: 20) {
                ScrollView { VStack(spacing: 14) { main(payload) }.padding(20) }
                ScrollView { VStack(spacing: 14) { side(payload) }.padding(.vertical, 20).padding(.trailing, 20) }
                    .frame(width: 320)
                    .scrollBounceBehavior(.basedOnSize)
            }
        } else {
            ScrollView {
                VStack(spacing: 14) {
                    main(payload)
                    side(payload)
                }
                .padding(16)
            }
        }
    }

    @ViewBuilder private func main(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        if game.isOver { gameOver(payload) }
        VStack(spacing: 14) {
            others(payload)
            piles(payload)
            status(payload)
            actions(payload)
            if game.mySeat != nil { hand(payload) }
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [Woods.ground, Woods.groundDark], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 26))
        .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(Woods.line))
    }

    // MARK: - everyone else

    private func others(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        let seats = (0..<payload.players.count).filter { $0 != game.mySeat }
        return HStack(spacing: 10) {
            ForEach(seats, id: \.self) { seat in
                SeatChip(payload: payload, seat: seat, count: store.shownCount(seat),
                         shaking: store.skipped == seat)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - the piles

    private func piles(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        let canDraw = game.myTurn && game.stack == 0 && !game.deciding && !store.animating
        let width: CGFloat = sizeClass == .regular ? 104 : 84
        let top = store.shownTop ?? game.top
        let colour = store.shownColour ?? game.colour
        return HStack(spacing: 22) {
            VStack(spacing: 6) {
                Button { Task { await store.draw() } } label: {
                    ZStack {
                        ForEach(0..<3, id: \.self) { k in
                            WildwoodCardView(card: nil, width: width).offset(y: CGFloat(-k) * 2)
                        }
                    }
                    .shadow(color: canDraw ? Woods.call.opacity(0.8) : .clear, radius: 10)
                }
                .buttonStyle(.plain)
                .disabled(!canDraw || store.busy)
                .accessibilityLabel(canDraw ? "Draw a card" : "Draw pile, \(game.drawCount) cards")
                Text(canDraw ? "Tap to draw" : "\(game.drawCount) left").font(.caption.weight(.semibold))
                    .foregroundStyle(Woods.cream.opacity(0.7))
            }
            VStack(spacing: 4) {
                Image(systemName: game.direction > 0 ? "arrow.clockwise" : "arrow.counterclockwise")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Woods.cream.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
                if game.stack > 0 {
                    Text("+\(game.stack)").font(Woods.display(18)).foregroundStyle(Woods.call)
                }
            }
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: width * 0.16)
                        .strokeBorder(Woods.colour(colour), lineWidth: 5)
                        .frame(width: width + 16, height: width * 1.4 + 16)
                    WildwoodCardView(card: top, width: width)
                        .id(store.landings)
                        .transition(.asymmetric(
                            insertion: .offset(y: store.playedFrom == game.mySeat ? 160 : -160)
                                .combined(with: .scale(scale: 0.7)).combined(with: .opacity),
                            removal: .opacity))
                }
                Text("\(WildwoodCard.colourName(colour)) to play").font(.caption.weight(.semibold))
                    .foregroundStyle(Woods.cream.opacity(0.7))
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("On the pile: \(WildwoodCard.label(top)). \(WildwoodCard.colourName(colour)) to play.")
        }
        .padding(.vertical, 8)
    }

    // MARK: - what to do

    private func status(_ payload: WildwoodPayload) -> some View {
        let (line, detail) = statusText(payload)
        return VStack(spacing: 2) {
            Text(line).font(Woods.display(20))
            if let detail { Text(detail).font(.subheadline.weight(.semibold)).foregroundStyle(Woods.cream.opacity(0.7)) }
        }
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
    }

    private func statusText(_ payload: WildwoodPayload) -> (String, String?) {
        let game = payload.game
        if game.isOver, let winner = game.winner { return ("\(payload.name(winner)) wins!", nil) }
        let colour = WildwoodCard.colourName(game.colour)
        let symbol = WildwoodCard.symbol(game.top)
        let what = WildwoodCard.isWild(game.top) ? colour : "\(colour) or \(WildwoodCard.actionNames[symbol] ?? symbol)"
        if game.myTurn {
            if game.stack > 0 {
                return WildwoodCard.symbol(game.top) == "D" && !game.playable.isEmpty
                    ? ("Play a Draw two, or take \(game.stack)", "+\(game.stack) is waiting for you")
                    : ("Take \(game.stack) cards", game.top == "W4" ? "A Bear can’t be stacked" : "No Draw two to pass it on")
            }
            if game.deciding, let drawn = game.drawn { return ("You drew \(WildwoodCard.label(drawn))", "Play it now, or keep it") }
            if !game.playable.isEmpty { return ("Your turn", "Match \(what)") }
            return ("Nothing fits", "Draw a card")
        }
        guard let turn = game.turn else { return ("", nil) }
        if game.stack > 0 { return ("\(payload.name(turn)) has +\(game.stack) coming", nil) }
        return ("\(payload.name(turn))’s turn", payload.isComputer(turn) ? "Thinking…" : "Match \(what)")
    }

    @ViewBuilder private func actions(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        let ready = !store.busy && !store.animating
        HStack(spacing: 10) {
            if let me = game.mySeat, game.exposed == me {
                Button("Last card!") { Task { await store.call() } }
                    .buttonStyle(WoodButtonStyle(kind: .call, big: true))
            } else if game.myTurn, game.hand?.count == 2, !game.playable.isEmpty {
                Button(store.armed ? "Last card! ✓" : "Last card!") { store.toggleArmed() }
                    .buttonStyle(WoodButtonStyle(kind: store.armed ? .plain : .call, big: true))
                    .accessibilityAddTraits(store.armed ? .isSelected : [])
            }
            if game.myTurn && game.stack > 0 {
                Button("Take \(game.stack)") { Task { await store.take() } }.buttonStyle(WoodButtonStyle(kind: .go))
            }
            if game.myTurn && game.deciding {
                Button("Keep it") { Task { await store.keep() } }.buttonStyle(WoodButtonStyle())
            }
            if game.myTurn && game.stack == 0 && !game.deciding {
                Button("Draw a card") { Task { await store.draw() } }.buttonStyle(WoodButtonStyle())
            }
        }
        .disabled(!ready)
        if store.catcher != nil, let exposed = game.exposed {
            Button("Caught! \(payload.name(exposed)) forgot") { Task { await store.catchForgotten() } }
                .buttonStyle(WoodButtonStyle(kind: .caught))
                .disabled(!ready)
        }
    }

    // MARK: - your hand

    private func hand(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        let cards = store.shownHand
        let width: CGFloat = sizeClass == .regular ? 88 : 66
        let live = game.myTurn && !store.animating && !store.busy
        return VStack(spacing: 8) {
            if let me = game.mySeat {
                HStack(spacing: 8) {
                    WildwoodFace(name: payload.name(me), computer: false, size: 28)
                    Text("\(payload.name(me)) · \(cards.count) card\(cards.count == 1 ? "" : "s")").font(Woods.display(16, weight: .bold))
                }
            }
            GeometryReader { geo in
                let room = geo.size.width
                let n = CGFloat(max(cards.count, 1))
                let spacing = n * (width + 4) > room ? max(-width * 0.72, (room - width) / max(1, n - 1) - width) : 4
                HStack(spacing: spacing) {
                    ForEach(Array(cards.enumerated()), id: \.offset) { _, card in
                        let can = live && game.playable.contains(card)
                        Button {
                            if WildwoodCard.isWild(card) { choosingColourFor = card } else { Task { await store.play(card) } }
                        } label: {
                            WildwoodCardView(card: card, width: width)
                                .saturation(game.myTurn && !can ? 0.4 : 1)
                                .brightness(game.myTurn && !can ? -0.25 : 0)
                                .shadow(color: can ? Woods.call.opacity(0.85) : .clear, radius: 8)
                                .offset(y: can ? -12 : 0)
                        }
                        .buttonStyle(.plain)
                        .disabled(!can)
                        .accessibilityLabel(WildwoodCard.label(card) + (can ? ", playable" : ""))
                        .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
                .frame(width: room, height: geo.size.height, alignment: .center)
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: cards)
            }
            .frame(height: width * 1.4 + 18)
        }
    }

    // MARK: - the side: seats and the log

    @ViewBuilder private func side(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        WoodPanel(title: "At the table") {
            ForEach(payload.players.indices, id: \.self) { seat in seatRow(payload, seat) }
            let open = payload.seats.indices.contains { !payload.seats[$0].taken && !payload.isComputer($0) }
            if store.isDealer, open, !game.isOver, store.inviteURL == nil {
                Text("No internet needed: on the other phones, open Wildwood and tap “Join a nearby game”, then sit down.")
                    .font(.footnote).foregroundStyle(Woods.cream.opacity(0.7))
            }
            if store.isDealer, open, !game.isOver, let url = store.inviteURL {
                VStack(spacing: 8) {
                    if let qr = QRCode.image(url.absoluteString) {
                        Image(uiImage: qr).interpolation(.none).resizable()
                            .frame(width: 160, height: 160).padding(10)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("QR code for game \(payload.code)")
                    }
                    InviteLink(url: url, message: "Play Wildwood with me on Game Night — code \(payload.code)")
                        .buttonStyle(WoodButtonStyle(kind: .quiet))
                    Text("Scan to sit down, send the link, or enter \(payload.code) in the app or at /join.")
                        .font(.footnote).foregroundStyle(Woods.cream.opacity(0.7)).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
            }
        }
        WoodPanel(title: "What happened") {
            ForEach(Array(game.log.suffix(8).reversed())) { event in
                if let line = logLine(payload, event) {
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 3).fill(event.colour.map(Woods.colour) ?? .clear).frame(width: 10, height: 10)
                        Text(line).font(.footnote)
                    }
                    .foregroundStyle(Woods.cream.opacity(event.id == game.log.last?.id ? 1 : 0.65))
                }
            }
        }
    }

    private func seatRow(_ payload: WildwoodPayload, _ seat: Int) -> some View {
        let taken = payload.taken(seat)
        let mine = store.device.seat(seat) != nil
        let name = payload.name(seat)
        return HStack(spacing: 10) {
            WildwoodFace(name: name, computer: payload.isComputer(seat), size: 32)
            Text(name).font(.body.weight(.bold))
            Spacer()
            if payload.isComputer(seat) {
                Text("Computer · \(payload.computer?.levelTitle ?? "")").font(.footnote).foregroundStyle(Woods.cream.opacity(0.6))
            } else if taken, store.isDealer, !payload.game.isOver {
                Button(mine ? "Leave" : "Free seat") { Task { await store.free(seat) } }
                    .buttonStyle(.bordered).controlSize(.small)
            } else if taken {
                Text(mine ? "This device" : "Seated").font(.footnote).foregroundStyle(Woods.cream.opacity(0.6))
            } else {
                let isMe = Faces.shared.me.map { Faces.fold($0.name) == Faces.fold(name) } ?? false
                Button(isMe ? "That’s me — sit" : "Sit here") { Task { await store.sit(at: seat) } }
                    .buttonStyle(.borderedProminent).tint(Woods.accent).controlSize(.small)
            }
        }
        .disabled(store.busy)
    }

    private func logLine(_ payload: WildwoodPayload, _ e: WildwoodEvent) -> String? {
        let who: (Int?) -> String = { seat in
            guard let seat else { return "" }
            return seat == payload.game.mySeat ? "You" : payload.name(seat)
        }
        switch e.kind {
        case "play":
            guard let card = e.card else { return nil }
            let colour = WildwoodCard.isWild(card) ? " → \(WildwoodCard.colourName(e.colour ?? ""))" : ""
            return "\(who(e.seat)) played \(WildwoodCard.label(card))\(colour)\(e.called == true ? " · Last card!" : "")"
        case "draw":
            return "\(who(e.seat)) \(e.reason == "take" ? "took" : "drew") \(e.count ?? 0)\(e.reason == "caught" ? " (caught!)" : "")"
        case "skip": return "\(who(e.seat)) missed a go"
        case "reverse": return "Round the other way"
        case "keep": return "\(who(e.seat)) kept the card"
        case "call": return "\(who(e.seat)): Last card!"
        case "catch": return "\(who(e.by)) caught \(who(e.seat))"
        case "reshuffle": return "The pile was shuffled"
        case "deal": return "Dealt — \(who(e.first)) first"
        case "game_over": return "\(who(e.winner)) won"
        default: return nil
        }
    }

    // MARK: - the end, and pass-and-play

    private func gameOver(_ payload: WildwoodPayload) -> some View {
        let game = payload.game
        return VStack(spacing: 12) {
            if let winner = game.winner {
                WildwoodFace(name: payload.name(winner), computer: payload.isComputer(winner), size: 64)
                Text(winner == game.mySeat ? "You win!" : "\(payload.name(winner)) wins!").font(Woods.display(28))
            }
            if let hands = game.hands {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(hands.indices, id: \.self) { seat in
                        HStack(spacing: 8) {
                            WildwoodFace(name: payload.name(seat), computer: payload.isComputer(seat), size: 26)
                            Text(payload.name(seat)).font(.subheadline.weight(.bold)).frame(width: 90, alignment: .leading)
                            if hands[seat].isEmpty {
                                Text("Out!").font(.caption.weight(.heavy)).padding(.horizontal, 8).padding(.vertical, 2)
                                    .background(Woods.call, in: Capsule()).foregroundStyle(Woods.ink)
                            }
                            HStack(spacing: -14) {
                                ForEach(Array(hands[seat].enumerated()), id: \.offset) { _, card in
                                    WildwoodCardView(card: card, width: 32)
                                }
                            }
                        }
                    }
                }
            }
            if store.isDealer {
                Button("Play again") { Task { await store.rematch() } }
                    .buttonStyle(WoodButtonStyle(kind: .go, big: true))
                    .disabled(store.busy)
            } else {
                Text("The device that dealt can start another game.").font(.footnote).foregroundStyle(Woods.cream.opacity(0.65))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(Woods.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Woods.accent, lineWidth: 2))
    }

    private func curtain(_ payload: WildwoodPayload, seat: Int) -> some View {
        ZStack {
            RadialGradient(colors: [Woods.ground, Color(hex: 0x10231A)], center: .top, startRadius: 0, endRadius: 700)
                .ignoresSafeArea()
            VStack(spacing: 16) {
                WildwoodFace(name: payload.name(seat), computer: false, size: 96)
                Text("Pass to \(payload.name(seat))").font(Woods.display(32))
                Text("Everyone else, look away.").foregroundStyle(Woods.cream.opacity(0.7))
                Button("I’m \(payload.name(seat)) — show my cards") { store.openCurtain() }
                    .buttonStyle(WoodButtonStyle(kind: .go, big: true))
                if let exposed = payload.game.exposed, exposed != seat {
                    Button("Caught! \(payload.name(exposed)) forgot") { Task { await store.catchForgotten() } }
                        .buttonStyle(WoodButtonStyle(kind: .caught))
                }
            }
            .padding(28)
            .frame(maxWidth: 420)
        }
    }
}

// MARK: - pieces

/// Someone else at the table: their face, name, a fan of backs, and how
/// many cards they hold.
private struct SeatChip: View {
    let payload: WildwoodPayload
    let seat: Int
    let count: Int
    let shaking: Bool

    var body: some View {
        let game = payload.game
        let turn = game.turn == seat
        VStack(spacing: 4) {
            WildwoodFace(name: payload.name(seat), computer: payload.isComputer(seat), size: 40)
            Text(payload.name(seat)).font(Woods.display(15)).lineLimit(1)
            HStack(spacing: -13) {
                ForEach(0..<min(count, 8), id: \.self) { _ in WildwoodCardView(card: nil, width: 20) }
            }
            .frame(height: 30)
            Text("\(count) card\(count == 1 ? "" : "s")").font(.caption.weight(.bold)).foregroundStyle(Woods.cream.opacity(0.7))
            if game.exposed == seat {
                Text("Forgot!").font(.caption2.weight(.heavy)).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Woods.caught, in: Capsule()).foregroundStyle(Woods.ink)
            } else if count == 1 {
                Text("Last card").font(.caption2.weight(.heavy)).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Woods.call, in: Capsule()).foregroundStyle(Woods.ink)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(minWidth: 84)
        .background(turn ? Woods.accent.opacity(0.16) : Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(turn ? Woods.accent : .clear, lineWidth: 2))
        .offset(x: shaking ? 6 : 0)
        .animation(shaking ? .easeInOut(duration: 0.08).repeatCount(4, autoreverses: true) : .default, value: shaking)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(payload.name(seat)), \(count) card\(count == 1 ? "" : "s")\(turn ? ", their turn" : "")")
    }
}

/// A word across the table: LAST CARD!, CAUGHT!, a winner.
private struct BurstView: View {
    let burst: WildwoodStore.Burst

    var body: some View {
        Text(burst.text)
            .font(Woods.display(burst.kind == .plain ? 28 : 34))
            .padding(.horizontal, 26).padding(.vertical, 14)
            .foregroundStyle(Woods.ink)
            .background(fill, in: RoundedRectangle(cornerRadius: 22))
            .shadow(color: .black.opacity(0.4), radius: 14, y: 8)
            .rotationEffect(.degrees(-4))
            .accessibilityAddTraits(.updatesFrequently)
    }

    private var fill: Color {
        switch burst.kind {
        case .call: Woods.call
        case .caught: Woods.caught
        case .win: Woods.accent
        case .plain: Woods.cream
        }
    }
}

/// A wild's colour: four big buttons, each with its colour's animal.
private struct ColourPicker: View {
    let pick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 14) {
            Text("Pick a colour").font(Woods.display(22)).foregroundStyle(Woods.cream)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(WildwoodCard.colours, id: \.self) { colour in
                    Button { pick(colour) } label: {
                        VStack(spacing: 4) {
                            Text(WildwoodCard.animals[colour] ?? "").font(.subheadline.weight(.bold))
                            Text(WildwoodCard.colourName(colour).capitalized).font(Woods.display(20))
                        }
                        .frame(maxWidth: .infinity, minHeight: 84)
                        .foregroundStyle(colour == "y" ? Woods.ink : .white)
                        .background(Woods.colour(colour), in: RoundedRectangle(cornerRadius: 18))
                    }
                    .buttonStyle(.plain)
                }
            }
            Button("Not this card") { dismiss() }.buttonStyle(WoodButtonStyle(kind: .quiet))
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Woods.panel.ignoresSafeArea())
    }
}

/// The room's code, big, and its invite QR: what the toolbar's QR icon opens.
private struct WildwoodCodeSheet: View {
    let code: String
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 18) {
            Text("ROOM CODE").font(Woods.display(14)).kerning(2).foregroundStyle(Woods.cream.opacity(0.7))
            Text(code).font(Woods.display(60)).kerning(8).foregroundStyle(Woods.accent)
                .accessibilityLabel(code.map(String.init).joined(separator: " "))
            if let qr = QRCode.image(url.absoluteString) {
                Image(uiImage: qr).interpolation(.none).resizable()
                    .frame(width: 200, height: 200).padding(12)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel("QR code for game \(code)")
            }
            Text("Scan to sit down, send the link, or enter the code under “Join with a code”.")
                .font(.footnote).foregroundStyle(Woods.cream.opacity(0.75)).multilineTextAlignment(.center)
            InviteLink(url: url, message: "Play Wildwood with me on Game Night — code \(code)")
                .buttonStyle(WoodButtonStyle(kind: .go))
            Button("Done") { dismiss() }.buttonStyle(WoodButtonStyle(kind: .quiet))
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Woods.background.ignoresSafeArea())
        .presentationDetents([.large])
        .preferredColorScheme(.dark)
    }
}
