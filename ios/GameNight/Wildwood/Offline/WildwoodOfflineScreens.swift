import SwiftUI

/// An offline Wildwood game kept on this phone. While a person's seat is
/// still free it's advertised for nearby phones to join (NearbyHost.wildwood)
/// — up to three of them, each answered on its own.
struct OfflineWildwoodScreen: View {
    @State private var store: WildwoodStore
    @State private var host = NearbyHost.wildwood

    init(code: String) {
        _store = State(initialValue: WildwoodStore(code: code, transport: WildwoodOfflineTable.shared))
    }

    var body: some View {
        WildwoodTableScreen(store: store)
            .overlay(alignment: .top) {
                if openSeats || !host.connected.isEmpty {
                    if let problem = host.problem {
                        WoodBadge(text: problem, warning: true)
                    } else if host.connected.isEmpty {
                        WoodBadge(text: "Waiting for the other phones — “Join a nearby game” on theirs", warning: true)
                    } else {
                        WoodBadge(text: "Connected to \(host.connected.joined(separator: ", "))")
                    }
                }
            }
            .onAppear { advertise() }
            // A rematch is a new game, with a new code to advertise.
            .onChange(of: store.code) { advertise() }
            .onDisappear { host.stop() }
    }

    /// A person's seat nobody on this phone holds: someone's coming on theirs.
    private var openSeats: Bool {
        guard let game = WildwoodOfflineTable.shared.saved(store.code) else { return false }
        let computers = game.computer?.seats ?? []
        return game.players.indices.contains { !computers.contains($0) && store.device.seat($0) == nil }
    }

    private func advertise() {
        guard let game = WildwoodOfflineTable.shared.saved(store.code) else { return }
        let computers = game.computer?.seats ?? []
        let people = game.players.indices.contains { !computers.contains($0) && store.device.seat($0) == nil }
        guard people else { return }
        let me = store.device.seats.first.map { game.players[$0] } ?? Faces.shared.me?.name ?? "Wildwood"
        host.start(code: store.code, hostName: me, players: game.players.joined(separator: ", "))
    }
}

/// A Wildwood game kept on a nearby phone, played from this one.
struct NearbyWildwoodScreen: View {
    @State private var store: WildwoodStore
    @State private var guest = NearbyGuest.wildwood

    init(code: String) {
        _store = State(initialValue: WildwoodStore(code: code, transport: NearbyGuest.wildwood.wildwoodTransport))
    }

    var body: some View {
        WildwoodTableScreen(store: store)
            .overlay(alignment: .top) {
                switch guest.status {
                case .connected:
                    EmptyView()
                case .lost(let host), .connecting(let host):
                    WoodBadge(text: "Lost \(host.name)’s phone — reconnecting. Keep them close.", warning: true)
                default:
                    WoodBadge(text: "Not connected to the other phone.", warning: true)
                }
            }
            .onDisappear { guest.leave() }
    }
}

/// A slim note under the toolbar about the link between the phones.
private struct WoodBadge: View {
    let text: String
    var warning = false

    var body: some View {
        Label(text, systemImage: warning ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(warning ? Woods.call : Woods.cream, in: Capsule())
            .foregroundStyle(Woods.ink)
            .padding(.top, 6)
            .allowsHitTesting(false)
    }
}

/// Finding a phone that's hosting an offline Wildwood game nearby, and joining it.
struct WildwoodNearbyJoinSheet: View {
    var onJoined: (String) -> Void
    @State private var guest = NearbyGuest.wildwood
    @State private var joined = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Woods.backdrop
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("On the phone dealing: Wildwood → Offline → Deal, with “A phone each”. It shows up here — no internet needed, just keep the phones close. Then tap your name to sit down.")
                            .font(.subheadline).foregroundStyle(Woods.cream.opacity(0.85))
                        if guest.hosts.isEmpty {
                            HStack(spacing: 10) {
                                ProgressView().tint(Woods.cream)
                                Text("Looking…").font(Woods.display(16)).foregroundStyle(Woods.cream)
                            }
                            .padding(.vertical, 20)
                        }
                        ForEach(guest.hosts) { host in
                            Button { guest.join(host) } label: {
                                HStack(spacing: 12) {
                                    AvatarView(name: host.name, size: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(host.players.isEmpty ? host.name : host.players).font(Woods.display(18))
                                        Text("\(host.name)’s phone").font(.caption).opacity(0.7)
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.right.circle.fill").font(.title2)
                                }
                                .foregroundStyle(Woods.ink)
                                .padding(14)
                                .background(Woods.cream, in: RoundedRectangle(cornerRadius: 14))
                            }
                            .buttonStyle(.plain)
                            .disabled(isConnecting)
                        }
                        if case .connecting(let host) = guest.status {
                            Text("Joining \(host.name)’s game…").font(Woods.display(15)).foregroundStyle(Woods.cream)
                        } else if let problem = guest.problem {
                            Text(problem).font(.footnote.weight(.semibold)).foregroundStyle(Woods.call)
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Join a nearby game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Woods.background, for: .navigationBar)
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
}
