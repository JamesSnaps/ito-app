import SwiftUI

/// Fugitive's look: a detective's desk at night, the same palette and
/// faces as static/fugitive.css. The fonts are the web's own three, bundled
/// (ios/GameNight/Fonts, listed in project.yml's UIAppFonts).
enum Noir {
    static let night = Color(hex: 0x0B111D)
    static let panel = Color(hex: 0x141F33)
    static let card = Color(hex: 0xF3EAD8)
    static let ink = Color(hex: 0x13213A)
    static let fugitive = Color(hex: 0xE0A84F)
    static let marshal = Color(hex: 0x5FB3C9)
    static let found = Color(hex: 0x3FAE6A)
    static let miss = Color(hex: 0xD9483B)
    static let manila = Color(hex: 0xE3CF9F)
    static let paper = Color(hex: 0xF6EFDC)
    static let pen = Color(hex: 0x23314F)
    static let line = Color(hex: 0xF3EAD8).opacity(0.14)

    static func colour(_ role: FugitiveRole) -> Color { role == .fugitive ? fugitive : marshal }

    /// Wanted-poster capitals: the title, card numbers, nameplates.
    static func poster(_ size: CGFloat) -> Font { .custom("BebasNeue-Regular", size: size) }
    /// A worn typewriter: case tags, notes, stamps.
    static func type(_ size: CGFloat) -> Font { .custom("SpecialElite-Regular", size: size) }
    /// The Marshal's handwriting.
    static func hand(_ size: CGFloat) -> Font { .custom("Caveat-Regular", size: size).weight(.semibold) }
}

/// The same deterministic randomness as fugitive.js, so a name draws the
/// same mugshot and a code the same map on every device.
nonisolated struct Seeded {
    private var a: UInt32

    init(_ n: Int) { a = UInt32(truncatingIfNeeded: UInt64(max(0, n)) &* 7919 &+ 101) }

    mutating func next() -> Double {
        a = a &+ 0x6D2B_79F5
        var t = a
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }

    /// fugitive.js's `nameSeed`: FNV-1a over the trimmed, lower-cased name.
    static func nameSeed(_ name: String) -> Int {
        var h: UInt32 = 2_166_136_261
        for scalar in name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().unicodeScalars {
            h = (h ^ scalar.value) &* 16_777_619
        }
        return Int(h % 1_000_003)
    }
}

// MARK: - cards

/// A card, face or back, from the art rendered off fugitive.js
/// (ios/scripts/render_fugitive_cards.js).
struct FugitiveCard: View {
    /// Nil for a face-down card.
    let number: Int?
    var width: CGFloat = 60

    var body: some View {
        Image(number.map { "fugitive-card-\($0)" } ?? "fugitive-card-back")
            .resizable()
            .interpolation(.high)
            .frame(width: width, height: width * 1.4)
            .shadow(color: .black.opacity(0.45), radius: 3, y: 2)
            .accessibilityLabel(number.map { "Card \($0)" } ?? "A face-down card")
    }
}

/// Turning a card over: in to edge-on, then out.
struct FlipIn: ViewModifier {
    var angle: Double
    func body(content: Content) -> some View {
        content.rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
    }
}

extension AnyTransition {
    static var turnOver: AnyTransition {
        .asymmetric(insertion: .modifier(active: FlipIn(angle: 90), identity: FlipIn(angle: 0)), removal: .identity)
    }
}

// MARK: - faces

/// A player's mugshot: their profile photo if they have one, otherwise the
/// silhouette fugitive.js draws from their name — the height chart and a
/// booking number for the Fugitive, the badge for the Marshal.
struct Mugshot: View {
    let name: String
    let role: FugitiveRole
    var size: CGFloat = 40

    var body: some View {
        Group {
            if let url = Faces.shared.photoURL(for: name) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                            // A booking photo: a little faded.
                            .saturation(role == .fugitive ? 0.65 : 1)
                            .contrast(role == .fugitive ? 1.08 : 1)
                    } else {
                        DrawnMugshot(name: name, role: role)
                    }
                }
            } else {
                DrawnMugshot(name: name, role: role)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Noir.colour(role), lineWidth: max(2, size / 22)))
        .accessibilityHidden(true)
    }
}

