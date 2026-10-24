import SwiftUI

/// Typing in a room code — any game's, like the web's /join. The server
/// says which game it is; Flip 7 opens the table, ito the topic display.
struct JoinView: View {
    var onResolved: (JoinDestination) -> Void
    @State private var code = ""
    @State private var error: String?
    @State private var working = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Theme.background
            VStack(spacing: 18) {
                Text("Ask the host for the four-letter code on their screen.")
                    .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                    .multilineTextAlignment(.center)
                TextField("", text: $code, prompt: Text("CODE").foregroundStyle(Theme.cream.opacity(0.3)))
                    .font(Theme.mono(40)).kerning(10)
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .focused($focused)
                    .padding(.vertical, 14)
                    .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(focused ? Theme.gold : Theme.line, lineWidth: 2))
                    // Only characters that can't be in a code are taken out.
                    // Rewriting the field to upper case on every keystroke
                    // fought the keyboard and dropped letters; capitalisation
                    // is the keyboard's job, and the code is upper-cased on
                    // the way out.
                    .onChange(of: code) { _, new in
                        let cleaned = String(new.filter { Joining.alphabet.contains(Character($0.uppercased())) }.prefix(4))
                        if cleaned != new { code = cleaned }
                        error = nil
                    }
                    .onSubmit { Task { await join() } }
                    .accessibilityLabel("Room code")
                if let error {
                    Text(error).font(.footnote.weight(.semibold)).foregroundStyle(Color(hex: 0xF3A08C))
                        .multilineTextAlignment(.center)
                }
                Button {
                    Task { await join() }
                } label: {
                    Text(working ? "Joining…" : "Join")
                }
                .buttonStyle(FeltButtonStyle(big: true))
                .disabled(code.count != 4 || working)
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: 480)
            .foregroundStyle(Theme.cream)
        }
        .navigationTitle("Join a game")
        .toolbarBackground(Theme.feltDark, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { focused = true }
    }

    private func join() async {
        guard code.count == 4, !working else { return }
        working = true
        defer { working = false }
        do {
            onResolved(try await Joining.resolve(code: code))
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            error = "No game with that code. Check it with the host — it may have expired."
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Seating the players and dealing. This device becomes the dealer: it can
/// play every seat, and others can join on their phones.
struct NewGameView: View {
    var onDealt: (PlayPayload) -> Void
    @State private var names: [String] = TokenStore().lastNames
    @State private var newName = ""
    @State private var error: String?
    @State private var working = false
    @FocusState private var nameFocused: Bool

    private static let maxPlayers = 12
    private static let maxName = 20

    var body: some View {
        List {
            Section {
                ForEach(names, id: \.self) { name in
                    Text(name).font(Theme.display(18, weight: .bold))
                }
                .onDelete { names.remove(atOffsets: $0) }
                .onMove { names.move(fromOffsets: $0, toOffset: $1) }
                HStack {
                    TextField("Player name", text: $newName)
                        .focused($nameFocused)
                        .submitLabel(.next)
                        .onSubmit(add)
                    Button("Add", action: add).disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: {
                Text("Who’s playing? \(names.count) / \(Self.maxPlayers)")
            } footer: {
                Text(error ?? "In the order you’re sitting — drag to reorder. The first name is dealt to first.")
                    .foregroundStyle(error == nil ? Color.secondary : Color(hex: 0xF3A08C))
            }
            .listRowBackground(Theme.cream.opacity(0.06))

            Section {
                Button(working ? "Shuffling…" : names.count < 2 ? "Add at least two players" : "Shuffle & deal") {
                    Task { await deal() }
                }
                .buttonStyle(FeltButtonStyle(big: true))
                .disabled(names.count < 2 || working)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            } footer: {
                Text("Play on this device in the middle of the table, or let everyone join on their own phone with the room code — or a bit of both.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .environment(\.editMode, .constant(names.count > 1 ? .active : .inactive))
        .navigationTitle("New game")
        .toolbarBackground(Theme.feltDark, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .preferredColorScheme(.dark)
    }

    private func add() {
        let name = String(newName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxName))
        guard !name.isEmpty else { return }
        if names.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) {
            error = "\(name) is already at the table."
        } else if names.count >= Self.maxPlayers {
            error = "\(Self.maxPlayers) players is the most the deck can take."
        } else {
            names.append(name)
            error = nil
            newName = ""
        }
        nameFocused = true
    }

    private func deal() async {
        guard names.count >= 2, !working else { return }
        working = true
        defer { working = false }
        do {
            let payload = try await AppSettings.client.create(players: names)
            let tokens = TokenStore()
            tokens.lastNames = names
            if let token = payload.hostToken { tokens.setHostToken(token, for: payload.code) }
            tokens.lastGame = payload.code
            onDealt(payload)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
