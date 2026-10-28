import Foundation
import MultipeerConnectivity
import Observation

// The air between two phones, for a Fugitive game with no internet:
// MultipeerConnectivity, which finds the other phone and talks to it over
// Bluetooth or peer-to-peer Wi-Fi with no network at all. The host phone
// advertises its game; the guest browses, joins, and then sends the
// server's API calls across (Nearby.swift says what travels).
//
// MultipeerConnectivity calls its delegates on its own queue, so each
// callback hops to the main actor, carrying peers and sessions in the
// small boxes below — they're thread-safe objects, but not marked Sendable.

enum NearbyService {
    /// Bonjour type: `_gn-fugitive._tcp` and `._udp` are in Info.plist's
    /// NSBonjourServices, as iOS requires.
    static let type = "gn-fugitive"

    /// A peer name MultipeerConnectivity accepts: not empty, under 63 bytes.
    static func peerName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var short = trimmed.isEmpty ? "Game Night" : trimmed
        while short.utf8.count > 60 { short.removeLast() }
        return short
    }

    static var lostTouch: GameNightClient.Failure {
        .server(status: 503, message: "Lost touch with the other phone — keep the two close together.", payload: nil)
    }
}

nonisolated struct PeerRef: @unchecked Sendable, Hashable {
    let id: MCPeerID
}

nonisolated struct SessionRef: @unchecked Sendable {
    let session: MCSession
}

nonisolated struct InvitationReply: @unchecked Sendable {
    let reply: (Bool, MCSession?) -> Void
}

// MARK: - the host

/// The phone that keeps the game: advertises it while its table is on
/// screen, lets the other phone connect, and answers its calls from the
/// offline table.
@Observable
final class NearbyHost: NSObject {
    static let shared = NearbyHost()

    private(set) var code: String?
    /// Who's connected, by name.
    private(set) var connected: [String] = []
    private(set) var problem: String?

    @ObservationIgnored private var session: MCSession?
    @ObservationIgnored private var advertiser: MCNearbyServiceAdvertiser?
    @ObservationIgnored private let responder = NearbyResponder()

    func start(code: String, hostName: String, players: String) {
        guard self.code != code else { return }
        // A rematch is a new code on the same link: keep the session, so the
        // other phone stays connected and follows the game's `next` itself.
        advertiser?.stopAdvertisingPeer()
        let session: MCSession
        if let existing = self.session {
            session = existing
        } else {
            session = MCSession(peer: MCPeerID(displayName: NearbyService.peerName(hostName)),
                                securityIdentity: nil, encryptionPreference: .required)
            session.delegate = self
        }
        let peer = session.myPeerID
        let advertiser = MCNearbyServiceAdvertiser(
            peer: peer, discoveryInfo: ["code": code, "players": String(players.prefix(80))],
            serviceType: NearbyService.type)
        advertiser.delegate = self
        advertiser.startAdvertisingPeer()
        self.session = session
        self.advertiser = advertiser
        self.code = code
        problem = nil
    }

    func stop() {
        advertiser?.stopAdvertisingPeer()
        session?.disconnect()
        advertiser = nil
        session = nil
        code = nil
        connected = []
    }

    fileprivate func refreshConnected() {
        connected = session?.connectedPeers.map(\.displayName) ?? []
    }

    fileprivate func answer(_ data: Data, from peer: PeerRef) async {
        guard let session, let reply = await responder.answer(data) else { return }
        try? session.send(reply, toPeers: [peer.id], with: .reliable)
    }

    fileprivate func accept(_ invitation: InvitationReply) {
        invitation.reply(session != nil, session)
    }

    fileprivate func failedToAdvertise(_ message: String) {
        problem = message
    }
}

extension NearbyHost: MCSessionDelegate {
    nonisolated func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        Task { @MainActor in self.refreshConnected() }
    }

    nonisolated func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        let peer = PeerRef(id: peerID)
        Task { @MainActor in await self.answer(data, from: peer) }
    }

    nonisolated func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String,
                             fromPeer peerID: MCPeerID) {}
    nonisolated func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String,
                             fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String,
                             fromPeer peerID: MCPeerID, at localURL: URL?, withError error: (any Error)?) {}
}

extension NearbyHost: MCNearbyServiceAdvertiserDelegate {
    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                                withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        // Anyone nearby may join, as anyone with the code may online: the
        // seats are still first come, first served, and the dealer frees them.
        let invitation = InvitationReply(reply: invitationHandler)
        Task { @MainActor in self.accept(invitation) }
    }

    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: any Error) {
        let message = "Couldn’t let nearby phones find this one: \(error.localizedDescription)"
        Task { @MainActor in self.failedToAdvertise(message) }
    }
}

// MARK: - the guest

/// The phone playing someone else's offline game: finds nearby hosts, joins
/// one, and carries the table's calls to it. If the link drops, it looks for
/// the same host again and rejoins.
@Observable
final class NearbyGuest: NSObject {
    static let shared = NearbyGuest()

    struct Host: Identifiable, Equatable {
        let peer: PeerRef
        let name: String
        let code: String
        let players: String
        var id: String { "\(name)·\(code)" }
    }

    enum Status: Equatable {
        case idle, looking
        case connecting(Host)
        case connected(Host)
        /// Was connected; looking for it again.
        case lost(Host)
    }

    private(set) var hosts: [Host] = []
    private(set) var status: Status = .idle
    /// Why the last join didn't work, for the join sheet.
    private(set) var problem: String?

