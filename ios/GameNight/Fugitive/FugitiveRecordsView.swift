import SwiftUI

/// Fugitive's records — /fugitive/stats in the app: the leaderboard in the
/// server's order, each player's record in both roles, and recent games.
struct FugitiveRecordsView: View {
    @State private var stats: FugitiveStats?
    @State private var error: String?
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ZStack {
            DeskBackground().ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let stats {
                        Text("\(stats.gamesPlayed) game\(stats.gamesPlayed == 1 ? "" : "s") played")
                            .font(Noir.type(15)).foregroundStyle(Noir.card.opacity(0.75))
                        let columns = sizeClass == .regular
                            ? AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                            : AnyLayout(VStackLayout(spacing: 16))
                        columns {
                            NoirPanel(title: "Most wanted") {
                                if stats.leaderboard.isEmpty {
                                    Text("No games yet. Finished games are recorded here automatically.")
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
                Text("Fugitive \(row.fugitiveWins)/\(row.fugitiveGames) · Marshal \(row.marshalWins)/\(row.marshalGames)"
                     + (row.manhuntCatches > 0 ? " · \(row.manhuntCatches) Manhunt catch\(row.manhuntCatches == 1 ? "" : "es")" : ""))
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
