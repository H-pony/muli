#if os(iOS)
import SwiftUI
import UIKit
import MediaPlayer
import AVFoundation
import Combine

@MainActor
private final class PlayerOrientationPolicy {
    static let shared = PlayerOrientationPolicy()
    private let masks = NSMapTable<UIWindow, NSNumber>(keyOptions: .weakMemory, valueOptions: .strongMemory)

    func set(_ mask: UIInterfaceOrientationMask?, for window: UIWindow) {
        if let mask { masks.setObject(NSNumber(value: mask.rawValue), forKey: window) }
        else { masks.removeObject(forKey: window) }
    }
    func mask(for window: UIWindow?) -> UIInterfaceOrientationMask? {
        guard let window, let value = masks.object(forKey: window) else { return nil }
        return UIInterfaceOrientationMask(rawValue: value.uintValue)
    }
}

@MainActor
final class KongwoOrientationDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        if let mask = PlayerOrientationPolicy.shared.mask(for: window) { return mask }
        return (window?.traitCollection.userInterfaceIdiom ?? UIDevice.current.userInterfaceIdiom) == .pad ? .all : .allButUpsideDown
    }
}

@MainActor
final class PlaybackSystemControls: ObservableObject {
    @Published private(set) var brightness: Double = 0.5
    @Published private(set) var volume: Double = Double(AVAudioSession.sharedInstance().outputVolume)
    @Published private(set) var canChangeVolume = false
    @Published private(set) var safeAreaInsets = UIEdgeInsets.zero
    private weak var volumeView: MPVolumeView?
    private weak var playbackWindow: UIWindow?
    private weak var screen: UIScreen?
    private var isOrientationLocked = false
    private var originalBrightness: CGFloat?
    private var originalIdleTimer: Bool?
    private var originalOrientation: UIInterfaceOrientation?
    private var requestedOrientation = false
    private var active = true
    private var volumeObservation: NSKeyValueObservation?

    init() {
        volumeObservation = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.initial, .new]) { [weak self] session, _ in
            Task { @MainActor [weak self] in self?.volume = Double(session.outputVolume) }
        }
    }

    private var volumeSlider: UISlider? {
        // Public MPVolumeView and UISlider APIs only; no private names, KVC or AVPlayer.volume.
        volumeView?.subviews.compactMap { $0 as? UISlider }.first
    }

    func attach(_ view: MPVolumeView) {
        volumeView = view
        guard let scene = view.window?.windowScene else { return }
        if playbackWindow !== view.window {
            if let playbackWindow { PlayerOrientationPolicy.shared.set(nil, for: playbackWindow) }
            playbackWindow = view.window
            if isOrientationLocked { setOrientationLocked(true) }
        }
        if let insets = view.window?.safeAreaInsets, safeAreaInsets != insets { safeAreaInsets = insets }
        if screen !== scene.screen {
            restoreBrightness()
            screen = scene.screen
        }
        if active, originalBrightness == nil { originalBrightness = scene.screen.brightness }
        if originalOrientation == nil { originalOrientation = scene.interfaceOrientation }
        let currentBrightness = Double(scene.screen.brightness)
        if brightness != currentBrightness { brightness = currentBrightness }
        let available = volumeSlider?.isEnabled == true
        if canChangeVolume != available { canChangeVolume = available }
    }

    func activate() {
        active = true
        if originalIdleTimer == nil { originalIdleTimer = UIApplication.shared.isIdleTimerDisabled }
        UIApplication.shared.isIdleTimerDisabled = true
        if let view = volumeView { attach(view) }
    }

    func deactivate() {
        active = false
        restoreBrightness()
        if let originalIdleTimer { UIApplication.shared.isIdleTimerDisabled = originalIdleTimer }
        originalIdleTimer = nil
    }

    func setBrightness(_ value: Double) {
        guard active, let screen else { return }
        if originalBrightness == nil { originalBrightness = screen.brightness }
        screen.brightness = CGFloat(min(max(value, 0), 1))
        brightness = Double(screen.brightness)
    }

    private func restoreBrightness() {
        if let originalBrightness, let screen { screen.brightness = originalBrightness }
        originalBrightness = nil
        if let screen { brightness = Double(screen.brightness) }
    }

    @discardableResult func setVolume(_ value: Double) -> Bool {
        guard let slider = volumeSlider, slider.isEnabled else {
            canChangeVolume = false
            return false
        }
        if !canChangeVolume { canChangeVolume = true }
        slider.setValue(Float(min(max(value, 0), 1)), animated: false)
        slider.sendActions(for: .valueChanged)
        slider.sendActions(for: .touchUpInside)
        // Read the actual system output volume instead of assuming the requested value applied.
        volume = Double(AVAudioSession.sharedInstance().outputVolume)
        return true
    }

    func setOrientationLocked(_ locked: Bool) {
        isOrientationLocked = locked
        guard let window = playbackWindow, let scene = window.windowScene else { return }
        let mask: UIInterfaceOrientationMask?
        if locked {
            switch scene.interfaceOrientation {
            case .landscapeLeft: mask = .landscapeLeft
            case .landscapeRight: mask = .landscapeRight
            case .portraitUpsideDown: mask = .portraitUpsideDown
            default: mask = .portrait
            }
        } else { mask = nil }
        PlayerOrientationPolicy.shared.set(mask, for: window)
        window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        window.rootViewController?.presentedViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        if let mask { scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) }
    }

    func requestOrientation(landscape: Bool, onFailure: @escaping () -> Void) {
        guard let scene = playbackWindow?.windowScene else { onFailure(); return }
        requestedOrientation = true
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscape : .portrait)) { _ in
            Task { @MainActor in onFailure() }
        }
    }

    func restoreOrientation() {
        guard requestedOrientation, let scene = playbackWindow?.windowScene, let originalOrientation else { return }
        let mask: UIInterfaceOrientationMask
        switch originalOrientation {
        case .landscapeLeft: mask = .landscapeLeft
        case .landscapeRight: mask = .landscapeRight
        case .portraitUpsideDown: mask = .portraitUpsideDown
        default: mask = .portrait
        }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        requestedOrientation = false
    }
}

