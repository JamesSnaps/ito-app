import SwiftUI

/// The back of a Flip 7 card: felt green, a gold frame and a gold 7 — our
/// own design, like the faces.
struct CardBackView: View {
    var width: CGFloat = 60

    var body: some View {
        let r = width * 0.12
        RoundedRectangle(cornerRadius: r)
            .fill(LinearGradient(colors: [Theme.feltLight, Theme.feltDark], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay {
                // A fine diagonal weave, the web pile's stripes.
                Canvas { context, size in
                    let step = max(5, width / 9)
                    var x = -size.height
                    while x < size.width {
                        var path = Path()
                        path.move(to: CGPoint(x: x, y: size.height))
                        path.addLine(to: CGPoint(x: x + size.height, y: 0))
                        context.stroke(path, with: .color(Theme.gold.opacity(0.13)), lineWidth: 1)
                        x += step
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: r))
            }
            .overlay {
                RoundedRectangle(cornerRadius: r * 0.7)
                    .strokeBorder(Theme.gold.opacity(0.8), lineWidth: max(1, width * 0.025))
                    .padding(width * 0.07)
            }
            .overlay {
                Text("7")
                    .font(Theme.display(width * 0.46))
                    .foregroundStyle(Theme.goldGradient)
                    .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
            }
            .overlay(RoundedRectangle(cornerRadius: r).strokeBorder(Theme.cream.opacity(0.9), lineWidth: max(1.5, width * 0.03)))
            .frame(width: width, height: width * 1.4)
            .shadow(color: .black.opacity(0.35), radius: 2, y: 1.5)
    }
}

/// The draw pile. A stack of backs as deep as the deck, and the way to hit:
/// tap it, or take hold of the top card and peel it up off the pile. The
/// face is only known once the server has dealt it, so there's nothing to
/// peek at — the card flips on its way to the player.
///
/// It riffles whenever `shuffles` changes: the deck splits in two, the
/// halves lift and fan, and they fall back together.
struct DeckView: View {
    let count: Int
    let shuffles: Int
    let canDraw: Bool
    var width: CGFloat = 96
    let onDraw: () -> Void

    @State private var peel: CGFloat = 0
    @GestureState private var pressing = false

    /// One layer of the stack per handful of cards, so a thinning deck looks it.
    private var layers: Int { max(1, min(7, Int((Double(count) / 14).rounded(.up)))) }

    var body: some View {
        let lift = min(1, max(0, -peel / 90))
        ZStack {
            if count == 0 {
                RoundedRectangle(cornerRadius: width * 0.12)
                    .strokeBorder(Theme.cream.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
                    .frame(width: width, height: width * 1.4)
            }
            ForEach(0..<layers, id: \.self) { i in
                let depth = CGFloat(layers - 1 - i)
                CardBackView(width: width)
                    .offset(x: -depth * 1.2, y: depth * 2.2)
                    .modifier(RiffleHalf(trigger: shuffles, side: i.isMultiple(of: 2) ? -1 : 1, width: width))
            }
            if count > 0 {
                CardBackView(width: width)
                    // The top card peels: it lifts, hinges along its bottom
                    // edge and tilts toward you as you drag.
                    .rotation3DEffect(.degrees(Double(lift) * 38), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: 0.6)
                    .offset(y: min(0, peel) * 0.45)
                    .scaleEffect(pressing ? 0.97 : 1)
                    .shadow(color: .black.opacity(0.25 + 0.3 * lift), radius: 4 + 10 * lift, y: 3 + 8 * lift)
                    .modifier(RiffleHalf(trigger: shuffles, side: 1, width: width))
            }
        }
        .frame(width: width + 12, height: width * 1.4 + 16)
        .contentShape(Rectangle())
        .gesture(drawGesture)
        .opacity(canDraw || count == 0 ? 1 : 0.75)
        .animation(.spring(response: 0.35, dampingFraction: 0.7), value: peel)
        .animation(.easeOut(duration: 0.12), value: pressing)
        .accessibilityElement()
        .accessibilityLabel("Draw pile, \(count) cards")
        .accessibilityHint(canDraw ? "Draws a card" : "")
        .accessibilityAddTraits(canDraw ? .isButton : [])
        .accessibilityAction { if canDraw { onDraw() } }
    }

    private var drawGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($pressing) { _, state, _ in if canDraw { state = true } }
            .onChanged { value in
                guard canDraw else { return }
                peel = min(0, value.translation.height)
            }
            .onEnded { value in
                guard canDraw else { peel = 0; return }
                let dragged = value.translation.height
                let moved = hypot(value.translation.width, dragged)
                // A tap, or a peel past the point of no return, draws. A
                // half-hearted peel drops the card back on the pile.
                if moved < 8 || dragged < -60 { onDraw() }
                peel = 0
            }
    }
}

/// Half of the deck during a riffle: out to one side, lifted and bent, then
/// back in — keyed off a counter so each shuffle plays once.
private struct RiffleHalf: ViewModifier {
    let trigger: Int
    let side: CGFloat
    let width: CGFloat

    struct Pose { var x: CGFloat = 0; var y: CGFloat = 0; var angle: Double = 0 }

    func body(content: Content) -> some View {
        content.keyframeAnimator(initialValue: Pose(), trigger: trigger) { view, pose in
            view
                .rotationEffect(.degrees(pose.angle), anchor: side < 0 ? .bottomTrailing : .bottomLeading)
                .offset(x: pose.x, y: pose.y)
        } keyframes: { _ in
            KeyframeTrack(\.x) {
                SpringKeyframe(side * width * 0.62, duration: 0.28)
                LinearKeyframe(side * width * 0.62, duration: 0.18)
                SpringKeyframe(side * width * 0.08, duration: 0.42, spring: .snappy)
                SpringKeyframe(0, duration: 0.3)
            }
            KeyframeTrack(\.y) {
                SpringKeyframe(-width * 0.12, duration: 0.28)
                LinearKeyframe(-width * 0.16, duration: 0.18)
                SpringKeyframe(-width * 0.04, duration: 0.42)
                SpringKeyframe(0, duration: 0.3)
            }
            KeyframeTrack(\.angle) {
                SpringKeyframe(Double(side) * 14, duration: 0.28)
                LinearKeyframe(Double(side) * 22, duration: 0.18)
                SpringKeyframe(0, duration: 0.42)
                SpringKeyframe(0, duration: 0.3)
            }
        }
    }
}

/// A card in the air: off the top of the deck, face down, turning over on
/// the way, and landing on the player's mat.
struct FlyingCard: View {
    let flight: PlayStore.Flight
    let from: CGRect
    let to: CGRect
    let startWidth: CGFloat
    let endWidth: CGFloat

    @State private var landed = false

    var body: some View {
        let width = landed ? endWidth : startWidth
        ZStack {
            CardView(card: flight.card, width: width)
                .modifier(FaceSwap(angle: landed ? 0 : 180, back: CardBackView(width: width)))
        }
        .rotation3DEffect(.degrees(landed ? 0 : 180), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
        .rotationEffect(.degrees(landed ? 0 : -8))
        .position(landed ? CGPoint(x: to.midX, y: to.midY) : CGPoint(x: from.midX, y: from.midY))
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeInOut(duration: flight.duration)) { landed = true }
        }
    }
}

/// Shows the back while a card is turned more than halfway away. The
/// rotation itself is applied outside; this only decides which side faces
/// us at each frame of it.
private struct FaceSwap<Back: View>: ViewModifier, Animatable {
    var angle: Double
    let back: Back

    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    func body(content: Content) -> some View {
        if angle > 90 {
            // Mirrored, so it reads the right way round while turned away.
            back.scaleEffect(x: -1)
        } else {
            content
        }
    }
}
