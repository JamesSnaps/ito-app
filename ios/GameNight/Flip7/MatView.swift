import SwiftUI

/// One player's place at the table: name, banked total, this round's
/// running score, seven pips for the bonus, and their cards.
struct MatView: View {
    let player: Player
    let index: Int
    let store: PlayStore
    var cardWidth: CGFloat = 44

    private var game: Game? { store.game }
    private var acting: Bool { store.actingSeat == index }
    private var isMe: Bool { store.mySeat == index }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                AvatarView(name: player.name, size: max(26, cardWidth * 0.5))
                Text(player.name)
                    .font(Theme.display(max(18, cardWidth * 0.3)))
                    .lineLimit(1)
                if isMe {
                    Text("YOU").font(.system(size: 10, weight: .heavy)).kerning(0.8)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.cream, in: RoundedRectangle(cornerRadius: 5))
                        .foregroundStyle(Theme.ink)
                }
                if store.takenByPhone(index) {
                    Image(systemName: "iphone").font(.system(size: 12)).opacity(0.55)
                        .accessibilityLabel("Playing on their own phone")
                }
                if game?.dealer == index {
                    Text("D").font(Theme.mono(10))
                        .frame(width: 20, height: 20)
                        .overlay(Circle().strokeBorder(Theme.line))
                        .opacity(0.7)
                        .accessibilityLabel("Dealer")
                }
                Spacer(minLength: 4)
                if let status = statusText {
                    Text(status.uppercased())
                        .font(.system(size: 10, weight: .heavy)).kerning(0.8)
                        .lineLimit(1)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(statusFill, in: Capsule())
                        .foregroundStyle(statusInk)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(player.total)").font(Theme.mono(max(22, cardWidth * 0.32))).foregroundStyle(Theme.goldBright)
                if game?.phase == .playing, player.status != .busted, player.roundScore > 0 {
                    Text("+\(player.roundScore)").font(Theme.mono(15)).foregroundStyle(Theme.green)
                }
                Spacer()
                pips
            }

            FlowLayout(spacing: 6) {
                // Cards still in the air are held back until they land.
                ForEach(store.cards(for: index)) { card in
                    CardView(card: card.card, role: card.role, width: cardWidth)
                        // It arrives by air (FlyingCard), so it only has to appear
                        // where the flight ended.
                        .transition(.opacity)
                }
            }
            .frame(minHeight: cardWidth * 1.4, alignment: .topLeading)
            .animation(.spring(response: 0.3, dampingFraction: 0.75), value: store.cards(for: index))
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Where the flying card lands: the card row, near its start.
        .reportsFrame(MatFramesKey.self) { frame in
            [index: PlacedFrame(frame: CGRect(x: frame.minX + 12 + cardWidth / 2, y: frame.minY + 70 + cardWidth * 0.7,
                                              width: 1, height: 1), width: cardWidth)]
        }
        .background(background, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(border, lineWidth: acting ? 2 : 1))
        .opacity(player.status == .busted && !player.hasFlip7 ? 0.55 : 1)
        .modifier(Shake(active: store.justBusted.contains(index)))
        .foregroundStyle(Theme.cream)
        .accessibilityElement(children: .combine)
    }

    private var pips: some View {
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { k in
                Circle()
                    .fill(k < player.hand.numbers.count ? Theme.goldBright : .clear)
                    .overlay(Circle().strokeBorder(k < player.hand.numbers.count ? Theme.goldBright : Theme.cream.opacity(0.35)))
                    .frame(width: 8, height: 8)
            }
        }
        .accessibilityLabel("\(player.hand.numbers.count) of 7 numbers")
    }

    private var statusText: String? {
        if player.hasFlip7 { return "Flip 7!" }
        switch player.status {
        case .busted: return "Bust on \(player.hand.bustCard.map(String.init) ?? "?")"
        case .stayed: return "Stayed"
        case .frozen: return "Frozen"
        case .active:
            guard acting, let pending = game?.pending else { return nil }
            if pending.kind == .give { return "Choosing" }
            return isMe ? "Your turn" : "Their turn"
        }
    }

    private var statusFill: Color {
        if player.hasFlip7 { return Theme.goldBright }
        switch player.status {
        case .busted: return Theme.crimson
        case .stayed, .frozen: return Theme.green.opacity(0.2)
        case .active: return acting ? Theme.gold : Theme.cream.opacity(0.1)
        }
    }

    private var statusInk: Color {
        if player.hasFlip7 || (player.status == .active && acting) { return Theme.ink }
        return player.status == .stayed || player.status == .frozen ? Theme.green : Theme.cream
    }

    private var background: Color {
        acting ? Theme.gold.opacity(0.1) : Color.black.opacity(0.16)
    }

    private var border: Color {
        if acting { return Theme.gold }
        if player.hasFlip7 { return Theme.goldBright }
        if isMe { return Theme.goldBright.opacity(0.45) }
        switch player.status {
        case .busted: return Theme.crimson.opacity(0.6)
        case .stayed, .frozen: return Theme.green.opacity(0.4)
        case .active: return Theme.line
        }
    }
}

/// A bust is a shake of the mat — once, when it happens.
private struct Shake: ViewModifier {
    let active: Bool
    @State private var count = 0

    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: CGFloat(0), trigger: count) { view, x in
                view.offset(x: x)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(-6, duration: 0.08)
                    LinearKeyframe(6, duration: 0.1)
                    LinearKeyframe(-6, duration: 0.1)
                    LinearKeyframe(6, duration: 0.1)
                    LinearKeyframe(0, duration: 0.08)
                }
            }
            .onChange(of: active) { _, now in
                if now { count += 1 }
            }
    }
}
