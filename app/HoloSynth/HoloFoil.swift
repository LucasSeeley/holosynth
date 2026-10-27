import SwiftUI
import CoreMotion

// Holo cards: a rainbow foil sheen and border that shift as you tilt the phone (and drift slowly on their own).
struct HoloFoil: ViewModifier {
    let on: Bool
    let width: CGFloat
    @ObservedObject private var tilt = Tilt.shared

    static let rainbow = [0xFF3D6E, 0xFFB03D, 0xFFF03D, 0x3DFF8A, 0x3DD6FF, 0x8A5CFF, 0xFF3DF0].map { Color(hex: UInt32($0)) }

    @ViewBuilder func body(content: Content) -> some View {
        if on {
            let corner = width * 0.06
            let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
            TimelineView(.animation(minimumInterval: 1 / 30)) { time in
                let drift = sin(time.date.timeIntervalSinceReferenceDate * 0.6) * 0.15
                let shift = CGFloat(tilt.roll * 0.6 + tilt.pitch * 0.3 + drift)
                content
                    .overlay {
                        ZStack {
                            LinearGradient(colors: Self.rainbow, startPoint: UnitPoint(x: -0.6 + shift, y: 0), endPoint: UnitPoint(x: 1.4 + shift, y: 1))
                                .opacity(0.22).blendMode(.colorDodge)
                            LinearGradient(stops: [.init(color: .clear, location: 0.3), .init(color: .white.opacity(0.5), location: 0.45),
                                                   .init(color: .clear, location: 0.58)],
                                           startPoint: UnitPoint(x: -0.5 + shift * 1.5, y: 0), endPoint: UnitPoint(x: 0.5 + shift * 1.5, y: 1))
                                .blendMode(.overlay)
                            Sparkles(phase: shift)
                        }
                        .clipShape(shape)
                        .allowsHitTesting(false)
                    }
                    .overlay(shape.strokeBorder(AngularGradient(colors: Self.rainbow + [Self.rainbow[0]], center: .center,
                                                                angle: .degrees(Double(shift) * 120)),
                                                lineWidth: max(1.5, width * 0.016)))
                    .shadow(color: Color(hex: 0x8CC8FF).opacity(0.5), radius: width * 0.07)
            }
            .onAppear { tilt.start() }
            .onDisappear { tilt.stop() }
            .accessibilityLabel("Holo")
        } else {
            content
        }
    }
}

// A few white glints that twinkle with the foil.
private struct Sparkles: View {
    let phase: CGFloat
    private static let spots: [(CGFloat, CGFloat, CGFloat)] = [(0.18, 0.22, 1), (0.72, 0.14, 1.2), (0.4, 0.62, 1), (0.84, 0.7, 1.4), (0.26, 0.88, 1), (0.6, 0.38, 1)]

    var body: some View {
        GeometryReader { g in
            ForEach(Self.spots.indices, id: \.self) { i in
                let (x, y, r) = Self.spots[i]
                Circle().fill(.white)
                    .frame(width: g.size.width * 0.02 * r, height: g.size.width * 0.02 * r)
                    .blur(radius: 0.6)
                    .opacity(0.35 + 0.6 * abs(sin(Double(phase) * 6 + Double(i))))
                    .position(x: g.size.width * x, y: g.size.height * y)
            }
        }
    }
}

// Phone tilt, shared by every holo card on screen; motion updates run only while one is showing.
final class Tilt: ObservableObject {
    static let shared = Tilt()
    @Published var roll = 0.0
    @Published var pitch = 0.0
    private let motion = CMMotionManager()
    private var users = 0

    func start() {
        users += 1
        guard users == 1, motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1 / 30
        motion.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
            guard let m else { return }
            self?.roll = max(-1, min(1, m.attitude.roll))
            self?.pitch = max(-1, min(1, m.attitude.pitch - 0.6))   // phones are usually held tilted back a bit
        }
    }

    func stop() {
        users = max(0, users - 1)
        if users == 0 { motion.stopDeviceMotionUpdates() }
    }
}
