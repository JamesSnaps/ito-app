import SwiftUI

/// Wildwood's records: games between people, then games with the computer
/// at the table, kept apart — /wildwood/stats in the app.
struct WildwoodRecordsView: View {
    @State private var stats: WildwoodStats?
    @State private var problem: String?

    var body: some View {
        ZStack {
            Woods.backdrop
            ScrollView {
                VStack(spacing: 14) {
                    if let stats {
                        if stats.leaderboard.isEmpty && stats.computerLeaderboard.isEmpty {
                            WoodPanel { Text("No games yet. Finished games are recorded here automatically.") }
                        }
                        if !stats.leaderboard.isEmpty {
                            WoodPanel(title: "\(stats.gamesPlayed) game\(stats.gamesPlayed == 1 ? "" : "s") played") {
                                header(["Wins", "Win %", "Catches"])
                                ForEach(stats.leaderboard) { row in
                                    line(row.name, ["\(row.wins)/\(row.games)", "\(row.winRate ?? 0)%", "\(row.catches)"])
                                }
                            }
                            recent("Recent games", stats.recent)
                        }
                        if !stats.computerLeaderboard.isEmpty {
                            WoodPanel(title: "With the computer · \(stats.computer.gamesPlayed)") {
                                header(["Hard", "Easy", "All"])
                                ForEach(stats.computerLeaderboard) { row in
                                    line(row.name, ["\(row.hardWins ?? 0)/\(row.hardGames ?? 0)",
                                                    "\(row.easyWins ?? 0)/\(row.easyGames ?? 0)",
                                                    "\(row.wins)/\(row.games)"])
                                }
                            }
                            recent("Recent games with the computer", stats.computer.recent)
                        }
                    } else if let problem {
                        WoodPanel { Text(problem) }
                    } else {
                        ProgressView().tint(Woods.cream).padding(40)
                    }
                }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .foregroundStyle(Woods.cream)
        .navigationTitle("Wildwood records")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Woods.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            await Faces.shared.load()
            // Offline games waiting for a signal go home first, so they show.
            await WildwoodOfflineUploads.sendWaiting()
            do { stats = try await AppSettings.client.wildwoodStats() } catch { problem = error.localizedDescription }
        }
        .refreshable {
            if let fresh = try? await AppSettings.client.wildwoodStats() { stats = fresh }
        }
    }

    private func header(_ columns: [String]) -> some View {
        HStack {
            Text("Player").frame(maxWidth: .infinity, alignment: .leading)
            ForEach(columns, id: \.self) { Text($0).frame(width: 64, alignment: .trailing) }
        }
        .font(.caption.weight(.bold)).foregroundStyle(Woods.cream.opacity(0.6))
    }

    private func line(_ name: String, _ values: [String]) -> some View {
        HStack {
            HStack(spacing: 8) {
                AvatarView(name: name, size: 26)
                Text(name).font(.subheadline.weight(.bold)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                Text(value).font(.subheadline.monospacedDigit()).frame(width: 64, alignment: .trailing)
            }
        }
    }

    private func recent(_ title: String, _ games: [WildwoodStats.Recent]) -> some View {
        WoodPanel(title: title) {
            ForEach(Array(games.enumerated()), id: \.offset) { _, game in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(game.winner) won\(game.computerWon == true ? " (computer)" : "")").font(.subheadline.weight(.bold))
                    Text("\(String(game.at.prefix(10))) · \(game.players.joined(separator: ", "))\(game.level.map { " · \($0)" } ?? "")")
                        .font(.caption).foregroundStyle(Woods.cream.opacity(0.6))
                }
            }
        }
    }
}
