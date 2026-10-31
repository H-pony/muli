import SwiftUI
#if os(iOS)
import UIKit
import MediaPlayer
import AVFoundation
import Combine
#endif

/// Shared Apple TV inspired materials. Content and system focus provide the emphasis.
enum Cinema {
    static let canvas = Color(red: 8 / 255, green: 9 / 255, blue: 11 / 255)
    static let surface = Color(red: 17 / 255, green: 17 / 255, blue: 20 / 255)
    static let raised = Color(red: 27 / 255, green: 27 / 255, blue: 31 / 255)
    static let chip = Color(red: 36 / 255, green: 36 / 255, blue: 40 / 255)
    static let line = Color.white.opacity(0.14)
    static let text = Color(red: 245 / 255, green: 245 / 255, blue: 247 / 255)
    static let muted = Color(red: 174 / 255, green: 174 / 255, blue: 181 / 255)
    static let faint = Color(red: 137 / 255, green: 137 / 255, blue: 145 / 255)
}

struct CinemaPillStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(primary ? Cinema.canvas : Cinema.text)
            .padding(.horizontal, 22).padding(.vertical, 15)
            .background(primary ? Cinema.text : Cinema.chip.opacity(0.88), in: Capsule())
            .overlay(Capsule().stroke(primary ? .clear : Cinema.line))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : 0.4)
    }
}

struct CinemaChip: View {
    let title: String
    let selected: Bool
    var body: some View {
        Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
            .foregroundStyle(selected ? Cinema.canvas : Cinema.muted)
            .padding(.horizontal, 18).padding(.vertical, 12)
            .background(selected ? Cinema.text : Cinema.chip.opacity(0.65), in: Capsule())
            .overlay(Capsule().stroke(selected ? .clear : Cinema.line))
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

extension View {
    func cinemaSurface(radius: CGFloat) -> some View {
        background(Cinema.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Cinema.line.opacity(0.65)))
    }

    @ViewBuilder func platformSearchStyle() -> some View {
        #if os(tvOS)
        textFieldStyle(.automatic)
        #else
        textFieldStyle(.plain)
            .padding(.horizontal, 18).padding(.vertical, 16)
            .background(Cinema.raised, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Cinema.line))
        #endif
    }

    @ViewBuilder func platformTextSelection() -> some View {
        #if os(tvOS)
        self
        #else
        textSelection(.enabled)
        #endif
    }

    @ViewBuilder func televisionFocus() -> some View {
        #if os(tvOS)
        modifier(TelevisionFocus())
        #else
        self
        #endif
    }
}

#if os(tvOS)
private struct TelevisionFocus: ViewModifier {
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .focused($focused)
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(focused ? Color.white.opacity(0.95) : .clear, lineWidth: 3)
                    .padding(-5).allowsHitTesting(false)
            }
            .shadow(color: .black.opacity(focused ? 0.45 : 0), radius: 18, y: 10)
            .scaleEffect(focused && !reduceMotion ? 1.04 : 1)
            .zIndex(focused ? 1 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: focused)
    }
}
#endif
