import AVFoundation

private let session: Void = {
    // Ambient: respects the silent switch and mixes with whatever else is playing.
    _ = try? AVAudioSession.sharedInstance().setCategory(.ambient)
}()

// Sound effects (Resources/Sounds, synthesized by scratch scripts, no licences needed).
enum Sound: String, CaseIterable {
    case select, move, hit, crit, ko, turn, victory, defeat, tear, flip, rare, legendary

    private static var players: [Sound: AVAudioPlayer] = {
        _ = session
        var out: [Sound: AVAudioPlayer] = [:]
        for s in Sound.allCases {
            if let url = Bundle.main.url(forResource: s.rawValue, withExtension: "wav"),
               let p = try? AVAudioPlayer(contentsOf: url) {
                p.prepareToPlay()
                out[s] = p
            }
        }
        return out
    }()

    func play() {
        guard let p = Self.players[self] else { return }
        p.currentTime = 0
        p.play()
    }
}

// Battle music: a seamless loop (WAV, since AAC adds a gap at the loop point). Stays off if other audio is playing.
enum Music {
    private static var generation = 0
    private static let player: AVAudioPlayer? = {
        _ = session
        guard let url = Bundle.main.url(forResource: "battle", withExtension: "wav"),
              let p = try? AVAudioPlayer(contentsOf: url) else { return nil }
        p.numberOfLoops = -1
        p.prepareToPlay()
        return p
    }()

    static func start() {
        guard !AVAudioSession.sharedInstance().isOtherAudioPlaying, let p = player else { return }
        generation += 1
        if !p.isPlaying { p.currentTime = 0; p.volume = 0; p.play() }
        p.setVolume(0.4, fadeDuration: 1.0)
    }

    static func stop() {
        guard let p = player, p.isPlaying else { return }
        generation += 1
        let mine = generation
        p.setVolume(0, fadeDuration: 0.8)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) { if generation == mine { p.stop() } }
    }
}
