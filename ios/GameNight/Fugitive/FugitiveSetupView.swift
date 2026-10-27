import SwiftUI

/// Dealing a game of Fugitive — play.html's setup. Two names, and how it's
/// played: each on their own phone (this device is the table), or this one
/// device passed between them.
struct FugitiveSetupView: View {
    var onDealt: (FugitivePayload) -> Void
    var onResume: (String) -> Void
    var onRecords: () -> Void

    @State private var fugitive: String
    @State private var marshal: String
    @State private var passAndPlay = false
    @State private var error: String?
    @State private var working = false
    @State private var resumable: FugitivePayload?
    @FocusState private var focused: FugitiveRole?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private static let maxName = 20

    init(onDealt: @escaping (FugitivePayload) -> Void, onResume: @escaping (String) -> Void,
         onRecords: @escaping () -> Void) {
        self.onDealt = onDealt
        self.onResume = onResume
        self.onRecords = onRecords
        let last = FugitiveTokens().lastNames
        _fugitive = State(initialValue: last["fugitive"] ?? "")
        _marshal = State(initialValue: last["marshal"] ?? "")
    }

    var body: some View {
        ZStack {
            DeskBackground().ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    Text("One runs, one hunts. The Fugitive lays a trail of face-down hideouts from the cell at 0 to the plane out at 42; the Marshal guesses numbers to turn them over.")
                        .font(.subheadline)
                        .foregroundStyle(Noir.card.opacity(0.8))
                        .multilineTextAlignment(.center)
                    if let game = resumable { resumeButton(game) }
                    form
                    HStack(spacing: 10) {
                        Button { onRecords() } label: { Label("Records", systemImage: "star") }
                        Button { rules = WebPage(url: AppSettings.client.webURL("/fugitive/rules")) } label: {
                            Label("Rules", systemImage: "questionmark.circle")
                        }
                    }
                    .buttonStyle(NoirButtonStyle(fill: nil))
                }
                .padding(sizeClass == .regular ? 32 : 20)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .navigationTitle("Fugitive")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Noir.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(item: $rules) { page in SafariView(url: page.url).ignoresSafeArea() }
        .task {
            await Faces.shared.load()
            await checkResume()
        }
        .preferredColorScheme(.dark)
    }

    @State private var rules: WebPage?

    // MARK: - pieces

