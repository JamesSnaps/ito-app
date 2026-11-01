import SwiftUI

/// Flip 7's felt and gold, the same values as static/flip7.css. The display
/// face is the web's `--font-display`, Bricolage Grotesque, bundled as five
/// static weights cut from the same variable file (Fonts/).
enum Theme {
    static let feltDark = Color(hex: 0x0F2E24)
    static let felt = Color(hex: 0x164A38)
    static let feltLight = Color(hex: 0x1E6249)
    static let cream = Color(hex: 0xFBF6EC)
    static let gold = Color(hex: 0xD9A94E)
    static let goldBright = Color(hex: 0xF0C875)
    static let crimson = Color(hex: 0xB3432B)
    static let green = Color(hex: 0x7FE0A8)
    static let ink = Color(hex: 0x12241C)
    static let line = Color(hex: 0xFBF6EC).opacity(0.14)
    static let freeze = Color(hex: 0x2F6F8F)
    static let chance = Color(hex: 0x3B7A5C)

    static let goldGradient = LinearGradient(colors: [goldBright, gold], startPoint: .top, endPoint: .bottom)

    static var background: some View {
        RadialGradient(colors: [feltLight, felt, feltDark], center: .top, startRadius: 0, endRadius: 900)
            .ignoresSafeArea()
    }

    /// Fixed size, as `.system(size:)` was: the layouts were drawn around
    /// these sizes, and `.custom(_:size:)` would scale them with Dynamic Type.
    static func display(_ size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        .custom(displayFace(weight), fixedSize: size)
    }

    /// The bundled weight nearest the one asked for: 400–800 are bundled, so
    /// lighter falls to Regular and black to ExtraBold.
    private static func displayFace(_ weight: Font.Weight) -> String {
        switch weight {
        case .heavy, .black: "BricolageGrotesque-ExtraBold"
        case .bold: "BricolageGrotesque-Bold"
        case .semibold: "BricolageGrotesque-SemiBold"
        case .medium: "BricolageGrotesque-Medium"
        default: "BricolageGrotesque-Regular"
        }
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// The table's buttons: gold for the move that matters, translucent cream
/// for the rest — the web page's `.f7-btn-gold` / `.f7-btn-ghost`.
struct FeltButtonStyle: ButtonStyle {
    enum Kind { case gold, ghost }
    var kind: Kind = .gold
    var big = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.display(big ? 20 : 16))
            .frame(maxWidth: .infinity)
            .padding(.vertical, big ? 16 : 11)
            .padding(.horizontal, 14)
            .foregroundStyle(kind == .gold ? Theme.ink : Theme.cream)
            .background {
                RoundedRectangle(cornerRadius: big ? 14 : 10)
                    .fill(kind == .gold ? AnyShapeStyle(Theme.goldGradient) : AnyShapeStyle(Theme.cream.opacity(0.08)))
                    .overlay {
                        if kind == .ghost {
                            RoundedRectangle(cornerRadius: big ? 14 : 10).strokeBorder(Theme.cream.opacity(0.25))
                        }
                    }
            }
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .offset(y: configuration.isPressed ? 1 : 0)
    }
}

/// A felt panel, like `.f7-panel`.
struct Panel<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title).font(Theme.display(16, weight: .bold)).foregroundStyle(Theme.goldBright)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line))
    }
}