/// fugitive.js's `mugshotSVG`, point for point, on a 100×100 canvas.
struct DrawnMugshot: View {
    let name: String
    let role: FugitiveRole

    private static let scarves: [UInt32] = [0xE0A84F, 0xD9483B, 0x5FB3C9, 0x57B97A, 0xB07CD8, 0xF08AA8, 0xF2D06B, 0x7AA2FF]

    var body: some View {
        Canvas { context, size in
            let seed = Seeded.nameSeed(name)
            var r = Seeded(seed)
            let scarf = Color(hex: Self.scarves[Int(r.next() * Double(Self.scarves.count))])
            let hair = Int(r.next() * 5)
            let hat = r.next() < 0.3 ? Int(r.next() * 3) : -1
            let glasses = r.next() < 0.28
            let tilt = (r.next() - 0.5) * 6
            let ink = GraphicsContext.Shading.color(Color(hex: 0x141A28))

            var c = context
            c.scaleBy(x: size.width / 100, y: size.height / 100)

            // The backdrop.
            if role == .marshal {
                c.fill(Path(CGRect(x: 0, y: 0, width: 100, height: 100)), with: .color(Color(hex: 0x2C5F73)))
                var star = c
                star.translateBy(x: 20, y: 6)
                star.scaleBy(x: 2.5, y: 2.5)
                star.fill(Self.star, with: .color(.white.opacity(0.08)))
            } else {
                c.fill(Path(CGRect(x: 0, y: 0, width: 100, height: 100)), with: .color(Color(hex: 0xCBC3B1)))
                for y in stride(from: 8, to: 100, by: 8) {
                    let thick: CGFloat = y % 24 == 8 ? 1.6 : 0.8
                    c.fill(Path(CGRect(x: 0, y: CGFloat(y), width: 100, height: thick)),
                           with: .color(Color(hex: 0x6D6555).opacity(0.6)))
                }
            }

            // The figure: tilted a touch, scaled up from the shoulders.
            var f = c
            f.translateBy(x: 50, y: 80)
            f.rotate(by: .degrees(tilt))
            f.translateBy(x: -50, y: -80)
            f.translateBy(x: 50, y: 100)
            f.scaleBy(x: 1.14, y: 1.14)
            f.translateBy(x: -50, y: -100)

            f.fill(Path { p in
                p.move(to: CGPoint(x: 6, y: 104))
                p.addCurve(to: CGPoint(x: 50, y: 72), control1: CGPoint(x: 8, y: 80), control2: CGPoint(x: 28, y: 72))
                p.addCurve(to: CGPoint(x: 94, y: 104), control1: CGPoint(x: 72, y: 72), control2: CGPoint(x: 92, y: 80))
                p.closeSubpath()
            }, with: ink)
            f.fill(Path(CGRect(x: 43, y: 56, width: 14, height: 18)), with: ink)
            f.fill(Path(ellipseIn: CGRect(x: 34, y: 25, width: 32, height: 38)), with: ink)

            if hat == -1 {
                switch hair {
                case 0:
                    f.fill(Path { p in
                        p.move(to: CGPoint(x: 33, y: 42))
                        p.addCurve(to: CGPoint(x: 52, y: 22), control1: CGPoint(x: 32, y: 26), control2: CGPoint(x: 44, y: 21))
                        p.addCurve(to: CGPoint(x: 67, y: 42), control1: CGPoint(x: 62, y: 22), control2: CGPoint(x: 69, y: 30))
                        p.addCurve(to: CGPoint(x: 48, y: 31), control1: CGPoint(x: 63, y: 34), control2: CGPoint(x: 56, y: 31))
                        p.addCurve(to: CGPoint(x: 33, y: 42), control1: CGPoint(x: 41, y: 31), control2: CGPoint(x: 36, y: 35))
                        p.closeSubpath()
                    }, with: ink)
                case 1:
                    f.fill(Path { p in
                        p.move(to: CGPoint(x: 32, y: 46))
                        p.addCurve(to: CGPoint(x: 56, y: 22), control1: CGPoint(x: 28, y: 24), control2: CGPoint(x: 46, y: 18))
                        p.addCurve(to: CGPoint(x: 70, y: 66), control1: CGPoint(x: 70, y: 26), control2: CGPoint(x: 72, y: 44))
                        p.addLine(to: CGPoint(x: 63, y: 66))
                        p.addCurve(to: CGPoint(x: 50, y: 33), control1: CGPoint(x: 66, y: 50), control2: CGPoint(x: 62, y: 36))
                        p.addCurve(to: CGPoint(x: 37, y: 66), control1: CGPoint(x: 40, y: 34), control2: CGPoint(x: 36, y: 48))
                        p.addLine(to: CGPoint(x: 30, y: 66))
                        p.addCurve(to: CGPoint(x: 32, y: 46), control1: CGPoint(x: 28, y: 58), control2: CGPoint(x: 30, y: 52))
                        p.closeSubpath()
                    }, with: ink)
                case 2:
                    f.fill(Path(ellipseIn: CGRect(x: 42, y: 12, width: 16, height: 16)), with: ink)
                case 3:
                    for i in 0..<7 {
                        let x = 36 + Double(i) * 4.7, y = 27 + Double(abs(i - 3)) * 1.8
                        f.fill(Path(ellipseIn: CGRect(x: x - 6, y: y - 6, width: 12, height: 12)), with: ink)
                    }
                default:
                    break
                }
            } else if hat == 0 {
                f.fill(Path(ellipseIn: CGRect(x: 23, y: 26.5, width: 54, height: 9)), with: ink)
                f.fill(Path { p in
                    p.move(to: CGPoint(x: 35, y: 31))
                    p.addCurve(to: CGPoint(x: 50, y: 15), control1: CGPoint(x: 36, y: 18), control2: CGPoint(x: 42, y: 14))
                    p.addCurve(to: CGPoint(x: 65, y: 31), control1: CGPoint(x: 58, y: 14), control2: CGPoint(x: 64, y: 18))
                    p.closeSubpath()
                }, with: ink)
                f.fill(Path(CGRect(x: 35, y: 25, width: 30, height: 3.4)), with: .color(scarf.opacity(0.9)))
            } else if hat == 1 {
                f.fill(Path { p in
                    p.move(to: CGPoint(x: 33, y: 36))
                    p.addCurve(to: CGPoint(x: 67, y: 36), control1: CGPoint(x: 33, y: 20), control2: CGPoint(x: 67, y: 20))
                    p.closeSubpath()
                }, with: ink)
                f.fill(Path(roundedRect: CGRect(x: 32, y: 33, width: 36, height: 6), cornerRadius: 3), with: .color(scarf))
            } else {
                f.fill(Path { p in
                    p.move(to: CGPoint(x: 34, y: 35))
                    p.addCurve(to: CGPoint(x: 66, y: 35), control1: CGPoint(x: 34, y: 21), control2: CGPoint(x: 66, y: 21))
                    p.closeSubpath()
                }, with: ink)
                f.fill(Path { p in
                    p.move(to: CGPoint(x: 60, y: 33))
                    p.addLine(to: CGPoint(x: 80, y: 36))
                    p.addLine(to: CGPoint(x: 64, y: 38))
                    p.closeSubpath()
                }, with: ink)
            }
            if glasses {
                let lens = GraphicsContext.Shading.color(Noir.card.opacity(0.75))
                f.stroke(Path(ellipseIn: CGRect(x: 39, y: 40.5, width: 9, height: 9)), with: lens, lineWidth: 1.6)
                f.stroke(Path(ellipseIn: CGRect(x: 52, y: 40.5, width: 9, height: 9)), with: lens, lineWidth: 1.6)
                f.stroke(Path { $0.move(to: CGPoint(x: 48, y: 45)); $0.addLine(to: CGPoint(x: 52, y: 45)) },
                         with: lens, lineWidth: 1.6)
            }
            // A scarf in their colour, so two silhouettes tell apart.
            f.fill(Path { p in
                p.move(to: CGPoint(x: 38, y: 70))
                p.addCurve(to: CGPoint(x: 62, y: 70), control1: CGPoint(x: 44, y: 76), control2: CGPoint(x: 56, y: 76))
                p.addLine(to: CGPoint(x: 64, y: 76))
                p.addCurve(to: CGPoint(x: 36, y: 76), control1: CGPoint(x: 57, y: 82), control2: CGPoint(x: 43, y: 82))
                p.closeSubpath()
            }, with: .color(scarf))

            if role == .marshal {
                var badge = c
                badge.translateBy(x: 60, y: 76)
                badge.scaleBy(x: 0.75, y: 0.75)
                badge.fill(Self.star, with: .color(Noir.fugitive))
                badge.stroke(Self.star, with: .color(Color(hex: 0x7A5A2A)), lineWidth: 0.8)
            } else {
                c.fill(Path(roundedRect: CGRect(x: 28, y: 80, width: 44, height: 16), cornerRadius: 1.5),
                       with: .color(Color(hex: 0x1B1F2A)))
                let booking = String(seed % 90000 + 10000)
                c.draw(Text(booking).font(Noir.type(9)).foregroundStyle(Noir.card), at: CGPoint(x: 50, y: 88.5))
            }
        }
    }

