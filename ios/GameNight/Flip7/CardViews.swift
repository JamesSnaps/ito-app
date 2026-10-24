import SwiftUI

/// One card face. Our own design, as on the web table — cream numbers, gold
/// modifiers, a colour per action — not the published art.
struct CardView: View {
    let card: Card
    var role: TableCard.Role = .normal
    var width: CGFloat = 44

    var body: some View {
        RoundedRectangle(cornerRadius: width * 0.14)
            .fill(fill)
            .overlay { face }
            .overlay {
                switch role {
                case .bust:
                    RoundedRectangle(cornerRadius: width * 0.14).strokeBorder(Theme.crimson, lineWidth: 3)
                case .held:
                    RoundedRectangle(cornerRadius: width * 0.14)
                        .strokeBorder(Theme.goldBright, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                default:
                    EmptyView()
                }
            }
            .frame(width: width, height: width * 1.4)
            .shadow(color: .black.opacity(0.35), radius: 3, y: 2)
            .rotationEffect(.degrees(role == .bust ? 7 : 0))
            .opacity(role == .played ? 0.7 : 1)
            .accessibilityElement()
            .accessibilityLabel(label)
    }

    @ViewBuilder private var face: some View {
        switch card {
        case .number(let n):
            Text("\(n)").font(Theme.display(width * 0.5)).foregroundStyle(Theme.ink)
        case .flat, .times2:
            Text(card.face).font(Theme.display(width * 0.34)).foregroundStyle(Theme.ink)
        case .freeze, .flipThree, .secondChance:
            VStack(spacing: 2) {
                Image(systemName: symbol).font(.system(size: width * 0.34, weight: .semibold))
                Text(card.face).font(Theme.display(max(7, width * 0.15), weight: .bold))
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            .foregroundStyle(Theme.cream)
            .padding(2)
        }
    }

    private var fill: AnyShapeStyle {
        switch card {
        case .number: AnyShapeStyle(Theme.cream)
        case .flat, .times2: AnyShapeStyle(Theme.goldGradient)
        case .freeze: AnyShapeStyle(Theme.freeze)
        case .flipThree: AnyShapeStyle(Theme.crimson)
        case .secondChance: AnyShapeStyle(Theme.chance)
        }
    }

    private var symbol: String {
        switch card {
        case .freeze: "snowflake"
        case .flipThree: "chevron.forward.3"
        default: "checkmark.shield"
        }
    }

    private var label: String {
        switch role {
        case .bust: "\(card.name), the duplicate"
        case .played: "\(card.name), played"
        case .held: "\(card.name), still to hand out"
        case .normal: card.name
        }
    }
}

/// Lays cards out in rows, wrapping when a row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Seven numbers out is the moment of the round: a gold card that scales in
/// and is gone in a second and a half, as on the web page.
struct Flip7Flash: View {
    let name: String
    @State private var shown = false

    var body: some View {
        VStack(spacing: 4) {
            Text("FLIP 7!").font(Theme.display(44))
            Text("+15").font(Theme.mono(24))
            Text(name.uppercased()).font(.system(size: 14, weight: .bold)).kerning(1.6).opacity(0.72)
        }
        .foregroundStyle(Theme.ink)
        .padding(.vertical, 22).padding(.horizontal, 34)
        .background(LinearGradient(colors: [Theme.goldBright, Theme.gold, Color(hex: 0xB6832F)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.55), radius: 25, y: 18)
        .scaleEffect(shown ? 1 : 0.55)
        .rotationEffect(.degrees(shown ? -2 : -8))
        .opacity(shown ? 1 : 0)
        .allowsHitTesting(false)
        .onAppear { withAnimation(.spring(response: 0.42, dampingFraction: 0.55)) { shown = true } }
        .accessibilityLabel("\(name) flipped 7, plus 15")
    }
}
