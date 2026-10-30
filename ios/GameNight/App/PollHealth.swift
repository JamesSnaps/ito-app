import Foundation
import Observation

/// Whether a table's polls are getting through. A missed poll is retried on
/// the next tick, and that's right for a blip — but on a poor signal the
/// table just stopped moving, and looked broken rather than out of reach.
/// `struggling` is what puts "Reconnecting…" over it.
@Observable
final class PollHealth {
    private(set) var struggling = false
    @ObservationIgnored private var misses = 0

    /// Slower than this and the poll counts as struggling before it's
    /// answered: a request on one bar hangs for its whole timeout first.
    @ObservationIgnored let patience: Duration
    /// Polls in a row that failed outright.
    @ObservationIgnored let allowed: Int

    init(patience: Duration = .seconds(4), allowed: Int = 2) {
        self.patience = patience
        self.allowed = allowed
    }

    /// Runs one poll and keeps count. Any answer from the server, an error
    /// status included, means the connection is fine.
    func track<T>(_ poll: () async throws -> T) async throws -> T {
        let slow = Task { [patience] in
            try? await Task.sleep(for: patience)
            if !Task.isCancelled { self.struggling = true }
        }
        defer { slow.cancel() }
        do {
            let answer = try await poll()
            heard()
            return answer
        } catch let failure as GameNightClient.Failure where failure.status != nil {
            heard()
            throw failure
        } catch {
            // Leaving the table cancels its poll: that's not the signal.
            if !Task.isCancelled {
                misses += 1
                if misses >= allowed { struggling = true }
            }
            throw error
        }
    }

    private func heard() {
        misses = 0
        struggling = false
    }
}