    /// The icon set's star, on a 24-unit grid.
    static let star: Path = {
        let points: [(CGFloat, CGFloat)] = [(12, 3), (14.6, 8.6), (20.6, 9.3), (16.1, 13.4), (17.3, 19.4),
                                            (12, 16.4), (6.7, 19.4), (7.9, 13.4), (3.4, 9.3), (9.4, 8.6)]
        var path = Path()
        path.move(to: CGPoint(x: points[0].0, y: points[0].1))
        for point in points.dropFirst() { path.addLine(to: CGPoint(x: point.0, y: point.1)) }
        path.closeSubpath()
        return path
    }()
}

// MARK: - the desk

/// Dark wood, lit from above.
struct DeskBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x4A3221), Color(hex: 0x2B1C12)], startPoint: .top, endPoint: .bottom)
            Canvas { context, size in
                // The grain.
                var x: CGFloat = 0
                var r = Seeded(42)
                while x < size.width {
                    context.fill(Path(CGRect(x: x, y: 0, width: 1.5, height: size.height)),
                                 with: .color(.black.opacity(0.06 + r.next() * 0.06)))
                    x += 6 + r.next() * 10
                }
            }
            RadialGradient(colors: [Color(hex: 0xFFD696).opacity(0.2), .clear], center: .top,
                           startRadius: 0, endRadius: 520)
        }
    }
}

