import AVFoundation

/// The table's sounds, synthesised at launch rather than shipped as files:
/// nothing to license, nothing to download, and every one is a few lines of
/// arithmetic on noise and sine waves.
///
/// The session is `.ambient`: it respects the ring/silent switch and mixes
/// with whatever music is on at the table, which is what a game should do.
/// Settings → Sounds turns it off entirely.
@MainActor
final class Sound {
    static let shared = Sound()

    enum Effect: CaseIterable {
        /// A card flicked off the deck.
        case flick
        /// A card landing on the felt.
        case land
        /// A riffle shuffle and the bridge that squares the deck.
        case riffle
        /// A duplicate: a low thud.
        case bust
        /// Seven numbers: a bright arpeggio.
        case flip7
        /// A Freeze handed out: an icy shimmer.
        case freeze
        /// Flip Three handed out: three quick flicks.
        case flipThree
        /// A Second Chance spent.
        case saved
        /// A player stays: a knuckle on the table.
        case stay
        /// It's your turn (on your own phone).
        case turn
        /// Fugitive: a hideout slid face down onto the trail.
        case slide
        /// Fugitive: a rubber stamp — FOUND, NOT HERE.
        case stamp
        /// Fugitive: a guess that found nothing.
        case miss
        /// Fugitive: a Manhunt, two tones like a siren.
        case siren
        /// Fugitive: the plane out at 42.
        case escape
        /// Fugitive: the cell door, when the Marshal finds them all.
        case caught
        /// Fugitive: a found hideout turned over — a snap and a rising sting.
        case reveal
    }

    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "soundOn") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "soundOn") }
    }

    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var next = 0
    private var buffers: [Effect: AVAudioPCMBuffer] = [:]
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var started = false

    private init() {
        for _ in 0..<8 {
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            players.append(node)
        }
        engine.mainMixerNode.outputVolume = 0.9
        for effect in Effect.allCases { buffers[effect] = Synth.render(effect, format: format) }
    }

    func play(_ effect: Effect, volume: Float = 1) {
        guard Self.enabled, let buffer = buffers[effect] else { return }
        if !started {
            try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            do { try engine.start() } catch { return }
            started = true
        }
        // A small pool of voices, round-robin, so a fast deal overlaps rather
        // than cutting itself off.
        let node = players[next]
        next = (next + 1) % players.count
        node.volume = volume
        node.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !node.isPlaying { node.play() }
    }
}

/// The synthesis. Each effect is a short mono buffer built from a handful of
/// primitives: filtered noise bursts (paper), decaying sines (thuds, chimes).
private enum Synth {
    static let rate: Double = 44_100

