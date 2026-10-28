import AVFoundation

/// Background music for a Fugitive table, synthesised as it plays rather
/// than shipped: nothing to license, nothing to download, and it can follow
/// the game. One knob, `intensity` (0 calm … 1 Manhunt), decides what's in it:
///
/// - always: a low pulse on the beat, and a slow minor bass figure;
/// - from 0.3: a ticking clock on the off-beats;
/// - from 0.55: a heartbeat under the bar;
/// - from 0.75: a high ostinato, and the tempo climbs from 84 to 132.
///
/// The session is `.ambient`, like the sounds: it follows the silent switch
/// and mixes with whatever's playing. Off unless turned on (Settings and
/// the table's toolbar).
@MainActor
final class Music {
    static let shared = Music()

    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "musicOn") as? Bool ?? false }
        set {
            UserDefaults.standard.set(newValue, forKey: "musicOn")
            if !newValue { shared.stop() }
        }
    }

    private let engine = AVAudioEngine()
    private let state = Score()
    private var node: AVAudioSourceNode?
    private(set) var playing = false

    private init() {}

    /// Starts (or keeps playing) at this intensity; fades in from silence.
    func play(intensity: Double) {
        state.target = Float(max(0, min(1, intensity)))
        guard Self.enabled else { return }
        // Back before a fade-out finished (a table left and reopened, a
        // rematch): cancel it, or its stop would silence the new game.
        state.fadingOut = false
        if !playing { start() }
    }

    func stop() {
        guard playing else { return }
        state.fadingOut = true
        // Let the fade finish before the engine stops.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(900))
            guard state.fadingOut else { return }
            engine.stop()
            playing = false
        }
    }

    private func start() {
        if node == nil {
            let format = AVAudioFormat(standardFormatWithSampleRate: Score.rate, channels: 1)!
            let source = AVAudioSourceNode(format: format, renderBlock: Score.renderBlock(state))
            engine.attach(source)
            engine.connect(source, to: engine.mainMixerNode, format: format)
            engine.mainMixerNode.outputVolume = 0.55
            node = source
        }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        state.fadingOut = false
        do { try engine.start() } catch { return }
        playing = true
    }
}

/// The music's state, shared with the audio thread. Plain floats, written
/// on the main actor and read in the render block: a torn read costs one
/// sample's worth of a slightly wrong number, which nobody can hear.
private nonisolated final class Score: @unchecked Sendable {
    static let rate = 44_100.0

    var target: Float = 0
    var fadingOut = false

    // Audio thread only.
    var intensity: Float = 0
    var level: Float = 0
    var time = 0.0
    var beatPhase = 0.0
    var lastBeat = -1
    var phases = [Double](repeating: 0, count: 6)
    var envs = [Float](repeating: 0, count: 6)
    var freqs = [Double](repeating: 0, count: 6)
    var noise: UInt32 = 0x1234_5678

    /// A D minor figure for the bass, one note a beat, eight beats round.
    static let bass: [Double] = [73.42, 73.42, 87.31, 73.42, 65.41, 73.42, 98.0, 92.5]
    /// The high ostinato, two notes a beat.
    static let high: [Double] = [587.33, 698.46, 880.0, 698.46, 587.33, 554.37, 587.33, 659.25]

    static func renderBlock(_ score: Score) -> AVAudioSourceNodeRenderBlock {
        { _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard let out = buffers.first?.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            for i in 0..<Int(frameCount) { out[i] = score.next() }
            return noErr
        }
    }

    private func random() -> Float {
        noise ^= noise << 13; noise ^= noise >> 17; noise ^= noise << 5
        return Float(noise) / Float(UInt32.max) * 2 - 1
    }

    /// One sample.
    func next() -> Float {
        let dt = 1 / Self.rate
        // Follow the game slowly, so a change swells rather than jumps.
        intensity += (target - intensity) * 0.00002
        level += ((fadingOut ? 0 : 1) - level) * 0.00004
        let tempo = 84 + 48 * Double(max(0, intensity - 0.75) / 0.25)
        beatPhase += dt * tempo / 60
        let beat = Int(beatPhase * 2)            // in half-beats
        if beat != lastBeat {
            lastBeat = beat
            strike(beat)
        }
        time += dt

        var sample: Float = 0
        // 0: pulse — a soft low thump on each beat.
        // 1: bass — a sine an octave down, sustained.
        // 2: tick — filtered noise.
        // 3: heartbeat.
        // 4: ostinato — a plucked triangle.
        for voice in 0..<5 {
            guard envs[voice] > 0.0005 else { continue }
            phases[voice] += freqs[voice] * dt
            let p = phases[voice] - floor(phases[voice])
            let wave: Float
            switch voice {
            case 2: wave = random() * 0.6
            case 4: wave = Float(p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 0.5
            default: wave = Float(sin(2 * .pi * p))
            }
            sample += wave * envs[voice]
            envs[voice] *= [0.99975, 0.99996, 0.9985, 0.9993, 0.99975][voice]
        }
        return max(-1, min(1, sample * level * 0.8))
    }

    private func strike(_ halfBeat: Int) {
        let onBeat = halfBeat % 2 == 0
        let beatNumber = halfBeat / 2
        if onBeat {
            freqs[0] = 55; envs[0] = 0.32; phases[0] = 0
            freqs[1] = Self.bass[beatNumber % Self.bass.count]; envs[1] = 0.22
        }
        if intensity > 0.3 && !onBeat {
            freqs[2] = 1; envs[2] = 0.05 + 0.05 * intensity
        }
        if intensity > 0.55 && onBeat && beatNumber % 4 == 0 {
            freqs[3] = 48; envs[3] = 0.45; phases[3] = 0
        }
        if intensity > 0.55 && onBeat && beatNumber % 4 == 1 {
            freqs[3] = 44; envs[3] = 0.3; phases[3] = 0
        }
        if intensity > 0.75 {
            freqs[4] = Self.high[halfBeat % Self.high.count]; envs[4] = 0.07 + 0.06 * (intensity - 0.75) * 4
        }
    }
}
