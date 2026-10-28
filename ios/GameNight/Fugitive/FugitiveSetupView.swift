import SwiftUI

/// Dealing a game of Fugitive — play.html's setup. Two names, and how it's
/// played: each on their own phone (this device is the table), or this one
/// device passed between them — or, with no internet, the same two ways
/// with the game kept on this phone (OfflineTable). Or one name against the
/// computer: the server plays it online, OfflineTable plays it offline.
struct FugitiveSetupView: View {
    var onDealt: (FugitivePayload) -> Void
    var onResume: (String) -> Void
    /// An offline game kept on this phone, by code.
    var onOffline: (String) -> Void
    /// Joined a game a nearby phone is keeping, by code.
    var onNearby: (String) -> Void
    var onRecords: () -> Void

    enum Mode: Equatable {
        case phones, pass, computer, offlinePass, nearby, offlineComputer
        var offline: Bool { self == .offlinePass || self == .nearby || self == .offlineComputer }
        var solo: Bool { self == .computer || self == .offlineComputer }
    }

    @State private var fugitive: String
    @State private var marshal: String
    @State private var mode = Mode.phones
    /// Two phones offline: which seat this one takes.
    @State private var nearbyRole = FugitiveRole.fugitive
    /// Against the computer: your name, your seat and how hard it plays.
    @AppStorage("fugitive.solo.name") private var me = ""
    @AppStorage("fugitive.solo.you") private var you = FugitiveRole.fugitive
    @AppStorage("fugitive.solo.level") private var level = FugitiveAI.defaultLevel
    @State private var error: String?
    @State private var working = false
    @State private var resumable: FugitivePayload?
    @State private var resumableOffline: FugitivePayload?
    @State private var joiningNearby = false
    @FocusState private var focused: FugitiveRole?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private static let maxName = 20