    static func render(_ effect: Sound.Effect, format: AVAudioFormat) -> AVAudioPCMBuffer {
        var out: [Float]
        switch effect {
        case .flick:
            out = noiseBurst(duration: 0.045, decay: 0.012, highpass: 0.9, gain: 0.55)
        case .land:
            out = noiseBurst(duration: 0.12, decay: 0.035, highpass: 0.35, lowpass: 0.25, gain: 0.5)
            mix(&out, thump(freq: 140, to: 90, duration: 0.08, gain: 0.25), at: 0)
        case .riffle:
            out = riffle()
        case .bust:
            out = thump(freq: 82, to: 44, duration: 0.42, gain: 0.95)
            mix(&out, noiseBurst(duration: 0.06, decay: 0.015, highpass: 0.5, gain: 0.35), at: 0)
        case .flip7:
            out = []
            for (i, f) in [523.25, 659.25, 783.99, 1046.5, 1318.5].enumerated() {
                mix(&out, chime(freq: f, duration: 0.55, gain: 0.32), at: Int(Double(i) * 0.075 * rate))
            }
        case .freeze:
            out = []
            for (i, f) in [2093.0, 2637.0, 3136.0, 2349.0].enumerated() {
                mix(&out, chime(freq: f, duration: 0.5, gain: 0.12, shimmer: true), at: Int(Double(i) * 0.05 * rate))
            }
        case .flipThree:
            out = []
            for i in 0..<3 {
                mix(&out, noiseBurst(duration: 0.045, decay: 0.012, highpass: 0.9, gain: 0.5), at: Int(Double(i) * 0.09 * rate))
            }
        case .saved:
            out = chime(freq: 880, duration: 0.25, gain: 0.25)
            mix(&out, chime(freq: 1318.5, duration: 0.35, gain: 0.22), at: Int(0.08 * rate))
        case .stay:
            out = thump(freq: 210, to: 160, duration: 0.09, gain: 0.5)
            mix(&out, thump(freq: 210, to: 160, duration: 0.09, gain: 0.4), at: Int(0.13 * rate))
        case .turn:
            out = chime(freq: 659.25, duration: 0.3, gain: 0.22)
            mix(&out, chime(freq: 987.77, duration: 0.4, gain: 0.2), at: Int(0.12 * rate))
        case .slide:
            // A card pushed across the table, then set down.
            out = noiseBurst(duration: 0.26, decay: 0.09, highpass: 0.3, lowpass: 0.18, gain: 0.4)
            mix(&out, thump(freq: 150, to: 100, duration: 0.07, gain: 0.25), at: Int(0.2 * rate))
        case .stamp:
            out = thump(freq: 95, to: 58, duration: 0.24, gain: 0.95)
            mix(&out, noiseBurst(duration: 0.06, decay: 0.015, highpass: 0, lowpass: 0.35, gain: 0.45), at: 0)
        case .miss:
            out = thump(freq: 240, to: 150, duration: 0.18, gain: 0.35)
            mix(&out, thump(freq: 180, to: 110, duration: 0.2, gain: 0.3), at: Int(0.12 * rate))
        case .siren:
            out = []
            for i in 0..<4 {
                let high = i % 2 == 0
                mix(&out, sweep(from: high ? 880 : 660, to: high ? 660 : 880, duration: 0.42, gain: 0.16),
                    at: Int(Double(i) * 0.42 * rate))
            }
        case .escape:
            out = noiseBurst(duration: 1.1, decay: 0.45, highpass: 0, lowpass: 0.08, gain: 0.3)
            mix(&out, sweep(from: 220, to: 880, duration: 1.1, gain: 0.12), at: 0)
            mix(&out, chime(freq: 1318.5, duration: 0.6, gain: 0.16), at: Int(0.95 * rate))
        case .caught:
            // A barred door slammed, its ring, then three falling low notes:
            // dun, dun, DUN.
            out = thump(freq: 80, to: 44, duration: 0.42, gain: 0.95)
            mix(&out, noiseBurst(duration: 0.08, decay: 0.02, highpass: 0, lowpass: 0.4, gain: 0.5), at: 0)
            for (f, g) in [(420.0, Float(0.2)), (1260.0, Float(0.11)), (2390.0, Float(0.07))] {
                mix(&out, chime(freq: f, duration: 0.9, gain: g), at: Int(0.01 * rate))
            }
            for (i, f) in [196.0, 185.0, 146.83].enumerated() {
                mix(&out, chime(freq: f, duration: i == 2 ? 1.4 : 0.35, gain: 0.3), at: Int((0.55 + Double(i) * 0.32) * rate))
                mix(&out, chime(freq: f / 2, duration: i == 2 ? 1.4 : 0.35, gain: 0.25), at: Int((0.55 + Double(i) * 0.32) * rate))
            }
        case .reveal:
            // A card snapped over, a knock, and two notes rising.
            out = noiseBurst(duration: 0.06, decay: 0.014, highpass: 0.85, gain: 0.6)
            mix(&out, thump(freq: 130, to: 80, duration: 0.14, gain: 0.55), at: Int(0.02 * rate))
            mix(&out, chime(freq: 587.33, duration: 0.3, gain: 0.2), at: Int(0.08 * rate))
            mix(&out, chime(freq: 880, duration: 0.5, gain: 0.22), at: Int(0.2 * rate))
        }

        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(max(out.count, 1)))!
        buffer.frameLength = AVAudioFrameCount(out.count)
        if let channel = buffer.floatChannelData?[0] {
            for i in out.indices { channel[i] = max(-1, min(1, out[i])) }
        }
        return buffer
    }

    /// Paper: white noise, a fast attack, an exponential decay, shaped by
    /// one-pole filters (higher `highpass` = thinner and snappier).
    static func noiseBurst(duration: Double, decay: Double, highpass: Float = 0,
                           lowpass: Float = 1, gain: Float) -> [Float] {
        let n = Int(duration * rate)
        var out = [Float](repeating: 0, count: n)
        var rng = SystemRandomNumberGenerator()
        var lp: Float = 0, hpPrev: Float = 0, hpOut: Float = 0
        for i in 0..<n {
            let t = Double(i) / rate
            let env = Float(min(1, t / 0.002) * exp(-t / decay))
            let white = Float.random(in: -1...1, using: &rng)
            lp += lowpass * (white - lp)
            hpOut = highpass * (hpOut + lp - hpPrev)
            hpPrev = lp
            let shaped = highpass > 0 ? hpOut : lp
            out[i] = shaped * env * gain
        }
        return out
    }

    /// A body hitting the table: a sine sliding down in pitch, decaying.
    static func thump(freq: Double, to end: Double, duration: Double, gain: Float) -> [Float] {
        let n = Int(duration * rate)
        var phase = 0.0
        return (0..<n).map { i in
            let t = Double(i) / rate
            let f = freq + (end - freq) * min(1, t / duration)
            phase += 2 * .pi * f / rate
            return Float(sin(phase) * exp(-t / (duration / 3.5))) * gain
        }
    }

    /// A struck bell: a sine with a little octave, decaying; `shimmer` adds a
    /// fast tremolo for the Freeze.
    static func chime(freq: Double, duration: Double, gain: Float, shimmer: Bool = false) -> [Float] {
        let n = Int(duration * rate)
        return (0..<n).map { i in
            let t = Double(i) / rate
            let env = min(1, t / 0.004) * exp(-t / (duration / 4))
            let trem = shimmer ? 0.7 + 0.3 * sin(2 * .pi * 18 * t) : 1
            let tone = sin(2 * .pi * freq * t) + 0.25 * sin(2 * .pi * freq * 2 * t)
            return Float(tone * env * trem) * gain
        }
    }

    /// A steady tone gliding from one pitch to another, for the siren and
    /// the plane: short fades so it neither clicks nor rings on.
    static func sweep(from start: Double, to end: Double, duration: Double, gain: Float) -> [Float] {
        let n = Int(duration * rate)
        var phase = 0.0
        return (0..<n).map { i in
            let t = Double(i) / rate
            let f = start + (end - start) * t / duration
            phase += 2 * .pi * f / rate
            let env = min(1, t / 0.02) * min(1, (duration - t) / 0.03)
            return Float(sin(phase) * env) * gain
        }
    }

    /// Two halves of a deck riffled together — a fast run of flicks that
    /// speeds up then tails off — then the bridge, a soft rush of paper.
    static func riffle() -> [Float] {
        var out: [Float] = []
        var t = 0.04
        let count = 46
        for k in 0..<count {
            let x = Double(k) / Double(count - 1)
            let gap = 0.024 - 0.014 * sin(.pi * x)   // tighter in the middle
            let gain = Float(0.28 + 0.25 * sin(.pi * x)) * Float.random(in: 0.75...1)
            mix(&out, noiseBurst(duration: 0.03, decay: 0.006, highpass: 0.92, gain: gain), at: Int(t * rate))
            t += gap
        }
        mix(&out, noiseBurst(duration: 0.35, decay: 0.11, highpass: 0.4, lowpass: 0.3, gain: 0.35),
            at: Int((t + 0.06) * rate))
        return out
    }

    static func mix(_ out: inout [Float], _ part: [Float], at offset: Int) {
        if out.count < offset + part.count { out += [Float](repeating: 0, count: offset + part.count - out.count) }
        for i in part.indices { out[offset + i] += part[i] }
    }
}
