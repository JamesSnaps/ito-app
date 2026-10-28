import Foundation

// Fugitive with no server: the room games/fugitive/game.py would keep,
// kept on this phone instead, and answering exactly as it does — the same
// payloads, the same tokens and seats, the same refusals — so FugitiveStore
// and the table screens can't tell the difference. The rules are
// FugitiveEngine, the Swift port of engine.py.
//
// A game is a file per code (Application Support/Fugitive/Offline), written
// after every change, like the server's saved rooms. It keeps the decks as
// they were before the deal and every move made, which is all the server
// needs to replay it once there's signal again (OfflineUploads).

/// One offline game: everything the server keeps for a room, and enough to
/// send it home.
nonisolated struct OfflineGame: Codable, Equatable {
    nonisolated struct Played: Codable, Equatable {
        var role: FugitiveRole
        var move: FugitiveMove
    }

    nonisolated enum Upload: Codable, Equatable {
        /// Not finished, or finished and still to be sent.
        case notYet
        case done
        /// The server wouldn't take it, and said why; not retried.
        case refused(String)
    }

    /// Sent with the upload, so a retried one isn't recorded twice.
    var id: String
    var code: String
    /// "fugitive" / "marshal" → name.
    var players: [String: String]
    /// The decks as they were before the deal, top card last.
    var decks: [[Int]]
    var moves: [Played]
    var state: FugitiveState
    var hostToken: String
    /// "fugitive" / "marshal" → that seat's token; a free seat isn't here.
    var seats: [String: String]
    var next: String?
    var createdAt: Date
    var finishedAt: Date?
    var upload: Upload

    func name(_ role: FugitiveRole) -> String { players[role.rawValue] ?? role.title }
}

/// Where offline games are kept: a JSON file per code.
struct OfflineShelf {
    var folder: URL

    static var standard: OfflineShelf {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return OfflineShelf(folder: base.appendingPathComponent("Fugitive/Offline", isDirectory: true))
    }

    func load(_ code: String) -> OfflineGame? {
        guard Joining.isCode(code), let data = try? Data(contentsOf: file(code)) else { return nil }
        return try? JSONDecoder().decode(OfflineGame.self, from: data)
    }

    func save(_ game: OfflineGame) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(game).write(to: file(game.code), options: .atomic)
    }

    func delete(_ code: String) {
        try? FileManager.default.removeItem(at: file(code))
    }

    func all() -> [OfflineGame] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(OfflineGame.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private func file(_ code: String) -> URL { folder.appendingPathComponent("\(code).json") }
}

/// The offline "server". One for the app; a nearby phone's requests are
/// answered by the same one (NearbyHost), so both phones play one game.
final class OfflineTable: FugitiveTransport {
    static let shared = OfflineTable()

    let shelf: OfflineShelf
    var tokens: FugitiveTokens { .offline }
    /// Games read or written this session: the table asks every second.
    private var cache: [String: OfflineGame] = [:]

    init(shelf: OfflineShelf = .standard) {
        self.shelf = shelf
    }

    func inviteURL(code: String) -> URL? { nil }

    // MARK: - dealing

    /// A new game, shuffled on this phone (or dealt from `decks`, top card
    /// last, when a test rigs one). Answers as the server's create does:
    /// the table's view, with the dealer's token.
    func create(fugitive: String, marshal: String, decks rigged: [[Int]]? = nil) throws -> FugitivePayload {
        var rng = SystemRandomNumberGenerator()
        let decks = rigged ?? FugitiveEngine.deckRanges.map { Array($0).shuffled(using: &rng) }
        let game = OfflineGame(
            id: UUID().uuidString, code: freshCode(), players: ["fugitive": fugitive, "marshal": marshal],
            decks: decks, moves: [], state: FugitiveEngine.newGame(decks: decks), hostToken: Self.newToken(),
            seats: [:], next: nil, createdAt: Date(), finishedAt: nil, upload: .notYet)
        try save(game)
        return payload(game, token: game.hostToken).with(hostToken: game.hostToken)
    }

    // MARK: - the server's API, answered here

    func fugitiveState(code: String, token: String?) async throws -> FugitivePayload {
        payload(try game(code), token: token)
    }

    func fugitiveMove(code: String, _ move: FugitiveMove, token: String) async throws -> FugitivePayload {
        var game = try game(code)
        guard case .seat(let role) = identify(game, token) else {
            throw Self.refusal(403, "Only the two players can move — sit down first.")
        }
        guard move.seq == game.state.seq else {
            throw Self.refusal(409, "The game had moved on — this is the latest.")
        }
        do {
            game.state = try FugitiveEngine.apply(game.state, role: role, move: move)
        } catch let refusal as IllegalMove {
            throw Self.refusal(400, refusal.message)
        }
        game.moves.append(.init(role: role, move: move))
        if game.state.phase == .gameOver && game.finishedAt == nil { game.finishedAt = Date() }
        try save(game)
        return payload(game, token: token)
    }

