import Foundation

// Wildwood with no server: the room games/wildwood/game.py would keep, kept
// on this phone instead and answering exactly as it does — the same
// payloads, tokens, seats and refusals — so WildwoodStore and the table
// screen can't tell the difference. The rules are WildwoodEngine, the Swift
// port of engine.py; the computer is WildwoodAI, the port of ai.py.
//
// A game is a file per code (Application Support/Wildwood/Offline), written
// after every change. It keeps the deck as it was before the deal, the
// reshuffle seed and every move, which is all the server needs to replay it
// once there's signal (WildwoodOfflineUploads). Other phones nearby play it
// through this same table (WildwoodNearby.swift).

/// One offline game: everything the server keeps for a room, and enough to
/// send it home.
nonisolated struct WildwoodOfflineGame: Codable, Equatable {
    nonisolated struct Played: Codable, Equatable {
        var seat: Int
        var move: WildwoodMove
    }

    nonisolated struct Computer: Codable, Equatable {
        var seats: [Int]
        var level: WildwoodAI.Level
        var seed: UInt32
    }

    /// Sent with the upload, so a retried one isn't recorded twice.
    var id: String
    var code: String
    var players: [String]
    /// The deck before the deal, top card last, and the reshuffle seed.
    var deck: [String]
    var shuffleSeed: UInt32
    var first: Int
    var moves: [Played]
    var state: WildwoodState
    var hostToken: String
    /// Seat number (as a string) → that seat's token; a free seat isn't here.
    var seats: [String: String]
    var next: String?
    var createdAt: Date
    var finishedAt: Date?
    var upload: OfflineGame.Upload
    var computer: Computer?
    /// When the last move was made: the computer waits `computerDelay` after it.
    var movedAt: Date?
}

/// Where offline Wildwood games are kept: a JSON file per code.
struct WildwoodShelf {
    var folder: URL

    static var standard: WildwoodShelf {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return WildwoodShelf(folder: base.appendingPathComponent("Wildwood/Offline", isDirectory: true))
    }

    func load(_ code: String) -> WildwoodOfflineGame? {
        guard Joining.isCode(code), let data = try? Data(contentsOf: file(code)) else { return nil }
        return try? JSONDecoder().decode(WildwoodOfflineGame.self, from: data)
    }

    func save(_ game: WildwoodOfflineGame) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(game).write(to: file(game.code), options: .atomic)
    }

    func delete(_ code: String) { try? FileManager.default.removeItem(at: file(code)) }

    func all() -> [WildwoodOfflineGame] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(WildwoodOfflineGame.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private func file(_ code: String) -> URL { folder.appendingPathComponent("\(code).json") }
}

extension WildwoodTokens {
    /// Games kept on this phone, and seats in games other phones keep —
    /// shelves of their own, so their codes can't collide with the server's.
    static let offline = WildwoodTokens(scope: "offline.")
    static let nearby = WildwoodTokens(scope: "nearby.")
}

/// The offline "server". One for the app; nearby phones' requests are
/// answered by the same one, so every phone plays one game.
final class WildwoodOfflineTable: WildwoodTransport {
    static let shared = WildwoodOfflineTable()
    /// game.py's COMPUTER_DELAY.
    static let computerDelay: TimeInterval = 1.5
    /// game.py's COMPUTER_NAMES.
    static let computerNames = ["Hedgehog", "Rabbit", "Squirrel", "Mole"]

    let shelf: WildwoodShelf
    let computerDelay: TimeInterval
    var wildwoodTokens: WildwoodTokens { .offline }
    private var cache: [String: WildwoodOfflineGame] = [:]

    init(shelf: WildwoodShelf = .standard, computerDelay: TimeInterval = WildwoodOfflineTable.computerDelay) {
        self.shelf = shelf
        self.computerDelay = computerDelay
    }

    func wildwoodInviteURL(code: String) -> URL? { nil }

    // MARK: - dealing