struct SystemVolumeHost: UIViewRepresentable {
    let controls: PlaybackSystemControls
    func makeUIView(context: Context) -> VolumeHostView {
        let view = VolumeHostView(frame: .zero)
        view.showsVolumeSlider = true
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.onReady = { [weak controls] view in controls?.attach(view) }
        return view
    }
    func updateUIView(_ view: VolumeHostView, context: Context) {
        DispatchQueue.main.async { [weak controls, weak view] in
            if let view { controls?.attach(view) }
        }
    }
}

final class VolumeHostView: MPVolumeView {
    var onReady: ((MPVolumeView) -> Void)?
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { DispatchQueue.main.async { [weak self] in if let self { self.onReady?(self) } } }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if window != nil { DispatchQueue.main.async { [weak self] in if let self { self.onReady?(self) } } }
    }
}

enum PlayerPanIntent { case seek, brightness, volume }

/// UIKit recognizers give cancellation and touch-count handling explicit semantics.
struct PlayerGestureSurface: UIViewRepresentable {
    var disabled: Bool
    var resetID: Int
    var onSingleTap: () -> Void
    var onDoubleTap: () -> Void
    var onHold: (Bool) -> Void
    var onPanBegan: (PlayerPanIntent) -> Void
    var onPanChanged: (PlayerPanIntent, CGSize, CGSize) -> Void
    var onPanEnded: (PlayerPanIntent, Bool) -> Void
    var onCancelled: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> GestureTouchView {
        let view = GestureTouchView()
        view.backgroundColor = .clear
        view.isMultipleTouchEnabled = true
        view.accessibilityElementsHidden = true
        context.coordinator.install(on: view)
        return view
    }
    func updateUIView(_ view: GestureTouchView, context: Context) { context.coordinator.update(self) }
    static func dismantleUIView(_ view: GestureTouchView, coordinator: Coordinator) { coordinator.cancel(emit: true) }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PlayerGestureSurface
        private weak var view: UIView?
        private var single: UITapGestureRecognizer!
        private var double: UITapGestureRecognizer!
        private var pan: UIPanGestureRecognizer!
        private var hold: UILongPressGestureRecognizer!
        private var touchGuard: PlayerMultiTouchGuard!
        private var panIntent: PlayerPanIntent?
        private var panStart = CGPoint.zero
        private var holding = false
        private var multipleTouches = false

