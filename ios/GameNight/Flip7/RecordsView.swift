import SwiftUI

/// Flip 7's records — the same numbers as /flip7/stats, in the order the
/// server ranks them (most wins, then best average round).
struct RecordsView: View {
    @State private var stats: Flip7Stats?
    @State private var error: String?

    var body: some View {
        ZStack {
            Theme.background
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let stats {
                        HStack(spacing: 12) {
                            bigStat("\(stats.gamesPlayed)", "games recorded")
                            bigStat("\(stats.bestRound.score)", stats.bestRound.player.map { "best round · \($0)" } ?? "best round")
                        }
                        Panel(title: "Leaderboard") {
                            if stats.leaderboard.isEmpty {
                                Text("No finished games yet. A game is recorded once someone reaches 200.")
                                    .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.7))
                            }
                            ForEach(Array(stats.leaderboard.enumerated()), id: \.offset) { rank, row in
                                HStack(alignment: .firstTextBaseline) {
                                    Text("\(rank + 1)").font(Theme.mono(12)).foregroundStyle(Theme.cream.opacity(0.5))
                                        .frame(width: 20, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(row.name).font(.body.weight(.bold))
                                        Text("\(row.games) game\(row.games == 1 ? "" : "s") · avg \(row.average, specifier: "%.1f") a round · best \(row.bestGame)")
                                            .font(.caption).foregroundStyle(Theme.cream.opacity(0.6))
                                    }
                                    Spacer()
                                    Text("\(row.wins)").font(Theme.mono(20)).foregroundStyle(Theme.goldBright)
                                    Text(row.wins == 1 ? "win" : "wins").font(.caption).foregroundStyle(Theme.cream.opacity(0.6))
                                }
                                .padding(.vertical, 4)
                            }
                        }
                        if !stats.recent.isEmpty {
                            Panel(title: "Recent games") {
                                ForEach(Array(stats.recent.enumerated()), id: \.offset) { _, game in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(game.winner).font(.body.weight(.bold))
                                            Text("\(game.players) players · \(Self.date(game.at))")
                                                .font(.caption).foregroundStyle(Theme.cream.opacity(0.6))
                                        }
                                        Spacer()
                                        Text("\(game.score)").font(Theme.mono(17)).foregroundStyle(Theme.goldBright)
                                    }
                                }
                            }
                        }
                    } else if let error {
                        Panel { Text(error) }
                    } else {
                        ProgressView().tint(Theme.cream).frame(maxWidth: .infinity)
                    }
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .foregroundStyle(Theme.cream)
            }
            .refreshable { await load() }
        }
        .navigationTitle("Records")
        .toolbarBackground(Theme.feltDark, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await load() }
        .preferredColorScheme(.dark)
    }

    private func bigStat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(Theme.mono(30)).foregroundStyle(Theme.goldBright)
            Text(label).font(.caption).foregroundStyle(Theme.cream.opacity(0.7)).lineLimit(1)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }

    private func load() async {
        do {
            stats = try await AppSettings.client.flip7Stats()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private static func date(_ iso: String) -> String {
        guard let date = try? Date(iso, strategy: .iso8601) else { return iso }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}