    /// A new table, shuffled on this phone (or dealt from `deck`, top card
    /// last, when a test rigs one): the people in seat order, and
    /// `computers` computer seats after them, as game.py's create.
    func create(players people: [String], computers: Int = 0, level: WildwoodAI.Level = .easy,
                deck rigged: [String]? = nil, shuffleSeed: UInt32? = nil, seed: UInt32? = nil) throws -> WildwoodPayload {
        let names = people.map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20)) }
        guard !names.isEmpty, !names.contains(where: \.isEmpty) else { throw Self.refusal(400, "every player needs a name") }
        guard (0...3).contains(computers), names.count + computers <= WildwoodEngine.maxPlayers else {
            throw Self.refusal(400, "at most \(WildwoodEngine.maxPlayers) at the table")
        }
        let taken = Set(names.map { $0.lowercased() })
        let table = names + Self.computerNames.filter { !taken.contains($0.lowercased()) }.prefix(computers)
        guard table.count >= WildwoodEngine.minPlayers else { throw Self.refusal(400, "2 to 4 players") }
        guard Set(table.map { $0.lowercased() }).count == table.count else {
            throw Self.refusal(400, "everyone needs a different name")
        }
        var rng = SystemRandomNumberGenerator()
        let computer = computers > 0
            ? WildwoodOfflineGame.Computer(seats: Array(names.count..<table.count), level: level, seed: seed ?? rng.next())
            : nil
        let game = try deal(players: table, computer: computer, hostToken: Self.newToken(), seats: [:], first: 0,
                            deck: rigged, shuffleSeed: shuffleSeed)
        return payload(game, token: game.hostToken).with(hostToken: game.hostToken)
    }

    private func deal(players: [String], computer: WildwoodOfflineGame.Computer?, hostToken: String,
                      seats carried: [String: String], first: Int, deck rigged: [String]?,
                      shuffleSeed: UInt32?) throws -> WildwoodOfflineGame {
        var rng = SystemRandomNumberGenerator()
        let deck = rigged ?? WildwoodEngine.fullDeck().shuffled(using: &rng)
        let seed = shuffleSeed ?? rng.next()
        var seats = carried
        // Taken, by tokens nobody is ever given.
        for seat in computer?.seats ?? [] where seats[String(seat)] == nil { seats[String(seat)] = Self.newToken() }
        let game = WildwoodOfflineGame(
            id: UUID().uuidString, code: freshCode(), players: players, deck: deck, shuffleSeed: seed, first: first,
            moves: [], state: WildwoodEngine.newGame(players: players.count, deck: deck, shuffleSeed: seed, first: first),
            hostToken: hostToken, seats: seats, next: nil, createdAt: Date(), finishedAt: nil, upload: .notYet,
            computer: computer, movedAt: Date())
        try save(game)
        return game
    }

    // MARK: - the server's API, answered here

    func wildwoodState(code: String, token: String?) async throws -> WildwoodPayload {
        var game = try game(code)
        if computerMoves(&game) { try save(game) }
        return payload(game, token: token)
    }

    func wildwoodMove(code: String, _ move: WildwoodMove, token: String) async throws -> WildwoodPayload {
        var game = try game(code)
        guard case .seat(let seat) = identify(game, token) else {
            throw Self.refusal(403, "Only the players can move — sit down first.")
        }
        guard move.seq == game.state.seq else { throw Self.refusal(409, "The game had moved on — this is the latest.") }
        do {
            try WildwoodEngine.apply(&game.state, seat: seat, move: move)
        } catch let refusal as IllegalMove {
            throw Self.refusal(400, refusal.message)
        }
        game.moves.append(.init(seat: seat, move: move))
        game.movedAt = Date()
        if game.state.phase == "game_over" && game.finishedAt == nil { game.finishedAt = Date() }
        try save(game)
        return payload(game, token: token)
    }

    func wildwoodClaim(code: String, seat: Int) async throws -> WildwoodPayload {
        var game = try game(code)
        guard game.players.indices.contains(seat) else { throw Self.refusal(404, "No such seat.") }
        guard game.seats[String(seat)] == nil else { throw Self.refusal(409, "Someone's already sitting there.") }
        let token = Self.newToken()
        game.seats[String(seat)] = token
        try save(game)
        return payload(game, token: token).with(seatToken: token)
    }

    func wildwoodRelease(code: String, seat: Int, token: String) async throws -> WildwoodPayload {
        var game = try game(code)
        guard game.players.indices.contains(seat) else { throw Self.refusal(404, "No such seat.") }
        guard case .host = identify(game, token) else { throw Self.refusal(403, "Only the device that dealt can free a seat.") }
        if game.computer?.seats.contains(seat) == true {
            throw Self.refusal(400, "The computer keeps its seat — start a new game instead.")
        }
        game.seats[String(seat)] = nil
        try save(game)
        return payload(game, token: token)
    }

    func wildwoodRematch(code: String, token: String) async throws -> WildwoodRematch {
        var game = try game(code)
        guard case .host = identify(game, token) else { throw Self.refusal(403, "Only the device that dealt can start a rematch.") }
        guard game.state.phase == "game_over" else { throw Self.refusal(400, "This game isn't over yet.") }
        if game.next == nil {
            // The same table, one seat further round; every token carries over.
            var rng = SystemRandomNumberGenerator()
            let computer = game.computer.map { WildwoodOfflineGame.Computer(seats: $0.seats, level: $0.level, seed: rng.next()) }
            let fresh = try deal(players: game.players, computer: computer, hostToken: game.hostToken, seats: game.seats,
                                 first: (game.first + 1) % game.players.count, deck: nil, shuffleSeed: nil)
            game.next = fresh.code
            try save(game)
        }
        return WildwoodRematch(code: game.next ?? code, hostToken: game.hostToken)
    }

    /// A saved game, for the screens around the table.
    func saved(_ code: String) -> WildwoodOfflineGame? { try? game(code) }

    func update(_ code: String, _ change: (inout WildwoodOfflineGame) -> Void) {
        guard var game = try? game(code) else { return }
        change(&game)
        try? save(game)
    }

    // MARK: - the computer

    /// game.py's computer_moves: one move, if it's a computer's turn and the
    /// last move has had time to play out. Returns whether it moved.
    @discardableResult
    func computerMoves(_ game: inout WildwoodOfflineGame, now: Date = Date()) -> Bool {
        guard let computer = game.computer, let seat = WildwoodEngine.turn(game.state), computer.seats.contains(seat) else {
            return false
        }
        if let moved = game.movedAt, now.timeIntervalSince(moved) < computerDelay { return false }
        let seen = WildwoodEngine.view(game.state, viewer: .seat(seat))
        var rng = FugitiveAI.moveRNG(seed: computer.seed, seq: game.state.seq)
        var move = WildwoodAI.choose(seen, level: computer.level, rng: &rng) ?? WildwoodAI.fallback(seen)
        move.seq = game.state.seq
        do {
            try WildwoodEngine.apply(&game.state, seat: seat, move: move)
        } catch {
            // A bug, which the fixture exists to stop: a plain draw beats a
            // table stuck on the computer's turn.
            move = WildwoodAI.fallback(seen)
            move.seq = game.state.seq
            guard (try? WildwoodEngine.apply(&game.state, seat: seat, move: move)) != nil else { return false }
        }
        game.moves.append(.init(seat: seat, move: move))
        game.movedAt = now
        if game.state.phase == "game_over" && game.finishedAt == nil { game.finishedAt = now }
        return true
    }

    // MARK: - inside

    private enum Who { case host, seat(Int), nobody }

    private func identify(_ game: WildwoodOfflineGame, _ token: String?) -> Who {
        guard let token, !token.isEmpty else { return .nobody }
        if token == game.hostToken { return .host }
        for (seat, held) in game.seats where held == token { if let n = Int(seat) { return .seat(n) } }
        return .nobody
    }

    /// game.payload: the game as this token may see it.
    func payload(_ game: WildwoodOfflineGame, token: String?) -> WildwoodPayload {
        let you: WildwoodYou
        let viewer: WildwoodViewer
        switch identify(game, token) {
        case .host: (you, viewer) = (WildwoodYou(role: "host", seat: nil), .table)
        case .seat(let seat): (you, viewer) = (WildwoodYou(role: "seat", seat: seat), .seat(seat))
        case .nobody: (you, viewer) = (WildwoodYou(role: nil, seat: nil), .table)
        }
        let computers = game.computer?.seats ?? []
        return WildwoodPayload(
            code: game.code, players: game.players,
            seats: game.players.indices.map { WildwoodSeat(taken: game.seats[String($0)] != nil, computer: computers.contains($0)) },
            you: you, game: WildwoodEngine.view(game.state, viewer: viewer), next: game.next,
            computer: game.computer.map { WildwoodComputer(seats: $0.seats, level: $0.level.rawValue) })
    }

    private func game(_ code: String) throws -> WildwoodOfflineGame {
        if let game = cache[code] { return game }
        guard let game = shelf.load(code) else { throw Self.refusal(404, "That game has ended or expired.") }
        cache[code] = game
        return game
    }

    private func save(_ game: WildwoodOfflineGame) throws {
        do {
            try shelf.save(game)
            cache[game.code] = game
        } catch {
            throw Self.refusal(500, "This phone couldn’t save the game: \(error.localizedDescription)")
        }
    }

    private func freshCode() -> String {
        let alphabet = Array(Joining.alphabet)
        while true {
            let code = String((0..<4).map { _ in alphabet.randomElement()! })
            if cache[code] == nil && shelf.load(code) == nil { return code }
        }
    }

    static func newToken() -> String { OfflineTable.newToken() }

    static func refusal(_ status: Int, _ message: String) -> GameNightClient.Failure {
        .server(status: status, message: message, payload: nil)
    }
}

