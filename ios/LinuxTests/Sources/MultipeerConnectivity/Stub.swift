// Harness only: MultipeerConnectivity's shape, so NearbyLink.swift type-checks
// on Linux. Nothing here works; the signatures are Apple's.
@_exported import Foundation

open class MCPeerID: NSObject {
    public let displayName: String
    public init(displayName: String) { self.displayName = displayName }
}
public enum MCEncryptionPreference: Int, Sendable { case optional, required, none }
public enum MCSessionState: Int, Sendable { case notConnected, connecting, connected }
public enum MCSessionSendDataMode: Int, Sendable { case reliable, unreliable }

public protocol MCSessionDelegate: NSObjectProtocol {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState)
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID)
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID)
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress)
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: (any Error)?)
}
open class MCSession: NSObject {
    public weak var delegate: (any MCSessionDelegate)?
    public var connectedPeers: [MCPeerID] { [] }
    public init(peer myPeerID: MCPeerID, securityIdentity identity: [Any]?, encryptionPreference: MCEncryptionPreference) {}
    open func send(_ data: Data, toPeers peerIDs: [MCPeerID], with mode: MCSessionSendDataMode) throws {}
    open func disconnect() {}
}

public protocol MCNearbyServiceAdvertiserDelegate: NSObjectProtocol {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void)
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: any Error)
}
open class MCNearbyServiceAdvertiser: NSObject {
    public weak var delegate: (any MCNearbyServiceAdvertiserDelegate)?
    public init(peer myPeerID: MCPeerID, discoveryInfo info: [String: String]?, serviceType: String) {}
    open func startAdvertisingPeer() {}
    open func stopAdvertisingPeer() {}
}

public protocol MCNearbyServiceBrowserDelegate: NSObjectProtocol {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?)
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID)
}
open class MCNearbyServiceBrowser: NSObject {
    public weak var delegate: (any MCNearbyServiceBrowserDelegate)?
    public init(peer myPeerID: MCPeerID, serviceType: String) {}
    open func startBrowsingForPeers() {}
    open func stopBrowsingForPeers() {}
    open func invitePeer(_ peerID: MCPeerID, to session: MCSession, withContext context: Data?, timeout: TimeInterval) {}
}
