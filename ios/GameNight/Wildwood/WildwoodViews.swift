import SwiftUI

/// Wildwood's clearing in the wood: static/wildwood.css's values.
enum Woods {
    static let background = Color(hex: 0x13291B)
    static let ground = Color(hex: 0x2B5A37)
    static let groundDark = Color(hex: 0x214A2C)
    static let panel = Color(hex: 0x1C3A27)
    static let panel2 = Color(hex: 0x24492F)
    static let cream = Color(hex: 0xFFF4D6)
    static let ink = Color(hex: 0x2B2017)
    static let accent = Color(hex: 0xE0873A)
    static let call = Color(hex: 0xFFD84A)
    static let caught = Color(hex: 0xFF7A6B)
    static let line = Color(hex: 0xFFF4D6).opacity(0.14)

    static func colour(_ code: String?) -> Color {
        switch code {
        case "r": Color(hex: 0xE0533A)
        case "g": Color(hex: 0x3E9A4F)
        case "b": Color(hex: 0x2F6FC4)
        case "y": Color(hex: 0xEFB21C)
        default: Color(hex: 0x2C2B35)
        }
    }

    static var backdrop: some View {
        ZStack {
            background
            RadialGradient(colors: [Color(hex: 0xF2D488).opacity(0.16), .clear], center: .top, startRadius: 0, endRadius: 600)
        }
        .ignoresSafeArea()
    }

    /// The app's display face, as on the web.
    static func display(_ size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        Theme.display(size, weight: weight)
    }
}

/// A card: its face if known, the shared back if not. The faces are the
/// web's own drawing, rendered by ios/scripts/render_wildwood_cards.js.
struct WildwoodCardView: View {
    let card: String?
    var width: CGFloat = 70

    var body: some View {
        Image(WildwoodCard.asset(card))
            .resizable()
            .interpolation(.high)
            .frame(width: width, height: width * 1.4)
            .shadow(color: .black.opacity(0.35), radius: 3, y: 2)
            .accessibilityLabel(card.map(WildwoodCard.label) ?? "Face-down card")
    }
}

/// A seat's face: a computer's animal, or the person's photo or initials.
struct WildwoodFace: View {
    let name: String
    let computer: Bool
    var size: CGFloat = 40

    var body: some View {
        if computer {
            Image("wildwood-critter-\(name)")
                .resizable()
                .frame(width: size, height: size)
                .clipShape(Circle())
                .accessibilityHidden(true)
        } else {
            AvatarView(name: name, size: size)
        }
    }
}

struct WoodButtonStyle: ButtonStyle {
    enum Kind { case go, plain, call, caught, quiet }
    var kind: Kind = .plain
    var big = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Woods.display(big ? 20 : 17))
            .padding(.vertical, big ? 15 : 11)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .foregroundStyle(kind == .quiet ? Woods.cream : Woods.ink)
            .background {
                Capsule().fill(fill)
                    .overlay { if kind == .quiet { Capsule().strokeBorder(Woods.line) } }
            }
            .shadow(color: .black.opacity(kind == .quiet ? 0 : 0.3), radius: 0, y: configuration.isPressed ? 1 : 3)
            .offset(y: configuration.isPressed ? 2 : 0)
            .opacity(isEnabled ? 1 : 0.45)
    }

    private var fill: Color {
        switch kind {
        case .go: Woods.accent
        case .plain: Woods.cream
        case .call: Woods.call
        case .caught: Woods.caught
        case .quiet: .clear
        }
    }
}

/// A panel on the ground, like `.ww-panel`.
struct WoodPanel<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title.uppercased()).font(Woods.display(13, weight: .heavy)).kerning(1.2)
                    .foregroundStyle(Woods.cream.opacity(0.6))
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Woods.panel, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Woods.line))
    }
}