extension WildwoodPayload {
    nonisolated func with(hostToken: String? = nil, seatToken: String? = nil) -> WildwoodPayload {
        var copy = self
        if let hostToken { copy.hostToken = hostToken }
        if let seatToken { copy.seatToken = seatToken }
        return copy
    }
}

// MARK: - coming home

/// An offline game, as `POST /wildwood/api/offline` takes it.
nonisolated struct WildwoodUploadBody: Encodable {
    nonisolated struct Step: Encodable {
        let seat: Int
        let move: WildwoodMove
    }
    nonisolated struct Computer: Encodable, Equatable {
        let seats: [Int]
        let level: String
        let seed: UInt32
    }
    let id: String
    let players: [String]
    let deck: [String]
    let shuffleSeed: UInt32
    let first: Int
    let moves: [Step]
    let playedAt: String?
    var computer: Computer? = nil

    enum CodingKeys: String, CodingKey {
        case id, players, deck, first, moves, computer
        case shuffleSeed = "shuffle_seed"
        case playedAt = "played_at"
    }
}

extension GameNightClient {
    func wildwoodUploadOffline(_ body: WildwoodUploadBody) async throws -> OfflineUploadResult {
        try await send("POST", "wildwood/api/offline", body: body)
    }
}

/// Finished offline games going home once there's signal, as Fugitive's
/// OfflineUploads: tried quietly when the hub or the records appear and
/// when a game ends. A 4xx is remembered, not retried.
enum WildwoodOfflineUploads {
    private static var sending = false

