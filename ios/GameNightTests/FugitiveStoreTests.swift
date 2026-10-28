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

    /// A whole game as the Fugitive, hiding on the card just drawn whenever
    /// it can (with sprints if it must) — the move that once left 25 in the
    /// case notes and off the trail. Every hideout has to land.
    @Test func everyHideoutLandsOverAWholeGame() async throws {
        for _ in 0..<1 {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("store-\(UUID().uuidString)")
            let table = OfflineTable(shelf: OfflineShelf(folder: folder), computerDelay: 0)
            let made = try table.create(you: .fugitive, name: "Ana", level: .easy)
            var device = FugitiveDevice(host: made.hostToken)
            device.setSeat(.fugitive, try await table.fugitiveClaim(code: made.code, role: .fugitive).seatToken)
            table.tokens.set(device, for: made.code)

            let store = FugitiveStore(code: made.code, transport: table)
            var drawn: Int?
            for _ in 0..<300 {
                await store.refresh()
                try await settle(store)
                let game = try #require(store.game)
                #expect(store.landing.isEmpty)
                #expect(game.hideouts.count - 1 == game.log.filter { $0.kind == "hid" }.count)
                if game.isOver { break }
                guard game.turn == .fugitive, game.viewerRole == .fugitive else { continue }
                if game.phase == .fugitiveDraw {
                    let before = Set(game.hand ?? [])
                    let deck = game.deckCounts.lastIndex(where: { $0 > 0 }) ?? 0
                    await store.draw(from: deck)
                    try await settle(store)
                    drawn = Set(store.game?.hand ?? []).subtracting(before).first
                } else if game.phase == .fugitiveHide {
                    let hand = game.hand ?? []
                    if let card = drawn, hand.contains(card) { store.tap(card) }
                    if store.pick == nil, let card = hand.first(where: { store.hiding.canTap($0, in: game) }) { store.tap(card) }
                    for card in hand where !store.canHide && card != store.pick { store.tap(card) }
                    if store.canHide { await store.hide() } else { await store.pass() }
                    try await settle(store)
                    drawn = nil
                }
            }
            #expect(store.game?.isOver == true)
        }
    }
}
