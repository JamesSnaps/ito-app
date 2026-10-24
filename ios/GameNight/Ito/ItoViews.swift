import SwiftUI

/// ito's topic display — the player view of the web app, which is the whole
/// reason ito is in Game Night: the topic, big, on everyone's screen. The
/// host still draws from the browser (it sits behind Authelia), so this is
/// read-only, like `/ito/play/<code>`.
struct ItoDisplayView: View {
    let code: String
    @State private var state: ItoState?
    @State private var gone = false
    /// What's on the card face — swapped only while it's edge-on.
    @State private var shown: ItoState?
    /// 0 is face up; 90 is edge-on, the moment the face is changed unseen.
    @State private var turn: Double = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(hex: 0x14161B).ignoresSafeArea()
                VStack(spacing: 18) {
                    Text(roundLine).font(.system(size: 15, weight: .heavy)).kerning(1.6)
                        .foregroundStyle(Color(hex: 0x8A8F98))
                    let width = min(geo.size.width - 32, (geo.size.height - 140) * 1.45, 900)
                    Group {
                        if let shown, shown.currentTopic != nil {
                            ItoCardFront(state: shown)
                        } else {
                            ItoCardBack()
                        }
                    }
                    .frame(width: width, height: width / 1.45)
                    .rotation3DEffect(.degrees(turn), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
                    if state?.currentTopic == nil {
                        Text(gone ? "This room has closed." : "The host is picking a topic…")
                            .font(.title3).foregroundStyle(Color(hex: 0x8A8F98))
                    }
                    Text("ROOM \(code)").font(.system(size: 13, weight: .semibold)).kerning(3)
                        .foregroundStyle(Color(hex: 0x4B5057))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("ito")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(hex: 0x14161B), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .keepsScreenAwake()
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled && !gone {
                await poll()
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .preferredColorScheme(.dark)
    }

    private var roundLine: String {
        guard let state, state.roundNumber > 0 else { return "WAITING FOR THE HOST" }
        return "ROUND \(state.roundNumber)"
    }

    /// Deals only when the card actually changed — every poll would
    /// otherwise re-flip it. Keyed on draw_id, so a swapped card flips too.
    private func poll() async {
        do {
            let fresh = try await AppSettings.client.itoState(code: code)
            let changed = fresh.drawId != state?.drawId
            let first = state == nil
            state = fresh
            guard changed else { return }
            if first {
                shown = fresh
                return
            }
            // The web card's deal: turn edge-on, swap the face out of sight,
            // turn back. 320ms each way, as in style.css.
            withAnimation(.easeIn(duration: 0.32)) { turn = 90 }
            try? await Task.sleep(for: .milliseconds(320))
            shown = fresh
            turn = -90
            withAnimation(.easeOut(duration: 0.32)) { turn = 0 }
        } catch let failure as GameNightClient.Failure where failure.status == 404 {
            gone = true
        } catch {
            // Retry on the next tick.
        }
    }
}

/// The face of an ito card, drawn like the printed ones (and the web's
/// `ito/_card.html`): the topic on a dark banner, a scale from 1 to 100 as
/// one unbroken stroke, and the category's tab off the bottom edge.
struct ItoCardFront: View {
    let state: ItoState

    var body: some View {
        GeometryReader { geo in
            let unit = geo.size.width / 20
            let (title, note) = Self.split(state.currentTopic ?? "—")
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: unit * 0.9).fill(Color(hex: 0xF4F4F2))
                VStack(spacing: unit * 0.45) {
                    Text(title)
                        .font(.system(size: unit * Self.titleScale(title), weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .lineLimit(3).minimumScaleFactor(0.6)
                        .padding(.vertical, unit * 0.5).padding(.horizontal, unit * 0.9)
                        .frame(maxWidth: .infinity)
                        .background(Color(hex: 0x45474C), in: Capsule())
                    Text(note.uppercased())
                        .font(.system(size: unit * 0.8, weight: .bold, design: .rounded)).kerning(unit * 0.08)
                        .foregroundStyle(Color(hex: 0x8C9099))
                        .frame(minHeight: unit)
                    Spacer(minLength: 0)
                    HStack(alignment: .bottom, spacing: unit * 0.4) {
                        pole(state.currentLow ?? "Low", "1", unit: unit)
                        ScaleLine()
                            .stroke(Color(hex: 0x9A9EA6), style: StrokeStyle(lineWidth: unit * 0.15, lineCap: .round))
                            .frame(height: unit * 2.4)
                        pole(state.currentHigh ?? "High", "100", unit: unit)
                    }
                    .padding(.horizontal, unit * 0.3)
                }
                .padding(.horizontal, unit).padding(.top, unit * 0.85).padding(.bottom, unit * 1.9)

                let category = state.currentCategory ?? state.currentType ?? "ito"
                Text(category.uppercased())
                    .font(.system(size: unit * 0.8, weight: .heavy, design: .rounded)).kerning(unit * 0.14)
                    .foregroundStyle(Color(hex: 0x2F3033))
                    .padding(.horizontal, unit * 1.5).padding(.top, unit * 0.4).padding(.bottom, unit * 0.5)
                    .background(ItoCategory.colour(category),
                                in: UnevenRoundedRectangle(topLeadingRadius: unit * 0.56, topTrailingRadius: unit * 0.56))
            }
            .clipShape(RoundedRectangle(cornerRadius: unit * 0.9))
            .shadow(color: .black.opacity(0.55), radius: unit, y: unit * 0.7)
        }
        .accessibilityElement(children: .combine)
    }

    private func pole(_ label: String, _ number: String, unit: CGFloat) -> some View {
        VStack(spacing: unit * 0.25) {
            Text(label)
                .font(.system(size: unit * 0.72, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(hex: 0x45474C))
                .multilineTextAlignment(.center)
                .frame(maxWidth: unit * 5.4)
            Text(number)
                .font(.system(size: unit * (number.count > 2 ? 0.95 : 1.05), weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: unit * 2.4, height: unit * 2.4)
                .background(Color(hex: 0x45474C), in: Circle())
        }
    }

    /// Action topics carry their instruction in brackets ("… (mime it)").
    /// On the printed cards that's a note, not part of the title — the same
    /// split the web card makes.
    static func split(_ raw: String) -> (title: String, note: String) {
        guard raw.hasSuffix(")"), let open = raw.lastIndex(of: "(") else { return (raw, "") }
        let title = raw[..<open].trimmingCharacters(in: .whitespaces)
        let note = raw[raw.index(after: open)..<raw.index(before: raw.endIndex)]
        guard !title.isEmpty, !note.isEmpty else { return (raw, "") }
        return (title, String(note))
    }

    /// Long titles get a smaller banner so they still fit the card.
    private static func titleScale(_ title: String) -> CGFloat {
        title.count > 34 ? 1.1 : title.count > 22 ? 1.3 : 1.5
    }
}

/// The card back: the ito logo's woven line, simplified.
struct ItoCardBack: View {
    var body: some View {
        GeometryReader { geo in
            let unit = geo.size.width / 20
            ZStack {
                RoundedRectangle(cornerRadius: unit * 0.9).fill(Color(hex: 0x1E2129))
                ItoSwirl()
                    .stroke(LinearGradient(colors: [0xE2674A, 0xF2C43D, 0x86C06A, 0x4FC3D9, 0x5B8FF5, 0x8B6FD0].map { Color(hex: $0) },
                                           startPoint: .leading, endPoint: .trailing),
                            style: StrokeStyle(lineWidth: unit * 0.4, lineCap: .round, lineJoin: .round))
                    .padding(unit)
                Text("ito").font(.system(size: unit * 3.4, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: 0xF3F3F3))
                    .offset(y: unit * 1.2)
            }
            .shadow(color: .black.opacity(0.55), radius: unit, y: unit * 0.7)
        }
        .accessibilityLabel("ito card, face down")
    }
}

/// The card's scale line, from the SVG in ito/_card.html (viewBox 260×60):
/// straight, dip, hump, a loop that crosses itself, straight. One stroke.
nonisolated struct ScaleLine: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 260, sy = rect.height / 60
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        var path = Path()
        path.move(to: p(4, 30))
        path.addLine(to: p(74, 30))
        path.addCurve(to: p(96, 45), control1: p(84, 30), control2: p(86, 45))
        path.addCurve(to: p(120, 13), control1: p(106, 45), control2: p(108, 13))
        path.addCurve(to: p(144, 30), control1: p(132, 13), control2: p(134, 30))
        path.addCurve(to: p(166, 16), control1: p(156, 30), control2: p(166, 24))
        path.addCurve(to: p(152, 13), control1: p(166, 8), control2: p(156, 6))
        path.addCurve(to: p(170, 30), control1: p(147, 22), control2: p(156, 30))
        path.addLine(to: p(256, 30))
        return path
    }
}

/// The card back's swirl (ito/_card.html, viewBox 360×200).
nonisolated private struct ItoSwirl: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 360, sy = rect.height / 200
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        var path = Path()
        path.move(to: p(2, 96))
        path.addLine(to: p(74, 96))
        path.addCurve(to: p(118, 60), control1: p(96, 96), control2: p(96, 60))
        path.addCurve(to: p(162, 128), control1: p(140, 60), control2: p(140, 128))
        path.addCurve(to: p(216, 96), control1: p(186, 128), control2: p(196, 96))
        path.addCurve(to: p(262, 146), control1: p(244, 96), control2: p(262, 122))
        path.addCurve(to: p(230, 168), control1: p(262, 168), control2: p(244, 178))
        path.addCurve(to: p(240, 104), control1: p(214, 156), control2: p(214, 118))
        path.addCurve(to: p(300, 96), control1: p(258, 94), control2: p(286, 96))
        path.addLine(to: p(358, 96))
        return path
    }
}

/// One colour per category — the `--cat-<name>` values in static/style.css.
enum ItoCategory {
    static func colour(_ name: String) -> Color {
        switch name {
        case "family": Color(hex: 0xF2C43D)
        case "everyone": Color(hex: 0xF6A02C)
        case "action": Color(hex: 0xEF6F5B)
        case "summer": Color(hex: 0x4FC3D9)
        case "football": Color(hex: 0x6FC06A)
        case "animals": Color(hex: 0xB58CF0)
        case "geeks": Color(hex: 0x7FA7F5)
        case "halloween": Color(hex: 0xF28B3D)
        case "work": Color(hex: 0x9AA3AD)
        default: Color(hex: 0xF2C43D)
        }
    }
}