    static func waiting(on shelf: WildwoodShelf = .standard) -> [WildwoodOfflineGame] {
        shelf.all().filter { $0.finishedAt != nil && $0.upload == .notYet }.reversed()
    }

    @discardableResult
    static func sendWaiting(client: GameNightClient = AppSettings.client,
                            table: WildwoodOfflineTable = .shared) async -> Int {
        guard !sending else { return 0 }
        sending = true
        defer { sending = false }
        var sent = 0
        for game in waiting(on: table.shelf) {
            let outcome: OfflineGame.Upload
            do {
                _ = try await client.wildwoodUploadOffline(body(for: game))
                outcome = .done
                sent += 1
            } catch let failure as GameNightClient.Failure {
                switch failure {
                case .server(let status, let message, _) where (400..<500).contains(status):
                    outcome = .refused(message)
                default:
                    return sent
                }
            } catch {
                return sent
            }
            table.update(game.code) { $0.upload = outcome }
        }
        prune(table.shelf)
        return sent
    }

    static func body(for game: WildwoodOfflineGame) -> WildwoodUploadBody {
        WildwoodUploadBody(
            id: game.id, players: game.players, deck: game.deck, shuffleSeed: game.shuffleSeed, first: game.first,
            moves: game.moves.map { .init(seat: $0.seat, move: $0.move) },
            playedAt: game.finishedAt.map { $0.formatted(.iso8601) },
            computer: game.computer.map { .init(seats: $0.seats, level: $0.level.rawValue, seed: $0.seed) })
    }

    /// Sent (or refused) a week ago, or abandoned for a month. A finished
    /// game is never thrown away unsent.
    static func prune(_ shelf: WildwoodShelf, now: Date = Date()) {
        for game in shelf.all() {
            let age = now.timeIntervalSince(game.finishedAt ?? game.createdAt)
            let sent = game.upload != .notYet
            if (sent && age > 7 * 86_400) || (game.finishedAt == nil && age > 30 * 86_400) {
                shelf.delete(game.code)
            }
        }
    }
}