/// The street map the trail lies across — fugitive.js's `cityMap`, seeded
/// by the room code so every device shows the same city.
struct CityMap: View {
    let code: String

    var body: some View {
        Canvas { context, size in
            var seed: UInt32 = 0
            for scalar in code.unicodeScalars { seed = seed &* 31 &+ scalar.value }
            var r = Seeded(Int(seed % 100_000))
            // A 400×200 drawing, scaled to fill.
            let scale = max(size.width / 400, size.height / 200)
            var c = context
            c.translateBy(x: (size.width - 400 * scale) / 2, y: (size.height - 200 * scale) / 2)
            c.scaleBy(x: scale, y: scale)

            let y0 = 40 + r.next() * 120
            let c1 = y0 - 60 + r.next() * 120, c2 = y0 - 60 + r.next() * 120, end = y0 - 40 + r.next() * 80
            c.stroke(Path { p in
                p.move(to: CGPoint(x: -10, y: y0))
                p.addCurve(to: CGPoint(x: 410, y: end), control1: CGPoint(x: 80, y: c1), control2: CGPoint(x: 200, y: c2))
            }, with: .color(Color(hex: 0x3D6D8A).opacity(0.45)), lineWidth: 16)

            let street = GraphicsContext.Shading.color(Noir.card.opacity(0.08))
            var x = 0.0
            while x <= 400 {
                let lean = (r.next() - 0.5) * 30
                let wide = r.next() < 0.15
                c.stroke(Path { $0.move(to: CGPoint(x: x, y: 0)); $0.addLine(to: CGPoint(x: x + lean, y: 200)) },
                         with: street, lineWidth: wide ? 4 : 1.2)
                x += 22 + r.next() * 18
            }
            var y = 0.0
            while y <= 200 {
                let lean = (r.next() - 0.5) * 24
                let wide = r.next() < 0.15
                c.stroke(Path { $0.move(to: CGPoint(x: 0, y: y)); $0.addLine(to: CGPoint(x: 400, y: y + lean)) },
                         with: street, lineWidth: wide ? 4 : 1.2)
                y += 18 + r.next() * 16
            }
            let avenue = GraphicsContext.Shading.color(Noir.fugitive.opacity(0.12))
            let a1 = r.next() * 200, a2 = r.next() * 200
            c.stroke(Path { $0.move(to: CGPoint(x: 0, y: a1)); $0.addLine(to: CGPoint(x: 400, y: a2)) }, with: avenue, lineWidth: 5)
            let b1 = r.next() * 400, b2 = r.next() * 400
            c.stroke(Path { $0.move(to: CGPoint(x: b1, y: 0)); $0.addLine(to: CGPoint(x: b2, y: 200)) }, with: avenue, lineWidth: 5)
            let park = CGRect(x: 40 + r.next() * 300, y: 20 + r.next() * 140, width: 30 + r.next() * 30, height: 20 + r.next() * 20)
            c.fill(Path(roundedRect: park, cornerRadius: 4), with: .color(Color(hex: 0x57B97A).opacity(0.08)))
        }
        .background(Color(hex: 0x142338))
    }
}

