import SwiftUI

/// Fugitive's records — /fugitive/stats in the app: the leaderboard in the
/// server's order, each player's record in both roles, and recent games;
/// then games against the computer, kept apart from the leaderboard.
struct FugitiveRecordsView: View {
    @State private var stats: FugitiveStats?
    @State private var error: String?
    /// Offline games still on this phone: waiting for signal, or refused.
    @State private var waiting = 0
    @State private var refused = 0
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ZStack {
            DeskBackground().ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if waiting > 0 {
                        Label("\(waiting) offline game\(waiting == 1 ? "" : "s") on this phone will be added once there’s signal.",
                              systemImage: "airplane")
                            .font(.footnote).foregroundStyle(Noir.card.opacity(0.8))
                    }
                    if refused > 0 {
                        Label("\(refused) offline game\(refused == 1 ? "" : "s") couldn’t be added — the server didn’t accept \(refused == 1 ? "it" : "them").",
                              systemImage: "exclamationmark.triangle")
                            .font(.footnote).foregroundStyle(Noir.miss)
                    }
                    if let stats {
                        Text(Self.played(stats))
                            .font(Noir.type(15)).foregroundStyle(Noir.card.opacity(0.75))
                        let columns = sizeClass == .regular
                            ? AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                            : AnyLayout(VStackLayout(spacing: 16))
                        columns {
                            NoirPanel(title: "Most wanted") {
                                if stats.leaderboard.isEmpty {
                                    Text(stats.computerLeaderboard?.isEmpty == false
                                         ? "No games between people yet."
                                         : "No games yet. Finished games are recorded here automatically.")
                                        .font(.subheadline).foregroundStyle(Noir.card.opacity(0.7))
                                }
                                ForEach(Array(stats.leaderboard.enumerated()), id: \.offset) { rank, row in
                                    leaderRow(rank, row)
                                }
                            }
                            if !stats.recent.isEmpty {
                                NoirPanel(title: "Recent games") {
                                    ForEach(Array(stats.recent.enumerated()), id: \.offset) { _, game in
                                        recentRow(game)
                                    }
                                }
                                .frame(maxWidth: sizeClass == .regular ? 380 : .infinity)
                            }
                        }
                        if let rows = stats.computerLeaderboard, !rows.isEmpty {
                            computerPanel(rows, recent: stats.computer?.recent ?? [])
                        }
                    } else if let error {
                        NoirPanel(title: "Records") { Text(error) }
                    } else {
                        ProgressView().tint(Noir.card).frame(maxWidth: .infinity)
                    }
                }
                .padding(sizeClass == .regular ? 32 : 20)
                .frame(maxWidth: sizeClass == .regular ? 980 : 640)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await load() }
        }
        .navigationTitle("Fugitive records")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Noir.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            await Faces.shared.load()
            await OfflineUploads.sendWaiting()
            countOffline()
            await load()
        }
        .preferredColorScheme(.dark)
    }

    private func leaderRow(_ rank: Int, _ row: FugitiveStats.Row) -> some View {
        HStack(spacing: 10) {
            Text("\(rank + 1)").font(Noir.poster(18)).foregroundStyle(Noir.card.opacity(0.5))
                .frame(width: 20, alignment: .leading)
            // A face in the role they've won more in.
            Mugshot(name: row.name, role: row.marshalWins > row.fugitiveWins ? .marshal : .fugitive, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name).font(.body.weight(.bold))
                Text(Self.roles(row))
                    .font(.caption).foregroundStyle(Noir.card.opacity(0.6))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(row.wins)").font(Noir.poster(26)).foregroundStyle(Noir.fugitive)
                Text("\(row.winRate)% of \(row.games)").font(.caption2).foregroundStyle(Noir.card.opacity(0.6))
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }

    /// stats.html's "Against the computer": ranked by wins on hard, each
    /// level's wins split by the seat played, then the latest games.
    private func computerPanel(_ rows: [FugitiveStats.ComputerRow], recent: [FugitiveStats.ComputerRecent]) -> some View {
        NoirPanel(title: "Against the computer") {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 10) {
                    Mugshot(name: row.name,
                            role: row.marshalHardWins + row.marshalEasyWins > row.fugitiveHardWins + row.fugitiveEasyWins
                                ? .marshal : .fugitive,
                            size: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.name).font(.body.weight(.bold))
                        Text(Self.levels(row)).font(.caption).foregroundStyle(Noir.card.opacity(0.6))
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(row.hardWins)").font(Noir.poster(26)).foregroundStyle(Noir.fugitive)
                        Text("on hard · \(row.wins)/\(row.games) in all").font(.caption2).foregroundStyle(Noir.card.opacity(0.6))
                    }
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            if !recent.isEmpty {
                Divider().overlay(Noir.card.opacity(0.2)).padding(.vertical, 4)
                ForEach(Array(recent.enumerated()), id: \.offset) { _, game in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.headline(game)).font(.subheadline.weight(.bold))
                        Text("\(game.level.capitalized) · \(game.hideouts) hideout\(game.hideouts == 1 ? "" : "s") · \(Self.date(game.at))")
                            .font(.caption).foregroundStyle(Noir.card.opacity(0.6))
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    /// The line above the records: both kinds of game, once there are any
    /// against the computer — "0 games played" over a panel of them misleads.
    static func played(_ stats: FugitiveStats) -> String {
        let people = "\(stats.gamesPlayed) game\(stats.gamesPlayed == 1 ? "" : "s")"
        guard let solo = stats.computer?.gamesPlayed, solo > 0 else { return "\(people) played" }
        return "\(people) between people · \(solo) against the computer"
    }

    static func levels(_ row: FugitiveStats.ComputerRow) -> String {
        "Hard \(row.hardWins)/\(row.hardGames) (F \(row.fugitiveHardWins)/\(row.fugitiveHardGames) · M \(row.marshalHardWins)/\(row.marshalHardGames))"
            + " · Easy \(row.easyWins)/\(row.easyGames)"
    }

    /// stats.html's wording for a game against the computer.
    static func headline(_ game: FugitiveStats.ComputerRecent) -> String {
        game.won ? "\(game.name) beat the computer as \(game.role.title)"
                 : "The computer beat \(game.name) (\(game.role.title))"
    }

    private static func roles(_ row: FugitiveStats.Row) -> String {
        var text = "Fugitive \(row.fugitiveWins)/\(row.fugitiveGames) · Marshal \(row.marshalWins)/\(row.marshalGames)"
        if row.manhuntCatches > 0 {
            text += " · \(row.manhuntCatches) Manhunt catch\(row.manhuntCatches == 1 ? "" : "es")"
        }
        return text
    }

    private func recentRow(_ game: FugitiveStats.Recent) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(Self.headline(game)).font(.subheadline.weight(.bold))
            Text("\(game.hideouts) hideout\(game.hideouts == 1 ? "" : "s") · \(Self.date(game.at))")
                .font(.caption).foregroundStyle(Noir.card.opacity(0.6))
        }
        .padding(.vertical, 2)
    }

    /// stats.html's wording for how a game ended.
    static func headline(_ game: FugitiveStats.Recent) -> String {
        let f = game.fugitive, m = game.marshal
        switch game.reason {
        case "caught": return "\(m) caught \(f)"
        case "escaped": return "\(f) escaped from \(m)"
        case "manhunt_failed": return "\(f) escaped a Manhunt from \(m)"
        case "let_go": return "\(f) was let go by \(m)"
        case "resigned": return game.winner == .marshal ? "\(f) gave up to \(m)" : "\(m) gave up to \(f)"
        default: return "\(game.winner == .marshal ? m : f) won"
        }
    }

    private func countOffline() {
        let games = OfflineShelf.standard.all()
        waiting = games.filter { $0.finishedAt != nil && $0.upload == .notYet }.count
        refused = games.filter { if case .refused = $0.upload { true } else { false } }.count
    }

    private func load() async {
        do {
            stats = try await AppSettings.client.fugitiveStats()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private static func date(_ iso: String) -> String {
        guard let date = try? Date(iso, strategy: .iso8601) else { return String(iso.prefix(10)) }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}
