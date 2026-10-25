import SwiftUI

// The look set by the login screen: dark city backdrop with a red glow, gold accents, Chakra Petch + Barlow.
extension Theme {
    static let brass = Color(hex: 0xE8B85A)
    static let ink = Color(hex: 0x07060C)
    static let field = Color(red: 18 / 255, green: 16 / 255, blue: 30 / 255).opacity(0.82)
}

extension Font {
    static func chakra(_ size: CGFloat, semibold: Bool = false) -> Font {
        .custom(semibold ? "ChakraPetch-SemiBold" : "ChakraPetch-Bold", size: size)
    }
    static func barlow(_ size: CGFloat, semibold: Bool = false) -> Font {
        .custom(semibold ? "Barlow-SemiBold" : "Barlow-Regular", size: size)
    }
}

struct ScreenBackground: View {
    var body: some View {
        ZStack {
            Theme.ink
            if let bg = Art.image("login_bg") {
                GeometryReader { geo in
                    Image(uiImage: bg).resizable().scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height).clipped()
                }
            }
            LinearGradient(stops: [
                .init(color: Theme.ink.opacity(0.55), location: 0),
                .init(color: Theme.ink.opacity(0.35), location: 0.3),
                .init(color: Theme.ink.opacity(0.85), location: 0.58),
                .init(color: Theme.ink, location: 0.75),
            ], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Theme.backRed.opacity(0.45), .clear], center: UnitPoint(x: 0.5, y: 0.38),
                           startRadius: 0, endRadius: 260)
        }
        .ignoresSafeArea()
    }
}

// Big gold call-to-action, like "CREATE ACCOUNT".
struct GoldButton: ButtonStyle {
    var height: CGFloat = 56
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.chakra(height > 50 ? 18 : 15)).tracking(2.2).textCase(.uppercase)
            .foregroundColor(Color(hex: 0x1A0D05))
            .frame(maxWidth: .infinity).frame(height: height)
            .background(LinearGradient(colors: [Color(hex: 0xFFD77A), Color(hex: 0xE0A12A)], startPoint: .top, endPoint: .bottom),
                        in: RoundedRectangle(cornerRadius: 14))
            .shadow(color: Color(hex: 0xE0A12A).opacity(0.35), radius: 12, y: 8)
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

// Quieter gold-outlined button for secondary actions.
struct OutlineButton: ButtonStyle {
    var color: Color = Theme.brass
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.chakra(14)).tracking(1.6).textCase(.uppercase)
            .foregroundColor(color)
            .padding(.horizontal, 18).frame(height: 44)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(color.opacity(0.5), lineWidth: 1))
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

extension View {
    // Dark glassy panel with a thin gold border, like the login fields.
    func goldPanel(_ radius: CGFloat = 14, lit: Bool = false) -> some View {
        background(Theme.field, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Theme.brass.opacity(lit ? 1 : 0.28), lineWidth: 1))
    }

    // Small letterspaced gold heading, like "RIP · BUILD · BATTLE".
    func sectionTitle() -> some View {
        font(.chakra(13, semibold: true)).tracking(3).textCase(.uppercase).foregroundColor(Theme.brass)
    }
}
