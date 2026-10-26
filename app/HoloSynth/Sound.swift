import AVFoundation

private let session: Void = {
    // Playback so the game is heard with the silent switch on; mixWithOthers so it never stops the player's own audio.
    _ = try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    _ = try? AVAudioSession.sharedInstance().setActive(true)
}()

// The Profile tab's switches (on unless turned off).
enum AudioPrefs {
    static var music: Bool { UserDefaults.standard.object(forKey: "music") as? Bool ?? true }
    static var effects: Bool { UserDefaults.standard.object(forKey: "effects") as? Bool ?? true }
}

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
        guard AudioPrefs.effects, let p = Self.players[self] else { return }
        for other in Self.players.values where other !== p && other.isPlaying { other.stop() }
        p.currentTime = 0
        p.play()
    }
}

// Music: calm loop in the menus, intense loop in battles. WAVs because AAC adds a gap at the loop point.
// Mixes with other apps' audio rather than going quiet for it.
enum Music {
    enum Track: String, CaseIterable { case menu, battle }
    private static let volume: [Track: Float] = [.menu: 0.5, .battle: 0.6]
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
        guard track != current else { return }
        fadeOut()
        generation += 1     // cancels a pending stop if this same track is coming back
        current = track
        start(track)
    }

    // Coming back to the app (or a play() that failed during launch): get the current track going again.
    static func resume() {
        guard let t = current, players[t]?.isPlaying == false else { if current == nil { play(.menu) }; return }
        start(t)
    }

    // The Music switch: off pauses the loop, on picks it back up.
    static func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "music")
        if on, let t = current { start(t) } else if !on { players.values.forEach { $0.stop() } }
    }

    private static func start(_ track: Track) {
        guard AudioPrefs.music, let p = players[track] else { return }
        _ = try? AVAudioSession.sharedInstance().setActive(true)
        p.currentTime = 0
        p.volume = volume[track] ?? 0.3   // no fade-in: a fade started right after play() can leave the volume stuck at 0
        p.play()
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

// The pack rip: a looping tear sound that plays while the finger is moving across the pack and goes quiet when it stops.
enum Rip {
    private static var lastMove = Date.distantPast
    private static let player: AVAudioPlayer? = {
        _ = session
        guard let url = Bundle.main.url(forResource: "rip", withExtension: "wav"),
              let p = try? AVAudioPlayer(contentsOf: url) else { return nil }
        p.numberOfLoops = -1
        p.prepareToPlay()
        return p
    }()

    // Call on every drag step; `speed` 0…1 sets how loud the rip is.
    static func scratch(speed: Double) {
        guard AudioPrefs.effects, let p = player else { return }
        lastMove = Date()
        if !p.isPlaying { p.volume = 0; p.play() }
        p.setVolume(Float(0.35 + 0.65 * min(1, speed)), fadeDuration: 0.04)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            if Date().timeIntervalSince(lastMove) >= 0.11 { p.setVolume(0, fadeDuration: 0.06) }   // finger stopped
        }
    }

    static func end() {
        guard let p = player, p.isPlaying else { return }
        p.setVolume(0, fadeDuration: 0.05)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { p.stop(); p.currentTime = 0 }
    }
}
