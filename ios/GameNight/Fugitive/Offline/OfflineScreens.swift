import SwiftUI

/// An offline game kept on this phone. When this phone holds only one of
/// the two seats it's a two-phone game, so while the table is on screen
/// it's advertised for the other phone to join (NearbyHost).
struct OfflineFugitiveScreen: View {
    @State private var store: FugitiveStore
    @State private var host = NearbyHost.shared

    init(code: String) {
        _store = State(initialValue: FugitiveStore(code: code, transport: OfflineTable.shared))
    }

    var body: some View {
        FugitiveTableScreen(store: store)
            .overlay(alignment: .top) {
                if store.device.seats.count == 1 {
                    NearbyBadge(text: host.connected.isEmpty
                                ? "Waiting for the other phone — “Join a nearby game” on theirs"
                                : "Connected to \(host.connected.joined(separator: ", "))",
                                warning: host.connected.isEmpty)
                }
            }
            .onAppear(perform: advertise)
            // A rematch is a new game, with a new code to advertise.
            .onChange(of: store.code) { advertise() }
            .onDisappear { host.stop() }
    }

    private func advertise() {
        guard store.device.seats.count == 1, let seat = store.device.seats.first,
              let game = OfflineTable.shared.saved(store.code) else { return }
        host.start(code: store.code, hostName: game.name(seat),
                   players: "\(game.name(.fugitive)) v \(game.name(.marshal))")
    }
}

/// A game kept on a nearby phone, played from this one.
struct NearbyFugitiveScreen: View {
    @State private var store: FugitiveStore
    @State private var guest = NearbyGuest.shared

    init(code: String) {
        _store = State(initialValue: FugitiveStore(code: code, transport: NearbyGuest.shared.transport))
    }

    var body: some View {
        FugitiveTableScreen(store: store)
            .overlay(alignment: .top) {
                switch guest.status {
                case .connected:
                    EmptyView()
                case .lost(let host), .connecting(let host):
                    NearbyBadge(text: "Lost \(host.name)’s phone — reconnecting. Keep them close.", warning: true)
                default:
                    NearbyBadge(text: "Not connected to the other phone.", warning: true)
                }
            }
            .onDisappear { guest.leave() }
    }
}

/// A slim note under the toolbar about the link between the two phones.
private struct NearbyBadge: View {
    let text: String
    var warning = false

    var body: some View {
        Label(text, systemImage: warning ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(warning ? Noir.manila : Noir.found.opacity(0.85), in: Capsule())
            .foregroundStyle(Noir.ink)
            .padding(.top, 6)
            .allowsHitTesting(false)
    }
}

/// Finding a phone that's hosting an offline game nearby, and joining it.
struct NearbyJoinSheet: View {
    var onJoined: (String) -> Void
    @State private var guest = NearbyGuest.shared
    @State private var joined = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DeskBackground().ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("On the other phone: Fugitive → “Two phones side by side, offline” → Deal. It shows up here — no internet needed, just keep the phones close.")
                            .font(.subheadline)
                            .foregroundStyle(Noir.card.opacity(0.85))
                        if guest.hosts.isEmpty {
                            HStack(spacing: 10) {
                                ProgressView().tint(Noir.card)
                                Text("Looking…").font(Noir.type(15)).foregroundStyle(Noir.card)
                            }
                            .padding(.vertical, 20)
                        }
                        ForEach(guest.hosts) { host in
                            Button { guest.join(host) } label: { row(host) }
                                .buttonStyle(PaperPress())
                                .disabled(isConnecting)
                        }
                        if case .connecting(let host) = guest.status {
                            Text("Joining \(host.name)’s game…").font(Noir.type(14)).foregroundStyle(Noir.card)
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Join a nearby game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Noir.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
        .task { guest.look(as: Faces.shared.me?.name ?? "Game Night") }
        .onChange(of: guest.status) { _, status in
            if case .connected(let host) = status {
                joined = true
                onJoined(host.code)
            }
        }
        // Closed without joining: stop looking.
        .onDisappear { if !joined { guest.leave() } }
    }

    private var isConnecting: Bool {
        if case .connecting = guest.status { return true }
        return false
    }

    private func row(_ host: NearbyGuest.Host) -> some View {
        HStack(spacing: 12) {
            Mugshot(name: host.name, role: .fugitive, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(host.players.isEmpty ? host.name : host.players).font(Noir.poster(22))
                Text("\(host.name)’s phone").font(.caption).opacity(0.7)
            }
            Spacer()
            Image(systemName: "arrow.right.circle.fill").font(.title2)
        }
        .foregroundStyle(Noir.ink)
        .padding(14)
        .background(Noir.manila, in: RoundedRectangle(cornerRadius: 12))
    }
}
