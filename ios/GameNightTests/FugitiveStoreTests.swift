import Foundation
import Testing
@testable import GameNight

/// The table in motion: what the store holds back while a move plays out,
/// and that it always lets it land.
@MainActor @Suite struct FugitiveStoreTests {
    func settle(_ store: FugitiveStore) async throws {
        for _ in 0..<100 where store.animating { try await Task.sleep(for: .milliseconds(50)) }
        #expect(!store.animating)
    }

    @Test func aHideoutYouPlaceLandsOnTheTrailFaceUpToYou() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("store-\(UUID().uuidString)")
        let table = OfflineTable(shelf: OfflineShelf(folder: folder), computerDelay: 3600)
        let made = try table.create(you: .fugitive, name: "Ana", level: .easy)
        var device = FugitiveDevice(host: made.hostToken)
        device.setSeat(.fugitive, try await table.fugitiveClaim(code: made.code, role: .fugitive).seatToken)
        table.tokens.set(device, for: made.code)

        let store = FugitiveStore(code: made.code, transport: table)
        await store.refresh()
        try await settle(store)
        store.tap(1)
        await store.hide()
        try await settle(store)
        let game = try #require(store.game)
        #expect(game.hideouts.map(\.card) == [0, 1])
        #expect(store.landing.isEmpty)
    }
}