    @ObservationIgnored private var me: MCPeerID?
    @ObservationIgnored private var session: MCSession?
    @ObservationIgnored private var browser: MCNearbyServiceBrowser?
    @ObservationIgnored private var wanted: Host?
    /// Was playing with `wanted` — so a dropped link is worth chasing.
    @ObservationIgnored private var wasConnected = false
    @ObservationIgnored private var retries = 0
    @ObservationIgnored private var pending: [UUID: CheckedContinuation<NearbyResponse, any Error>] = [:]

    /// The table's way to the host. Make one per game screen.
    var transport: NearbyTransport {
        NearbyTransport { [weak self] request in
            guard let self else { throw NearbyService.lostTouch }
            return try await self.send(request)
        }
    }

    /// Start looking for phones hosting a game nearby.
    func look(as name: String) {
        if browser == nil {
            let me = MCPeerID(displayName: NearbyService.peerName(name))
            let session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
            session.delegate = self
            let browser = MCNearbyServiceBrowser(peer: me, serviceType: NearbyService.type)
            browser.delegate = self
            self.me = me
            self.session = session
            self.browser = browser
        }
        browser?.startBrowsingForPeers()
        if status == .idle { status = .looking }
    }

    func join(_ host: Host) {
        guard let browser, let session else { return }
        wanted = host
        wasConnected = false
        problem = nil
        status = .connecting(host)
        browser.invitePeer(host.peer.id, to: session, withContext: nil, timeout: 20)
    }

    /// Done with nearby play: drop the link and stop looking.
    func leave() {
        browser?.stopBrowsingForPeers()
        session?.disconnect()
        for continuation in pending.values { continuation.resume(throwing: NearbyService.lostTouch) }
        pending = [:]
        browser = nil
        session = nil
        me = nil
        wanted = nil
        wasConnected = false
        retries = 0
        hosts = []
        status = .idle
    }

    private func send(_ request: NearbyRequest) async throws -> NearbyResponse {
        guard case .connected(let host) = status, let session else { throw NearbyService.lostTouch }
        let data = try JSONEncoder().encode(request)
        try session.send(data, toPeers: [host.peer.id], with: .reliable)
        return try await withCheckedThrowingContinuation { continuation in
            pending[request.id] = continuation
            Task {
                try? await Task.sleep(for: .seconds(6))
                self.pending.removeValue(forKey: request.id)?.resume(throwing: NearbyService.lostTouch)
            }
        }
    }

    // Callbacks, back on the main actor.

    fileprivate func received(_ data: Data) {
        guard let response = try? JSONDecoder().decode(NearbyResponse.self, from: data) else { return }
        pending.removeValue(forKey: response.id)?.resume(returning: response)
    }

    fileprivate func changed(_ peer: PeerRef, to state: MCSessionState) {
        guard let wanted, wanted.peer == peer else { return }
        switch state {
        case .connected:
            status = .connected(wanted)
            wasConnected = true
            retries = 0
        case .connecting:
            if case .connected = status { return }
            status = .connecting(wanted)
        case .notConnected:
            for continuation in pending.values { continuation.resume(throwing: NearbyService.lostTouch) }
            pending = [:]
            guard wasConnected else {
                // Never got in: the invitation was turned down or timed out.
                self.wanted = nil
                status = .looking
                problem = "Couldn’t join \(wanted.name)’s game — try again, with the phones close together."
                return
            }
            status = .lost(wanted)
            retryLater(peer)
        @unknown default:
            break
        }
    }

    /// A dropped link, tried again every couple of seconds for a while —
    /// `found` also rejoins if the host turns up as a new peer.
    private func retryLater(_ peer: PeerRef) {
        guard retries < 15 else { return }
        retries += 1
        Task {
            try? await Task.sleep(for: .seconds(2))
            guard case .lost(let host) = self.status, host.peer == peer,
                  let browser = self.browser, let session = self.session else { return }
            browser.invitePeer(peer.id, to: session, withContext: nil, timeout: 10)
        }
    }

    fileprivate func found(_ host: Host) {
        hosts.removeAll { $0.id == host.id }
        hosts.append(host)
        // The host we were playing came back as a new peer. By name, not
        // code: after a rematch it's advertising the new game's code.
        if case .lost(let old) = status, old.name == host.name, let browser, let session {
            wanted = host
            status = .connecting(host)
            browser.invitePeer(host.peer.id, to: session, withContext: nil, timeout: 20)
        }
    }

    fileprivate func lost(_ peer: PeerRef) {
        hosts.removeAll { $0.peer == peer }
    }
}

extension NearbyGuest: MCSessionDelegate {
    nonisolated func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let peer = PeerRef(id: peerID)
        Task { @MainActor in self.changed(peer, to: state) }
    }

    nonisolated func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        Task { @MainActor in self.received(data) }
    }

    nonisolated func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String,
                             fromPeer peerID: MCPeerID) {}
    nonisolated func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String,
                             fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String,
                             fromPeer peerID: MCPeerID, at localURL: URL?, withError error: (any Error)?) {}
}

extension NearbyGuest: MCNearbyServiceBrowserDelegate {
    nonisolated func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID,
                             withDiscoveryInfo info: [String: String]?) {
        guard let code = info?["code"] else { return }
        let host = Host(peer: PeerRef(id: peerID), name: peerID.displayName, code: code, players: info?["players"] ?? "")
        Task { @MainActor in self.found(host) }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        let peer = PeerRef(id: peerID)
        Task { @MainActor in self.lost(peer) }
    }
}