        init(_ parent: PlayerGestureSurface) { self.parent = parent }

        func install(on view: GestureTouchView) {
            self.view = view
            single = UITapGestureRecognizer(target: self, action: #selector(tapped))
            double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped))
            double.numberOfTapsRequired = 2
            pan = UIPanGestureRecognizer(target: self, action: #selector(panned))
            pan.minimumNumberOfTouches = 1; pan.maximumNumberOfTouches = 1
            hold = UILongPressGestureRecognizer(target: self, action: #selector(held))
            hold.minimumPressDuration = 0.45; hold.allowableMovement = 10
            touchGuard = PlayerMultiTouchGuard(target: nil, action: nil)
            touchGuard.onMultipleTouches = { [weak self] in
                guard let self else { return }
                self.multipleTouches = true
                self.cancel(emit: true)
                self.parent.onCancelled()
            }
            touchGuard.onFinished = { [weak self] in
                guard let self else { return }
                self.multipleTouches = false; self.setEnabled(!self.parent.disabled)
            }
            for recognizer in [single!, double!, pan!, hold!, touchGuard!] {
                recognizer.delegate = self
                view.addGestureRecognizer(recognizer)
            }
            single.require(toFail: double)
            single.require(toFail: pan); double.require(toFail: pan)
            single.require(toFail: hold); double.require(toFail: hold)
            pan.require(toFail: hold)
            view.onDetached = { [weak self] in self?.cancel(emit: true) }
            setEnabled(!parent.disabled)
        }

        func update(_ value: PlayerGestureSurface) {
            let shouldReset = parent.resetID != value.resetID || parent.disabled != value.disabled
            parent = value
            if shouldReset { cancel(emit: false) }
            setEnabled(!parent.disabled && !multipleTouches)
        }

        private func setEnabled(_ enabled: Bool) {
            for recognizer in [single, double, pan, hold] { recognizer?.isEnabled = enabled }
        }

        func cancel(emit: Bool) {
            let intent = panIntent
            let wasHolding = holding
            panIntent = nil; holding = false
            setEnabled(false)
            if emit {
                if let intent { parent.onPanEnded(intent, false) }
                if wasHolding { parent.onHold(false) }
            }
        }

        @objc private func tapped() { if !parent.disabled { parent.onSingleTap() } }
        @objc private func doubleTapped() { if !parent.disabled { parent.onDoubleTap() } }
        @objc private func held(_ recognizer: UILongPressGestureRecognizer) {
            switch recognizer.state {
            case .began:
                guard !parent.disabled, !multipleTouches else { return }
                holding = true; parent.onHold(true)
            case .ended, .cancelled, .failed:
                if holding { holding = false; parent.onHold(false) }
            default: break
            }
        }

        @objc private func panned(_ recognizer: UIPanGestureRecognizer) {
            guard let view, !parent.disabled, !multipleTouches else { return }
            let translation = recognizer.translation(in: view)
            switch recognizer.state {
            case .began:
                let location = recognizer.location(in: view)
                panStart = CGPoint(x: location.x - translation.x, y: location.y - translation.y)
                panIntent = nil
                updatePan(translation, in: view)
            case .changed: updatePan(translation, in: view)
            case .ended, .cancelled, .failed:
                if let intent = panIntent {
                    panIntent = nil
                    parent.onPanEnded(intent, recognizer.state == .ended)
                }
            default: break
            }
        }

        private func updatePan(_ translation: CGPoint, in view: UIView) {
            if panIntent == nil {
                let x = abs(translation.x), y = abs(translation.y)
                guard max(x, y) >= 10 else { return }
                // Lock the initial direction; diagonal jitter cannot switch modes mid-drag.
                if x > y * 1.25 { panIntent = .seek }
                else if y > x * 1.25 { panIntent = panStart.x < view.bounds.midX ? .brightness : .volume }
                else if max(x, y) > 26 { panIntent = x > y ? .seek : (panStart.x < view.bounds.midX ? .brightness : .volume) }
                if let intent = panIntent { parent.onPanBegan(intent) }
            }
            if let intent = panIntent {
                parent.onPanChanged(intent, CGSize(width: translation.x, height: translation.y), view.bounds.size)
            }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            gestureRecognizer === touchGuard || other === touchGuard
        }
    }
}

