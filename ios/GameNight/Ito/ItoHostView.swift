import SwiftUI

/// ito's host screen, native — the web's host page with the same rules
/// (`ItoHostStore`): the dealt card, what to draw from, the deck, and the
/// result asked for when you go for the next card. The table's phones watch
/// on `ItoDisplayView` or the web's display; the invite QR opens the web one,
/// so a phone without the app can still see the topic.
struct ItoHostView: View {
    @State private var store: ItoHostStore
    @State private var inviting = false
    @State private var confirmingReset = false
    @State private var webPage: WebPage?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// `code` nil starts a new room.
    init(code: String?) {
        _store = State(initialValue: ItoHostStore(code: code))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Ito.background.ignoresSafeArea()
                if store.closed {
                    closed
                } else if let code = store.code, store.token == nil {
                    // A room this device didn't start: it can only watch.
                    ItoDisplayView(code: code)
                } else {
                    table(in: geo.size)
                }
            }
        }
        .navigationTitle(store.code.map { "ito · room \($0)" } ?? "ito")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Ito.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if store.code != nil, !store.closed {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { inviting = true } label: { Image(systemName: "qrcode") }
                        .accessibilityLabel("Invite players")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { open("/ito/stats") } label: { Label("Stats", systemImage: "chart.bar") }
                        Button { open("/ito/rules") } label: { Label("How to play", systemImage: "questionmark.circle") }
                        Button(role: .destructive) { confirmingReset = true } label: {
                            Label("New session", systemImage: "arrow.counterclockwise")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("More")
                }
            }
        }
        .keepsScreenAwake()
        .task { await store.start() }
        // Another device may be hosting the same room; keep up with it.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled, !store.busy { await store.refresh() }
            }
        }
        .alert("How did the reveal go?", isPresented: $store.asking) {
            Button("In order") { Task { await store.answer(.win) } }
            Button("Not in order") { Task { await store.answer(.lose) } }
            Button("Don’t record it") { Task { await store.answer(nil) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Round \(store.roundNumber): turning the number cards over from the lowest, did they come out in order? It goes in the stats, then the next card is dealt.")
        }
        .confirmationDialog("Start a new session?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("New session", role: .destructive) { Task { await store.reset() } }
        } message: {
            Text("Rounds start again from 1 and any topic can come up again. Everyone stays in the room, and the stats are kept.")
        }
        .sheet(isPresented: $inviting) {
            if let code = store.code { ItoInviteSheet(code: code) }
        }
        .sheet(item: $webPage) { page in SafariView(url: page.url).ignoresSafeArea() }
        .preferredColorScheme(.dark)
    }

    private func table(in size: CGSize) -> some View {
        // Room for the controls below the card; wider screens get a bigger
        // card, never wider than it is useful.
        let width = max(200, min(size.width - 32, (size.height - 300) * 1.45, sizeClass == .regular ? 720 : 560))
        return ScrollView {
            VStack(spacing: 16) {
                Text(roundLine).font(.system(size: 15, weight: .heavy)).kerning(1.6)
                    .foregroundStyle(Ito.muted)
                    .padding(.top, 8)
                Button {
                    Task { await store.requestDraw() }
                } label: {
                    ItoDealtCard(state: store.state)
                        .frame(width: width, height: width / 1.45)
                }
                .buttonStyle(.plain)
                .disabled(store.busy || store.code == nil)
                .accessibilityLabel(store.roundNumber == 0 ? "Draw the first card" : "Draw the next card")

                Text(store.problem ?? hint)
                    .font(.callout)
                    .foregroundStyle(store.problem == nil ? Ito.muted : Color(hex: 0xEF6F5B))
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 22)

                ItoCategoryStrip(categories: store.categories, selection: $store.category)

                Button {
                    Task { await store.requestDraw() }
                } label: {
                    Text(store.roundNumber == 0 ? "Draw a card" : "Next card")
                        .font(.system(size: 19, weight: .heavy, design: .rounded))
                        .frame(maxWidth: 420)
                }
                .buttonStyle(ItoButtonStyle(primary: true))
                .disabled(store.busy || store.code == nil)

                if store.roundNumber > 0 {
                    Button("Not this one — swap the card") { Task { await store.reroll() } }
                        .buttonStyle(ItoButtonStyle(primary: false))
                        .disabled(store.busy)
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
    }

    private var closed: some View {
        VStack(spacing: 16) {
            Text("This room has closed.").font(.title2.weight(.heavy))
            Text("Rooms close after six hours with nobody in them, or when the server restarts.")
                .foregroundStyle(Ito.muted).multilineTextAlignment(.center)
            Button("Start a new room") { Task { await store.startNew() } }
                .buttonStyle(ItoButtonStyle(primary: true))
        }
        .padding(32)
    }

    private var roundLine: String {
        if store.code == nil { return store.problem == nil ? "OPENING A ROOM…" : "NO ROOM YET" }
        return store.roundNumber > 0 ? "ROUND \(store.roundNumber)" : "NO ROUND YET"
    }

    private var hint: String {
        if store.code == nil { return store.busy ? "" : "Couldn’t open a room." }
        return store.roundNumber > 0 ? "Tap the card for the next one" : "Tap the card to draw your first"
    }

    private func open(_ path: String) {
        webPage = WebPage(url: AppSettings.client.webURL(path))
    }
}

/// What to draw from: "Any", then each category in its own colour, the
/// web wheel's choices in a row you can flick through.
struct ItoCategoryStrip: View {
    let categories: [String]
    @Binding var selection: String?

    var body: some View {
        VStack(spacing: 8) {
            Text("DRAW FROM").font(.caption.weight(.heavy)).kerning(1.6).foregroundStyle(Ito.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(nil, "Any")
                    ForEach(categories, id: \.self) { chip($0, $0) }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func chip(_ value: String?, _ label: String) -> some View {
        let on = selection == value
        let colour = value.map(ItoCategory.colour) ?? Color(hex: 0xC9CCD2)
        return Button { selection = value } label: {
            Text(label.capitalized)
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .padding(.horizontal, 14).padding(.vertical, 9)
                .foregroundStyle(on ? Color(hex: 0x2F3033) : colour)
                .background(on ? colour : colour.opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke(colour.opacity(on ? 0 : 0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The room's code and a QR to the web display, for the players' phones.
struct ItoInviteSheet: View {
    let code: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let url = AppSettings.client.webURL("/ito/play/\(code)")
        NavigationStack {
            VStack(spacing: 18) {
                Text("Scan to see the topic").font(.title3.weight(.heavy))
                if let image = QRCode.image(url.absoluteString) {
                    Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                        .frame(maxWidth: 260)
                        .padding(14).background(.white, in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityLabel("QR code for room \(code)")
                }
                Text(code).font(.system(size: 44, weight: .heavy, design: .rounded)).kerning(8)
                Text("Or open Game Night and join with the code. It also works cast to a TV: \(url.absoluteString)")
                    .font(.footnote).foregroundStyle(Ito.muted).multilineTextAlignment(.center)
                    .textSelection(.enabled)
            }
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Ito.background)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct ItoButtonStyle: ButtonStyle {
    let primary: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(primary ? nil : .system(size: 15, weight: .semibold, design: .rounded))
            .padding(.horizontal, 22).padding(.vertical, primary ? 15 : 10)
            .foregroundStyle(primary ? Color.white : Ito.muted)
            .background(primary ? Ito.accent : Color.white.opacity(0.06), in: Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
    }
}

/// ito's screens are the web display's dark room, with the hub tile's violet.
enum Ito {
    static let background = Color(hex: 0x14161B)
    static let muted = Color(hex: 0x8A8F98)
    static let accent = Color(hex: 0x8F7BFF)
}
