import SwiftUI

/// Who's playing: the people's names, how many computer players and how
/// they play, and whether it's a phone each or one device passed round —
/// play.html's setup, in the app. Offline (on a plane, or by itself with no
/// signal) the game is kept on this phone, and other phones join it nearby.
struct WildwoodSetupView: View {
    let onDealt: (WildwoodPayload) -> Void
    /// An offline game kept on this phone, by code.
    var onOffline: (String) -> Void = { _ in }
    /// Joined a game a nearby phone is keeping, by code.
    var onNearby: (String) -> Void = { _ in }
    var onRecords: () -> Void = {}

    @State private var setup = WildwoodTokens().lastSetup ?? WildwoodSetup()
    @State private var busy = false
    @State private var offline = false
    @State private var joiningNearby = false
    @State private var error: String?
    @FocusState private var focused: Int?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private static let maxPlayers = 4
    /// game.py's COMPUTER_NAMES: the computer's seats are woodland animals.
    static let computerNames = ["Hedgehog", "Rabbit", "Squirrel", "Mole"]

    private var room: Int { Self.maxPlayers - setup.names.count }

    var body: some View {
        ZStack {
            Woods.backdrop
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    Text("Match the colour or the creature, play a wild Badger to change the colour, and be first to empty your hand. Down to one card? Say “Last card!” before anyone catches you.")
                        .font(.subheadline).foregroundStyle(Woods.cream.opacity(0.75))
                        .multilineTextAlignment(.center)
                    Button { joiningNearby = true } label: {
                        Label("Join a nearby game — no internet", systemImage: "antenna.radiowaves.left.and.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(WoodButtonStyle(kind: .quiet))
                    WoodPanel(title: "Who’s playing?") {
                        RegularsPicker(skip: setup.names, onPick: add)
                        ForEach(setup.names.indices, id: \.self) { i in nameRow(i) }
                        if setup.names.count + setup.computers < Self.maxPlayers {
                            Button { setup.names.append(""); focused = setup.names.count - 1 } label: {
                                Label("Add a player", systemImage: "plus")
                            }
                            .buttonStyle(WoodButtonStyle(kind: .quiet))
                        }
                        computers
                        if setup.names.count > 1 {
                            Picker("How you’ll play", selection: $setup.pass) {
                                Text("A phone each").tag(false)
                                Text("Pass this device").tag(true)
                            }
                            .pickerStyle(.segmented)
                            Text(setup.pass ? "Hands are hidden while it changes hands."
                                 : offline ? "This phone keeps the game. The others tap “Join a nearby game” on theirs."
                                 : "This screen is the table. Everyone else scans its code and sits down.")
                                .font(.footnote).foregroundStyle(Woods.cream.opacity(0.65))
                        }
                        Toggle(isOn: $offline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Offline").font(Woods.display(16, weight: .bold))
                                Text("No internet needed — for a plane. Kept on this phone; the records catch up later.")
                                    .font(.footnote).foregroundStyle(Woods.cream.opacity(0.65))
                            }
                        }
                        .tint(Woods.accent)
                        Button(action: { Task { await deal() } }) {
                            Text(busy ? "Shuffling…" : "Deal").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(WoodButtonStyle(kind: .go, big: true))
                        .disabled(busy)
                        if let error {
                            Text(error).font(.footnote).foregroundStyle(Woods.caught)
                        }
                    }
                    Button("Records", systemImage: "star", action: onRecords)
                        .buttonStyle(WoodButtonStyle(kind: .quiet))
                }
                .padding(20)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
                .foregroundStyle(Woods.cream)
            }
        }
        .navigationTitle("Wildwood")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Woods.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            await Faces.shared.load()
            if !(await Connectivity.online()) { offline = true }
        }
        .sheet(isPresented: $joiningNearby) {
            WildwoodNearbyJoinSheet { code in
                joiningNearby = false
                onNearby(code)
            }
        }
    }

    private var hero: some View {
        HStack(spacing: -16) {
            WildwoodCardView(card: "r7", width: 74).rotationEffect(.degrees(-14)).offset(y: 10)
            WildwoodCardView(card: "gS", width: 74).rotationEffect(.degrees(-5))
            WildwoodCardView(card: "W", width: 74).rotationEffect(.degrees(5))
            WildwoodCardView(card: "yD", width: 74).rotationEffect(.degrees(14)).offset(y: 10)
        }
        .padding(.top, 8)
        // The outer cards drop below the row; keep them off the words.
        .padding(.bottom, 14)
        .accessibilityHidden(true)
    }

    private func nameRow(_ i: Int) -> some View {
        HStack(spacing: 10) {
            Text("\(i + 1)").font(Woods.display(14)).foregroundStyle(Woods.ink)
                .frame(width: 26, height: 26).background(Woods.cream, in: Circle())
            TextField(i == 0 ? "Your name" : "Name", text: $setup.names[i])
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focused, equals: i)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Woods.panel2, in: RoundedRectangle(cornerRadius: 12))
                .onChange(of: setup.names[i]) { _, new in
                    if new.count > 20 { setup.names[i] = String(new.prefix(20)) }
                }
            if setup.names.count > 1 {
                Button { setup.names.remove(at: i); fit() } label: { Image(systemName: "xmark") }
                    .buttonStyle(.plain)
                    .frame(width: 36, height: 36)
                    .overlay(Circle().strokeBorder(Woods.line))
                    .accessibilityLabel("Remove player \(i + 1)")
            }
        }
    }

    @ViewBuilder private var computers: some View {
        HStack {
            Text("Computer players").font(Woods.display(16, weight: .bold))
            Spacer()
            Picker("Computer players", selection: $setup.computers) {
                ForEach(0...max(0, room), id: \.self) { Text("\($0)").tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 200)
        }
        if setup.computers > 0 {
            HStack(spacing: 8) {
                ForEach(computerNames, id: \.self) { name in
                    HStack(spacing: 6) {
                        WildwoodFace(name: name, computer: true, size: 28)
                        Text(name).font(.subheadline.weight(.semibold))
                    }
                    .padding(.vertical, 4).padding(.leading, 4).padding(.trailing, 10)
                    .background(Woods.panel2, in: Capsule())
                }
            }
            Picker("They play", selection: $setup.level) {
                Text("Easy").tag("easy")
                Text("Hard").tag("hard")
            }
            .pickerStyle(.segmented)
        }
    }

    /// The computer's animals, skipping any a person here is called — the
    /// same choice game.py makes.
    private var computerNames: [String] {
        let taken = Set(setup.names.map(Faces.fold))
        return Array(Self.computerNames.filter { !taken.contains(Faces.fold($0)) }.prefix(setup.computers))
    }

    private func add(_ name: String) {
        if let blank = setup.names.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
            setup.names[blank] = name
        } else if setup.names.count + setup.computers < Self.maxPlayers {
            setup.names.append(name)
        } else {
            setup.names[setup.names.count - 1] = name
        }
        fit()
    }

    private func fit() {
        setup.computers = min(setup.computers, max(0, Self.maxPlayers - setup.names.count))
    }

    private func deal() async {
        let people = setup.names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !people.contains(where: \.isEmpty) else { error = "Every player needs a name."; return }
        guard people.count + setup.computers >= 2 else { error = "Two players at least — add someone, or a computer player."; return }
        busy = true
        error = nil
        defer { busy = false }
        let table = WildwoodOfflineTable.shared
        let transport: any WildwoodTransport = offline ? table : AppSettings.client
        let tokens = transport.wildwoodTokens
        do {
            var payload = offline
                ? try table.create(players: people, computers: setup.computers, level: WildwoodAI.Level(rawValue: setup.level) ?? .easy)
                : try await AppSettings.client.wildwoodCreate(players: people, computers: setup.computers, level: setup.level)
            var device = WildwoodDevice(host: payload.hostToken)
            // One person (against the computer), or one device passed round:
            // this device sits in every seat a person has. Offline with a
            // phone each, the dealer sits in the first.
            let mine = people.count == 1 || setup.pass ? Array(people.indices) : offline ? [0] : []
            for seat in mine {
                let sat = try await transport.wildwoodClaim(code: payload.code, seat: seat)
                device.setSeat(seat, sat.seatToken)
                if people.count == 1 { payload = sat }
            }
            tokens.set(device, for: payload.code)
            tokens.lastGame = payload.code
            var saved = setup
            saved.names = people
            WildwoodTokens().lastSetup = saved
            Sound.shared.play(.riffle)
            if offline { onOffline(payload.code) } else { onDealt(payload) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
