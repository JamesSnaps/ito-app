import Foundation
import Network

/// Whether the device has a usable network right now — for choosing where a
/// game is kept before anyone has to find out the hard way.
enum Connectivity {
    /// The current path, as soon as the system reports it (never longer than
    /// a second; no answer counts as online, the way things were before).
    nonisolated static func online() async -> Bool {
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