final class GestureTouchView: UIView {
    var onDetached: (() -> Void)?
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { onDetached?() }
    }
}

/// Remains active alongside a pan/hold so an added finger always cancels, never commits a seek.
final class PlayerMultiTouchGuard: UIGestureRecognizer {
    var onMultipleTouches: (() -> Void)?
    var onFinished: (() -> Void)?
    private var touches = Set<UITouch>()
    private var detectedMultiple = false

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        self.touches.formUnion(touches)
        detectMultiple(event)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        detectMultiple(event)
        if detectedMultiple { state = .changed }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        detectMultiple(event)
        self.touches.subtract(touches)
        if self.touches.isEmpty { state = detectedMultiple ? .ended : .failed }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        self.touches.subtract(touches)
        state = detectedMultiple ? .cancelled : .failed
    }
    private func detectMultiple(_ event: UIEvent) {
        guard max(touches.count, event.allTouches?.count ?? 0) > 1, !detectedMultiple else { return }
        detectedMultiple = true
        state = .began
        onMultipleTouches?()
    }
    override func reset() {
        super.reset()
        touches.removeAll()
        if detectedMultiple { detectedMultiple = false; onFinished?() }
    }
}

struct PlayerProgressTouchSurface: UIViewRepresentable {
    let enabled: Bool
    let resetID: Int
    let began: () -> Void
    let changed: (Double) -> Void
    let ended: (Bool) -> Void

    func makeUIView(context: Context) -> ProgressTouchView {
        let view = ProgressTouchView()
        view.isMultipleTouchEnabled = true
        view.backgroundColor = .clear
        view.accessibilityElementsHidden = true
        configure(view)
        return view
    }
    func updateUIView(_ view: ProgressTouchView, context: Context) { configure(view) }
    static func dismantleUIView(_ view: ProgressTouchView, coordinator: ()) { view.cancel(emit: true) }

    private func configure(_ view: ProgressTouchView) {
        if view.resetID != resetID || !enabled { view.cancel(emit: false) }
        view.resetID = resetID
        view.onBegan = began; view.onChanged = changed; view.onEnded = ended
        view.isUserInteractionEnabled = enabled
    }
}

final class ProgressTouchView: UIView {
    var resetID = 0
    var onBegan: (() -> Void)?
    var onChanged: ((Double) -> Void)?
    var onEnded: ((Bool) -> Void)?
    private var tracking: UITouch?
    private var blocked = false
    private var activeTouches = Set<UITouch>()

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        activeTouches.formUnion(touches)
        guard !blocked, activeTouches.count == 1, (event?.allTouches?.count ?? 1) == 1, tracking == nil, let touch = touches.first else {
            blocked = true; cancel(emit: true); return
        }
        tracking = touch
        onBegan?()
        update(touch)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !blocked, (event?.allTouches?.count ?? 1) == 1 else { blocked = true; cancel(emit: true); return }
        if let tracking { update(tracking) }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        activeTouches.subtract(touches)
        if let tracking, touches.contains(tracking) {
            let commit = !blocked && (event?.allTouches?.count ?? 1) == 1
            if commit { update(tracking) }
            self.tracking = nil
            onEnded?(commit)
        }
        if activeTouches.isEmpty { blocked = false }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        activeTouches.subtract(touches)
        cancel(emit: true)
        if activeTouches.isEmpty { blocked = false }
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { cancel(emit: true) }
    }
    func cancel(emit: Bool) {
        guard tracking != nil else { return }
        tracking = nil
        if emit { onEnded?(false) }
    }
    private func update(_ touch: UITouch) {
        let fraction = min(max(touch.location(in: self).x / max(bounds.width, 1), 0), 1)
        onChanged?(Double(fraction))
    }
}
#endif