    private var hero: some View {
        ZStack {
            FugitiveCard(number: 0, width: 74).rotationEffect(.degrees(-12), anchor: .bottom).offset(x: -58, y: 8)
            FugitiveCard(number: 42, width: 74).rotationEffect(.degrees(12), anchor: .bottom).offset(x: 58, y: 8)
            FugitiveCard(number: nil, width: 82)
        }
        .frame(height: 140)
        .padding(.top, 8)
        .accessibilityHidden(true)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Who’s playing?").font(Noir.poster(28)).foregroundStyle(Noir.ink)
            // The regulars, with their faces: the first tap fills the
            // Fugitive, the next the Marshal.
            RegularsPicker(skip: [fugitive, marshal], onPick: fill, label: "Regulars — tap to fill in")
                .foregroundStyle(Noir.ink)
            nameRow(.fugitive, text: $fugitive)
            nameRow(.marshal, text: $marshal)
            Button {
                (fugitive, marshal) = (marshal, fugitive)
                Sound.shared.play(.flick, volume: 0.5)
            } label: {
                Label("Swap roles", systemImage: "arrow.up.arrow.down")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Noir.pen)

            VStack(spacing: 8) {
                modeRow(false, "On our own phones", "This screen is the table. Scan its code on each phone and sit down.")
                modeRow(true, "Pass this device between us", "Hands are hidden while it changes hands.")
            }

            Button {
                Task { await deal() }
            } label: {
                Text(working ? "Shuffling…" : "Deal")
            }
            .buttonStyle(NoirButtonStyle(fill: Noir.fugitive))
            .disabled(working)

            if let error {
                Text(error).font(.footnote.weight(.semibold)).foregroundStyle(Noir.miss)
            }
        }
        .padding(18)
        .background(Noir.paper, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.4), radius: 10, y: 6)
    }

    private func nameRow(_ role: FugitiveRole, text: Binding<String>) -> some View {
        let shown = text.wrappedValue.trimmingCharacters(in: .whitespaces)
        return HStack(spacing: 12) {
            Mugshot(name: shown.isEmpty ? role.title : shown, role: role, size: 46)
            Text(role.title.uppercased())
                .font(Noir.type(12))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Noir.colour(role).opacity(0.25), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(Noir.ink)
            TextField("Name", text: text)
                .font(.body.weight(.semibold))
                .foregroundStyle(Noir.ink)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .focused($focused, equals: role)
                .submitLabel(role == .fugitive ? .next : .go)
                .onSubmit {
                    if role == .fugitive { focused = .marshal } else { Task { await deal() } }
                }
                .onChange(of: text.wrappedValue) { _, new in
                    if new.count > Self.maxName { text.wrappedValue = String(new.prefix(Self.maxName)) }
                    error = nil
                }
                .padding(.horizontal, 10).padding(.vertical, 9)
                .background(Color.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Noir.pen.opacity(0.2)))
                .accessibilityLabel("\(role.title)’s name")
        }
    }

    private func modeRow(_ pass: Bool, _ title: String, _ detail: String) -> some View {
        Button {
            passAndPlay = pass
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: passAndPlay == pass ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(passAndPlay == pass ? Noir.pen : Noir.pen.opacity(0.4))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.bold))
                    Text(detail).font(.caption).foregroundStyle(Noir.ink.opacity(0.65))
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(Noir.ink)
            .padding(10)
            .background(passAndPlay == pass ? Noir.manila.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(passAndPlay == pass ? .isSelected : [])
    }

    private func resumeButton(_ game: FugitivePayload) -> some View {
        Button {
            onResume(game.code)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Back to the table").font(Noir.poster(22))
                    Text("\(game.name(.fugitive)) v \(game.name(.marshal)) · room \(game.code)")
                        .font(.footnote).lineLimit(1)
                }
                Spacer()
                Image(systemName: "arrow.right")
            }
        }
        .buttonStyle(NoirButtonStyle(fill: Noir.manila))
    }

    // MARK: - doing

    private func fill(_ name: String) {
        if fugitive.trimmingCharacters(in: .whitespaces).isEmpty {
            fugitive = name
        } else if marshal.trimmingCharacters(in: .whitespaces).isEmpty, Faces.fold(fugitive) != Faces.fold(name) {
            marshal = name
        } else {
            fugitive = name
        }
    }

    private func deal() async {
        guard !working else { return }
        let f = fugitive.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = marshal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !f.isEmpty, !m.isEmpty else { error = "Both players need a name."; return }
        guard Faces.fold(f) != Faces.fold(m) else { error = "Two different players, please."; return }
        working = true
        defer { working = false }
        Sound.shared.play(.riffle)
        let client = AppSettings.client
        let tokens = FugitiveTokens()
        do {
            var payload = try await client.fugitiveCreate(fugitive: f, marshal: m)
            var device = FugitiveDevice(host: payload.hostToken)
            if passAndPlay {
                for role in FugitiveRole.allCases {
                    let sat = try await client.fugitiveClaim(code: payload.code, role: role)
                    device.setSeat(role, sat.seatToken)
                }
                device.pass = true
                // The table's view, read with the dealer's token: nobody's hand.
                payload = try await client.fugitiveState(code: payload.code, token: device.host)
            }
            tokens.set(device, for: payload.code)
            tokens.lastNames = ["fugitive": f, "marshal": m]
            tokens.lastGame = payload.code
            onDealt(payload)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The last game is only offered back once it's confirmed to still be
    /// going: a dead code offered up is worse than no offer.
    private func checkResume() async {
        let tokens = FugitiveTokens()
        guard let code = tokens.lastGame else { resumable = nil; return }
        do {
            let payload = try await AppSettings.client.fugitiveState(code: code, token: tokens.held(for: code).askingToken)
            resumable = payload.game.isOver ? nil : payload
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            tokens.lastGame = nil
            resumable = nil
        } catch {
            resumable = nil
        }
    }
}