    init(onDealt: @escaping (FugitivePayload) -> Void, onResume: @escaping (String) -> Void,
         onOffline: @escaping (String) -> Void, onNearby: @escaping (String) -> Void,
         onRecords: @escaping () -> Void) {
        self.onDealt = onDealt
        self.onResume = onResume
        self.onOffline = onOffline
        self.onNearby = onNearby
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
                    if let game = resumable { resumeButton(game, offline: false) }
                    if let game = resumableOffline { resumeButton(game, offline: true) }
                    form
                    Button {
                        joiningNearby = true
                    } label: {
                        Label("Join a nearby game — no internet", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .buttonStyle(NoirButtonStyle(fill: nil))
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
        .sheet(isPresented: $joiningNearby) {
            NearbyJoinSheet { code in
                joiningNearby = false
                onNearby(code)
            }
        }
        .task {
            // The offline game first: it needs no signal, so it mustn't wait for any.
            await checkOfflineResume()
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
            // Fugitive, the next the Marshal — or, against the computer, just you.
            if mode.solo {
                RegularsPicker(skip: [me], onPick: { me = $0 }, label: "Regulars — tap to fill in")
                    .foregroundStyle(Noir.ink)
                if you == .fugitive {
                    nameRow(.fugitive, text: $me, solo: true)
                    computerRow
                } else {
                    computerRow
                    nameRow(.marshal, text: $me, solo: true)
                }
            } else {
                RegularsPicker(skip: [fugitive, marshal], onPick: fill, label: "Regulars — tap to fill in")
                    .foregroundStyle(Noir.ink)
                nameRow(.fugitive, text: $fugitive)
                nameRow(.marshal, text: $marshal)
            }
            Button {
                if mode.solo { you = you.other } else { (fugitive, marshal) = (marshal, fugitive) }
                Sound.shared.play(.flick, volume: 0.5)
            } label: {
                Label("Swap roles", systemImage: "arrow.up.arrow.down")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Noir.pen)

            VStack(alignment: .leading, spacing: 8) {
                modeRow(.phones, "On our own phones", "This screen is the table. Scan its code on each phone and sit down.")
                modeRow(.pass, "Pass this device between us", "Hands are hidden while it changes hands.")
                modeRow(.computer, "Against the computer",
                        "On your own. Easy plays plainly; Hard bluffs, and deduces as well as the notepad. Not counted in the records.")
                Text("NO INTERNET — ON A PLANE")
                    .font(Noir.type(11)).kerning(1.2)
                    .foregroundStyle(Noir.ink.opacity(0.55))
                    .padding(.top, 6)
                modeRow(.offlinePass, "Pass this phone, offline",
                        "The whole game stays on this phone. It’s added to the records once there’s signal.")
                modeRow(.nearby, "Two phones side by side, offline",
                        "This phone keeps the game; the other joins with “Join a nearby game”. Bluetooth or Wi‑Fi, no internet needed.")
                if mode == .nearby {
                    Picker("This phone plays", selection: $nearbyRole) {
                        Text("This phone: \(displayName(.fugitive))").tag(FugitiveRole.fugitive)
                        Text("This phone: \(displayName(.marshal))").tag(FugitiveRole.marshal)
                    }
                    .pickerStyle(.segmented)
                }
                modeRow(.offlineComputer, "Against the computer, offline",
                        "On your own, with the computer playing on this phone. Not counted in the records.")
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

    private func nameRow(_ role: FugitiveRole, text: Binding<String>, solo: Bool = false) -> some View {
        let shown = text.wrappedValue.trimmingCharacters(in: .whitespaces)
        return HStack(spacing: 12) {
            Mugshot(name: shown.isEmpty ? role.title : shown, role: role, size: 46)
            Text(role.title.uppercased())
                .font(Noir.type(12))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Noir.colour(role).opacity(0.25), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(Noir.ink)
            TextField(solo ? "Your name" : "Name", text: text)
                .font(.body.weight(.semibold))
                .foregroundStyle(Noir.ink)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .focused($focused, equals: role)
                .submitLabel(role == .fugitive && !solo ? .next : .go)
                .onSubmit {
                    if role == .fugitive && !solo { focused = .marshal } else { Task { await deal() } }
                }
                .onChange(of: text.wrappedValue) { _, new in
                    if new.count > Self.maxName { text.wrappedValue = String(new.prefix(Self.maxName)) }
                    error = nil
                }
                .padding(.horizontal, 10).padding(.vertical, 9)
                .background(Color.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Noir.pen.opacity(0.2)))
                .accessibilityLabel(solo ? "Your name" : "\(role.title)’s name")
        }
    }

    /// The computer's row: its face, and how hard it plays.
    private var computerRow: some View {
        let role = you.other
        return HStack(spacing: 12) {
            Mugshot(name: FugitiveComputer.name, role: role, size: 46)
            Text(role.title.uppercased())
                .font(Noir.type(12))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Noir.colour(role).opacity(0.25), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(Noir.ink)
            VStack(alignment: .leading, spacing: 6) {
                Text(FugitiveComputer.name).font(.body.weight(.semibold)).foregroundStyle(Noir.ink)
                Picker("How hard the computer plays", selection: $level) {
                    ForEach(FugitiveAI.Level.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private func displayName(_ role: FugitiveRole) -> String {
        let name = (role == .fugitive ? fugitive : marshal).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? role.title : name
    }

    private func modeRow(_ choice: Mode, _ title: String, _ detail: String) -> some View {
        Button {
            mode = choice
            // Your name against the computer starts as the last Fugitive's.
            if choice.solo && me.trimmingCharacters(in: .whitespaces).isEmpty { me = fugitive }
            error = nil
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: mode == choice ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(mode == choice ? Noir.pen : Noir.pen.opacity(0.4))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.bold))
                    Text(detail).font(.caption).foregroundStyle(Noir.ink.opacity(0.65))
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(Noir.ink)
            .padding(10)
            .background(mode == choice ? Noir.manila.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(mode == choice ? .isSelected : [])
    }

    private func resumeButton(_ game: FugitivePayload, offline: Bool) -> some View {
        Button {
            if offline { onOffline(game.code) } else { onResume(game.code) }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(offline ? "Back to the offline game" : "Back to the table").font(Noir.poster(22))
                    Text("\(game.name(.fugitive)) v \(game.name(.marshal)) · \(offline ? "on this phone" : "room \(game.code)")")
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
        if mode.solo { return await dealSolo() }
        let f = fugitive.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = marshal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !f.isEmpty, !m.isEmpty else { error = "Both players need a name."; return }
        guard Faces.fold(f) != Faces.fold(m) else { error = "Two different players, please."; return }
        working = true
        defer { working = false }
        Sound.shared.play(.riffle)
        if mode.offline {
            await dealOffline(f, m)
            return
        }
        let client = AppSettings.client
        let tokens = FugitiveTokens()
        do {
            var payload = try await client.fugitiveCreate(fugitive: f, marshal: m)
            var device = FugitiveDevice(host: payload.hostToken)
            if mode == .pass {
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
        } catch GameNightClient.Failure.unreachable {
            error = "No signal? Pick one of the offline ways to play, under “No internet”."
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// One name and a seat; the computer takes the other one — played by the
    /// server online, by OfflineTable offline. This device sits in yours.
    private func dealSolo() async {
        let name = me.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { error = "Your name, please."; return }
        // The server refuses it too: the two need telling apart.
        guard Faces.fold(name) != Faces.fold(FugitiveComputer.name) else { error = "Pick a name that isn’t the computer’s."; return }
        working = true
        defer { working = false }
        Sound.shared.play(.riffle)
        do {
            if mode.offline {
                let table = OfflineTable.shared
                let tokens = FugitiveTokens.offline
                let payload = try table.create(you: you, name: name, level: level)
                var device = FugitiveDevice(host: payload.hostToken)
                device.setSeat(you, try await table.fugitiveClaim(code: payload.code, role: you).seatToken)
                tokens.set(device, for: payload.code)
                tokens.lastGame = payload.code
                onOffline(payload.code)
            } else {
                let client = AppSettings.client
                let tokens = FugitiveTokens()
                let payload = try await client.fugitiveCreate(you: you, name: name, level: level)
                var device = FugitiveDevice(host: payload.hostToken)
                let sat = try await client.fugitiveClaim(code: payload.code, role: you)
                device.setSeat(you, sat.seatToken)
                tokens.set(device, for: payload.code)
                tokens.lastGame = payload.code
                // Your seat's view: the store asks with that token from now on.
                onDealt(sat)
            }
        } catch GameNightClient.Failure.unreachable {
            error = "No signal? Pick “Against the computer, offline”, under “No internet”."
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The game kept on this phone. Pass-and-play takes both seats here;
    /// two phones take one, and the other phone sits in the other.
    private func dealOffline(_ f: String, _ m: String) async {
        let table = OfflineTable.shared
        let tokens = FugitiveTokens.offline
        do {
            let payload = try table.create(fugitive: f, marshal: m)
            var device = FugitiveDevice(host: payload.hostToken)
            let mine: [FugitiveRole] = mode == .nearby ? [nearbyRole] : FugitiveRole.allCases
            for role in mine {
                device.setSeat(role, try await table.fugitiveClaim(code: payload.code, role: role).seatToken)
            }
            device.pass = mine.count == 2
            tokens.set(device, for: payload.code)
            tokens.lastNames = ["fugitive": f, "marshal": m]
            tokens.lastGame = payload.code
            onOffline(payload.code)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The last game is only offered back once it's confirmed to still be
    /// going: a dead code offered up is worse than no offer.
    private func checkOfflineResume() async {
        let offline = FugitiveTokens.offline
        if let code = offline.lastGame,
           let payload = try? await OfflineTable.shared.fugitiveState(code: code, token: offline.held(for: code).askingToken) {
            resumableOffline = payload.game.isOver ? nil : payload
        } else {
            resumableOffline = nil
        }
    }

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
