import Foundation
import Network

/// Whether a game can be kept on the server right now — for choosing where a
/// game is kept before anyone has to find out the hard way.
enum Connectivity {
    /// The phone has a network, and the server answers on it within a couple
    /// of seconds. The network alone said yes to one bar of signal, a hotel's
    /// sign-in page or Wi-Fi whose broadband was down, and dealing then sat
    /// out a ten-second timeout before saying "No signal?".
    static func online() async -> Bool {
        guard await hasNetwork() else { return false }
        return await AppSettings.client.reachable()
    }

    /// The current path, as soon as the system reports it (never longer than
    /// a second; no answer counts as a network, the way things were before).
    nonisolated static func hasNetwork() async -> Bool {
        await withCheckedContinuation { continuation in
            let monitor = NWPathMonitor()
            let once = Once()
            monitor.pathUpdateHandler = { path in
                if once.claim() {
                    monitor.cancel()
                    continuation.resume(returning: path.status == .satisfied)
                }
            }
            monitor.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                if once.claim() {
                    monitor.cancel()
                    continuation.resume(returning: true)
                }
            }
        }
    }

    /// Resumes the continuation exactly once, whichever answer comes first.
    private nonisolated final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func claim() -> Bool {
            lock.lock(); defer { lock.unlock() }
            if done { return false }
            done = true
            return true
        }
    }
}
