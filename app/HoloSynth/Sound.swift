import AVFoundation

// Sound effects (Resources/Sounds, synthesized). Ambient session: respects the silent switch and mixes with music.
enum Sound: String, CaseIterable {
    case select, move, hit, crit, ko, turn, victory, defeat, tear, flip, rare, legendary

    private static var players: [Sound: AVAudioPlayer] = {
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
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