    func fugitiveClaim(code: String, role: FugitiveRole) async throws -> FugitivePayload {
        var game = try game(code)
        guard game.seats[role.rawValue] == nil else {
            throw Self.refusal(409, "Someone's already sitting there.")
        }
        let token = Self.newToken()
        game.seats[role.rawValue] = token
        try save(game)
        return payload(game, token: token).with(seatToken: token)
    }

    func fugitiveRelease(code: String, role: FugitiveRole, token: String) async throws -> FugitivePayload {
        var game = try game(code)
        guard case .host = identify(game, token) else {
            throw Self.refusal(403, "Only the device that dealt can free a seat.")
        }
        game.seats[role.rawValue] = nil
        try save(game)
        return payload(game, token: token)
    }

    func fugitiveRematch(code: String, token: String) async throws -> FugitiveRematch {
        var game = try game(code)
        guard case .host = identify(game, token) else {
            throw Self.refusal(403, "Only the device that dealt can start a rematch.")
        }
        guard game.state.phase == .gameOver else { throw Self.refusal(400, "This game isn't over yet.") }
        if game.next == nil {
            // The same two, roles swapped, and each seat's token goes with its player.
            var rng = SystemRandomNumberGenerator()
            let decks = FugitiveEngine.deckRanges.map { Array($0).shuffled(using: &rng) }
            var seats: [String: String] = [:]
            seats["fugitive"] = game.seats["marshal"]
            seats["marshal"] = game.seats["fugitive"]
            let fresh = OfflineGame(
                id: UUID().uuidString, code: freshCode(),
                players: ["fugitive": game.name(.marshal), "marshal": game.name(.fugitive)],
                decks: decks, moves: [], state: FugitiveEngine.newGame(decks: decks), hostToken: game.hostToken,
                seats: seats, next: nil, createdAt: Date(), finishedAt: nil, upload: .notYet)
            try save(fresh)
            game.next = fresh.code
            try save(game)
        }
        return FugitiveRematch(code: game.next ?? code, hostToken: game.hostToken)
    }

    /// A saved game, for the screens around the table.
    func saved(_ code: String) -> OfflineGame? { try? game(code) }

    /// Change a saved game outside play — its upload status.
    func update(_ code: String, _ change: (inout OfflineGame) -> Void) {
        guard var game = try? game(code) else { return }
        change(&game)
        try? save(game)
    }

    // MARK: - inside

    private enum Who { case host, seat(FugitiveRole), nobody }

    private func identify(_ game: OfflineGame, _ token: String?) -> Who {
        guard let token, !token.isEmpty else { return .nobody }
        if token == game.hostToken { return .host }
        for role in FugitiveRole.allCases where game.seats[role.rawValue] == token { return .seat(role) }
        return .nobody
    }

    /// game.payload: the game as this token may see it, who's sitting where
    /// (whether a seat is taken, never by whom), and who the token is.
    func payload(_ game: OfflineGame, token: String?) -> FugitivePayload {
        let who = identify(game, token)
        let you: FugitiveYou
        let viewer: FugitiveRole?
        switch who {
        case .host: (you, viewer) = (FugitiveYou(role: "host", seat: nil), nil)
        case .seat(let role): (you, viewer) = (FugitiveYou(role: "seat", seat: role), role)
        case .nobody: (you, viewer) = (FugitiveYou(role: nil, seat: nil), nil)
        }
        return FugitivePayload(
            code: game.code,
            players: game.players,
            seats: Dictionary(uniqueKeysWithValues: FugitiveRole.allCases.map {
                ($0.rawValue, FugitiveSeat(taken: game.seats[$0.rawValue] != nil))
            }),
            you: you,
            game: FugitiveEngine.view(game.state, viewer: viewer),
            next: game.next,
            hostToken: nil, inviteUrl: nil, seatToken: nil, error: nil)
    }

    private func game(_ code: String) throws -> OfflineGame {
        if let game = cache[code] { return game }
        guard let game = shelf.load(code) else { throw Self.refusal(404, "That game has ended or expired.") }
        cache[code] = game
        return game
    }

    private func save(_ game: OfflineGame) throws {
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

    static func newToken() -> String {
        var rng = SystemRandomNumberGenerator()
        let bytes = (0..<12).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func refusal(_ status: Int, _ message: String) -> GameNightClient.Failure {
        .server(status: status, message: message, payload: nil)
    }
}

extension FugitivePayload {
    nonisolated func with(hostToken: String? = nil, seatToken: String? = nil) -> FugitivePayload {
        FugitivePayload(code: code, players: players, seats: seats, you: you, game: game, next: next,
                        hostToken: hostToken ?? self.hostToken, inviteUrl: inviteUrl,
                        seatToken: seatToken ?? self.seatToken, error: error)
    }
}