/// An ink stamp across the table: FOUND, NOT HERE, CAUGHT, ESCAPED.
struct InkStamp: View {
    let stamp: FugitiveStore.Stamp
    @State private var landed = false
    @State private var splash = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // The verdicts — Found, Caught, Escaped, Manhunt — big enough to read
        // across the table; a miss with its numbers a size down to fit. The
        // last stamp of a game is bigger again, and says who won.
        VStack(spacing: 2) {
            Text(stamp.text.uppercased())
                .font(Noir.type(stamp.ending ? 76 : stamp.text.count > 14 ? 40 : 60))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .kerning(2)
            if let line = stamp.line {
                Text(line.uppercased())
                    .font(Noir.type(26)).kerning(3)
                    .opacity(0.85)
            }
        }
        .foregroundStyle(colour)
        .padding(.horizontal, 26).padding(.vertical, 12)
        .background(Noir.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(colour, lineWidth: stamp.ending ? 8 : 6))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(colour.opacity(0.6), lineWidth: 1.5).padding(6))
        // The ending's thump: a ring of ink knocked out from under it.
        .background {
            if stamp.ending {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(colour, lineWidth: 10)
                    .scaleEffect(splash ? 1.7 : 1)
                    .opacity(splash ? 0 : 0.55)
            }
        }
        .rotationEffect(.degrees(-12))
        .scaleEffect(landed ? 1 : reduceMotion ? 1 : stamp.ending ? 3.2 : 2.4)
        .opacity(landed ? 1 : 0)
        .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
        .onAppear {
            withAnimation(.spring(response: stamp.ending ? 0.34 : 0.28, dampingFraction: 0.55)) { landed = true }
            guard stamp.ending, !reduceMotion else { return }
            withAnimation(.easeOut(duration: 0.7).delay(0.12)) { splash = true }
        }
        .allowsHitTesting(false)
    }

    private var colour: Color {
        switch stamp.kind {
        case .found: Color(hex: 0x1F8A4C)
        case .miss: Noir.miss
        case .escape: Color(hex: 0xC9772B)
        }
    }
}

/// The table's buttons: the role's colour for the move that matters, a
/// quiet outline for the rest.
struct NoirButtonStyle: ButtonStyle {
    var fill: Color? = Noir.card
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .padding(.horizontal, 12)
            .foregroundStyle(fill == nil ? Noir.card : Noir.ink)
            .background {
                if let fill {
                    RoundedRectangle(cornerRadius: 12).fill(fill)
                } else {
                    RoundedRectangle(cornerRadius: 12).strokeBorder(Noir.line, lineWidth: 1.5)
                }
            }
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
            .offset(y: configuration.isPressed ? 1 : 0)
    }
}
