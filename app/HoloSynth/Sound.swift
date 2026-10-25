import AVFoundation

private let session: Void = {
    // Playback so the game is heard with the silent switch on; mixWithOthers so it never stops the player's own audio.
    _ = try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    _ = try? AVAudioSession.sharedInstance().setActive(true)
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

    var duration: TimeInterval { Self.players[self]?.duration ?? 0 }

    // One effect at a time: a new one stops whatever is still ringing. Battles space their sounds out by `duration`.
    func play() {
        guard let p = Self.players[self] else { return }
        for other in Self.players.values where other !== p && other.isPlaying { other.stop() }
        p.currentTime = 0
        p.play()
    }
}

// Music: calm loop in the menus, intense loop in battles. WAVs because AAC adds a gap at the loop point.
// Stays off if other audio (the player's own music) is already playing.
enum Music {
    enum Track: String, CaseIterable { case menu, battle }
    private static let volume: [Track: Float] = [.menu: 0.3, .battle: 0.4]
    private static var current: Track?
    private static var generation = 0
    private static let players: [Track: AVAudioPlayer] = {
        _ = session
        var out: [Track: AVAudioPlayer] = [:]
        for t in Track.allCases {
            if let url = Bundle.main.url(forResource: t.rawValue, withExtension: "wav"),
               let p = try? AVAudioPlayer(contentsOf: url) {
                p.numberOfLoops = -1
                p.prepareToPlay()
                out[t] = p
            }
        }
        return out
    }()

    static func play(_ track: Track) {
        guard track != current, !AVAudioSession.sharedInstance().isOtherAudioPlaying else { return }
        fadeOut()
        generation += 1     // cancels a pending stop if this same track is coming back
        current = track
        guard let p = players[track] else { return }
        p.currentTime = 0
        p.volume = 0
        p.play()
        p.setVolume(volume[track] ?? 0.3, fadeDuration: 1.0)
    }

    static func stop() {
        fadeOut()
        current = nil
    }

    private static func fadeOut() {
        guard let old = current, let p = players[old], p.isPlaying else { return }
        generation += 1
        let mine = generation
        p.setVolume(0, fadeDuration: 0.8)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) { if generation == mine || current != old { p.stop() } }
    }
}
