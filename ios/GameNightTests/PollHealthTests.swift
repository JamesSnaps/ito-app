import Foundation
import Testing
@testable import GameNight

/// "Reconnecting…" on a table: when a poor signal shows, and when it goes.
@MainActor @Suite struct PollHealthTests {
    struct Dropped: Error {}

    @Test func oneMissIsABlipTwoAreASignal() async {
        let health = PollHealth()
        _ = try? await health.track { () async throws -> Int in throw Dropped() }
        #expect(!health.struggling)
        _ = try? await health.track { () async throws -> Int in throw Dropped() }
        #expect(health.struggling)
        _ = try? await health.track { 1 }
        #expect(!health.struggling)
    }

    @Test func anAnswerFromTheServerIsAConnection() async {
        let health = PollHealth(allowed: 1)
        _ = try? await health.track { () async throws -> Int in throw Dropped() }
        #expect(health.struggling)
        // A refusal is still the server talking.
        _ = try? await health.track { () async throws -> Int in
            throw GameNightClient.Failure.server(status: 409, message: "Not your turn.", payload: nil)
        }
        #expect(!health.struggling)
    }

    @Test func aPollThatHangsShowsBeforeItTimesOut() async throws {
        let health = PollHealth(patience: .milliseconds(50))
        // The poll hangs until let go, however busy the main actor is.
        let (gate, letGo) = AsyncStream<Void>.makeStream()
        let poll = Task { try await health.track { for await _ in gate { break }; return 1 } }
        for _ in 0..<100 where !health.struggling { try await Task.sleep(for: .milliseconds(50)) }
        #expect(health.struggling)
        letGo.yield()
        letGo.finish()
        _ = try await poll.value
        #expect(!health.struggling)
    }

    @Test func aServerNobodyAnswersOnIsNotReachable() async {
        // Nothing listens on the discard port: refused at once, not a hang.
        let client = GameNightClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        #expect(await client.reachable(within: 2) == false)
    }
}
