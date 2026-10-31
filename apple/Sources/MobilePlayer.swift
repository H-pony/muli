#if os(iOS)
import SwiftUI
import AVKit
import UIKit

private enum PlayerPanel: String, Identifiable {
    case episodes, speed, settings
    var id: String { rawValue }
}

private struct PlayerHUD {
    var icon: String
    var title: String
    var detail: String
    var progress: Double? = nil
}

@MainActor
private final class PlaybackPictureInPicture: NSObject, ObservableObject, AVPictureInPictureControllerDelegate {
    @Published private(set) var isPossible = false
    @Published private(set) var isActive = false
    var onFailure: (() -> Void)?
    var onRestore: (() -> Void)?
    private var controller: AVPictureInPictureController?
    private var layer: AVPlayerLayer?
    private var possibleObservation: NSKeyValueObservation?
    private var leaving = false

    func attach(_ layer: AVPlayerLayer) {
        guard AVPictureInPictureController.isPictureInPictureSupported(), self.layer !== layer, controller?.isPictureInPictureActive != true else { return }
        self.layer = layer
        leaving = false
        possibleObservation = nil
        controller?.delegate = nil
        guard let controller = AVPictureInPictureController(playerLayer: layer) else { return }
        self.controller = controller
        controller.delegate = self
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        possibleObservation = controller.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] controller, _ in
            Task { @MainActor [weak self] in
                guard let self, self.controller === controller else { return }
                self.isPossible = controller.isPictureInPicturePossible
            }
        }
    }

    func detach(_ layer: AVPlayerLayer) {
        guard self.layer === layer, controller?.isPictureInPictureActive != true else { return }
        possibleObservation = nil
        controller?.delegate = nil; controller = nil; self.layer = nil
        Task { @MainActor [weak self] in
            if let self, self.controller == nil { self.isPossible = false }
        }
    }

    func toggle() {
        guard !leaving, let controller else { return }
        if controller.isPictureInPictureActive { controller.stopPictureInPicture() }
        else if controller.isPictureInPicturePossible { controller.startPictureInPicture() }
    }

    func stopForExit() {
        leaving = true
        if controller?.isPictureInPictureActive == true { controller?.stopPictureInPicture() }
        else { clear() }
    }

    private func clear() {
        possibleObservation = nil
        controller?.delegate = nil; controller = nil
        layer?.player = nil; layer = nil
        isPossible = false; isActive = false
    }

    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in self?.isActive = true }
    }
    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isActive = false
            if self.leaving { self.clear() }
        }
    }
    nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isActive = false
            if !self.leaving { self.onFailure?() }
        }
    }
    nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        let completion = PictureInPictureRestoreCompletion(complete: completionHandler)
        Task { @MainActor [weak self] in
            guard let self, !self.leaving else { completion.complete(false); return }
            self.onRestore?()
            completion.complete(true)
        }
    }
}

// The delegate completion is transferred once and invoked only on the main actor.
private struct PictureInPictureRestoreCompletion: @unchecked Sendable {
    let complete: (Bool) -> Void
}

@MainActor
private final class MobilePlaybackSession: ObservableObject {
    let model: PlaybackModel
    let system = PlaybackSystemControls()
    let pictureInPicture = PlaybackPictureInPicture()
    let repository: MediaRepository
    @Published var controlsVisible = true
    @Published var locked = false
    @Published var expanded = false
    @Published var inlineRequested = false
    @Published var fillScreen = UserDefaults.standard.bool(forKey: "playerFillScreen")
    @Published var shouldDismiss = false
    @Published var panel: PlayerPanel?
    @Published var hud: PlayerHUD?
    @Published private(set) var gestureResetID = 0
    private var controlsTask: Task<Void, Never>?
    private var hudTask: Task<Void, Never>?
    private var activePan: PlayerPanIntent?
    private var panEpisodeID: String?
    private var startPosition = 0.0
    private var startLevel = 0.0
    private var wasLandscape = false

    init(request: PlaybackRequest, store: AppStore) {
        model = PlaybackModel(request: request, store: store)
        repository = store.repository
        pictureInPicture.onFailure = { [weak self] in
            self?.flash(PlayerHUD(icon: "pip", title: "暂时无法打开画中画", detail: "可稍后重试"))
        }
        pictureInPicture.onRestore = { [weak self] in
            guard let self else { return }
            self.controlsVisible = !self.locked
            self.scheduleHide()
        }
    }

    func appear() {
        system.activate()
        scheduleHide()
    }

    func disappear() {
        cancelInteraction()
        pictureInPicture.stopForExit()
        system.setOrientationLocked(false)
        system.deactivate()
        system.restoreOrientation()
        model.stop()
    }

    func sceneChanged(_ phase: ScenePhase) {
        if phase == .active { system.activate(); scheduleHide() }
        else {
            cancelInteraction()
            system.deactivate()
            model.save()
        }
    }

    func geometryChanged(_ size: CGSize) {
        cancelInteraction()
        panel = nil
        let landscape = size.width > size.height
        if wasLandscape != landscape {
            inlineRequested = false
            if !landscape { expanded = false }
        }
        wasLandscape = landscape
        scheduleHide()
    }

    func playbackChanged() {
        if !model.isPlaying { controlsTask?.cancel(); controlsVisible = !locked }
        else { scheduleHide() }
    }

    func episodeChanged() {
        cancelInteraction()
        panel = nil
        controlsVisible = !locked
        scheduleHide()
    }

    func toggleControls() {
        guard !locked, panel == nil else { return }
        controlsTask?.cancel()
        withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeOut(duration: 0.18)) { controlsVisible.toggle() }
        if controlsVisible { scheduleHide() }
    }

    func playPause() {
        guard !locked else { return }
        cancelInteraction()
        let pausing = model.isPlaying
        model.toggle()
        controlsVisible = true
        flash(PlayerHUD(icon: pausing ? "pause.fill" : "play.fill", title: pausing ? "已暂停" : "继续播放", detail: "双击画面也可播放 / 暂停"))
        scheduleHide()
    }

    func setLocked() {
        cancelInteraction()
        panel = nil
        locked.toggle()
        system.setOrientationLocked(locked)
        controlsVisible = !locked
        if !locked { scheduleHide() }
    }

    func open(_ panel: PlayerPanel) {
        guard !locked else { return }
        cancelInteraction()
        self.panel = panel
        controlsVisible = true
    }

    func closePanel() {
        panel = nil
        scheduleHide()
    }

    func select(_ index: Int) {
        cancelInteraction()
        model.select(index)
        closePanel()
        controlsVisible = true
    }

    func setRate(_ rate: Float) {
        cancelInteraction()
        model.setRate(rate)
        closePanel()
        flash(PlayerHUD(icon: "speedometer", title: "播放速度 \(rateText(rate))×", detail: "长按画面可临时加速"))
    }

    func togglePictureInPicture() {
        cancelInteraction()
        closePanel()
        pictureInPicture.toggle()
    }

    func setFillScreen(_ value: Bool) {
        fillScreen = value
        UserDefaults.standard.set(value, forKey: "playerFillScreen")
    }

    func leaveForSource() {
        cancelInteraction()
        panel = nil
        shouldDismiss = true
    }

    func toggleFullscreen(immersive: Bool) {
        guard !locked else { return }
        cancelInteraction()
        panel = nil
        expanded = !immersive
        inlineRequested = immersive
        controlsVisible = true
        system.requestOrientation(landscape: !immersive) { [weak self] in
            guard let self else { return }
            self.flash(PlayerHUD(icon: "rotate.right", title: "已调整播放器布局", detail: "当前窗口不允许自动旋转，可转动设备观看"))
        }
        scheduleHide()
    }

    func hold(_ began: Bool) {
        guard !locked else { return }
        if began {
            controlsTask?.cancel(); hudTask?.cancel()
            if model.beginTemporaryBoost() {
                controlsVisible = false
                hud = PlayerHUD(icon: "forward.fill", title: "\(rateText(model.temporaryRate))× 倍速播放中", detail: "松手恢复 \(rateText(model.selectedRate))×")
            } else if !model.request.isLive {
                flash(PlayerHUD(icon: "pause.fill", title: "暂停中", detail: "播放后长按可临时加速"))
            }
        } else {
            let boosted = model.isBoosting
            model.endTemporaryBoost()
            if boosted { flash(PlayerHUD(icon: "speedometer", title: "已恢复 \(rateText(model.selectedRate))×", detail: "正常播放速度"), duration: 0.9) }
            scheduleHide()
        }
    }

    func beginPan(_ intent: PlayerPanIntent) {
        guard !locked else { return }
        model.endTemporaryBoost()
        controlsTask?.cancel(); hudTask?.cancel()
        activePan = intent
        panEpisodeID = model.request.current.id
        startPosition = model.position
        startLevel = intent == .brightness ? system.brightness : system.volume
        if intent == .seek, !model.canSeek {
            hud = PlayerHUD(icon: "livephoto", title: model.request.isLive ? "直播" : "正在读取进度", detail: model.request.isLive ? "此直播不支持拖动进度" : "视频就绪后可拖动跳转")
        }
    }

    func changePan(_ intent: PlayerPanIntent, translation: CGSize, size: CGSize) {
        guard activePan == intent, panEpisodeID == model.request.current.id, !locked else { return }
        switch intent {
        case .seek:
            guard model.canSeek else { return }
            let span = min(model.duration, max(60, min(180, model.duration * 0.2)))
            let target = startPosition + Double(translation.width / max(size.width, 1)) * span
            preview(target)
        case .brightness:
            system.setBrightness(startLevel - Double(translation.height / max(size.height * 0.85, 1)))
            hud = levelHUD(brightness: true)
        case .volume:
            let target = startLevel - Double(translation.height / max(size.height * 0.85, 1))
            if system.setVolume(target) { hud = levelHUD(brightness: false) }
            else { hud = PlayerHUD(icon: "speaker.slash.fill", title: "音量由输出设备控制", detail: "可使用设备或耳机的音量键") }
        }
    }

    func preview(_ target: Double) {
        guard activePan == .seek, panEpisodeID == model.request.current.id, model.canSeek, !locked else { return }
        let value = min(max(target, 0), model.duration)
        model.previewPosition = value
        let delta = value - startPosition
        let direction = delta >= 0 ? "快进" : "后退"
        hud = PlayerHUD(icon: delta >= 0 ? "goforward" : "gobackward", title: WatchEntry.time(value) + " / " + WatchEntry.time(model.duration), detail: direction + " " + WatchEntry.time(abs(delta)) + " · 松手跳转", progress: value / model.duration)
    }

    func endPan(_ intent: PlayerPanIntent, commit: Bool) {
        guard activePan == intent else { return }
        guard panEpisodeID == model.request.current.id else { cancelInteraction(); return }
        activePan = nil; panEpisodeID = nil
        if commit {
            if intent == .seek, let target = model.previewPosition { model.seek(to: target) }
        } else {
            restorePan(intent)
            hud = nil
        }
        model.previewPosition = nil
        dismissHUD(after: 0.8)
        scheduleHide()
    }

    func progressBegan() { beginPan(.seek) }
    func progressChanged(_ fraction: Double) { preview(fraction * model.duration) }
    func progressEnded(_ commit: Bool) { endPan(.seek, commit: commit) }

    func accessibleSeek(_ direction: AccessibilityAdjustmentDirection) {
        guard model.canSeek, !locked else { return }
        cancelInteraction()
        let delta: Double = direction == .increment ? 10 : -10
        let target = min(max(model.position + delta, 0), model.duration)
        model.seek(to: target)
        flash(PlayerHUD(icon: direction == .increment ? "goforward.10" : "gobackward.10", title: WatchEntry.time(target), detail: "播放进度"))
    }

    func systemVolumeChanged() {
        if activePan == .volume, system.canChangeVolume { hud = levelHUD(brightness: false) }
    }

    func cancelInteraction() {
        controlsTask?.cancel(); hudTask?.cancel()
        if let activePan { restorePan(activePan) }
        activePan = nil; panEpisodeID = nil
        model.cancelTransientPlayback()
        hud = nil
        gestureResetID += 1
    }

    private func restorePan(_ intent: PlayerPanIntent) {
        switch intent {
        case .seek: model.previewPosition = nil
        case .brightness: system.setBrightness(startLevel)
        case .volume: system.setVolume(startLevel)
        }
    }

    private func levelHUD(brightness: Bool) -> PlayerHUD {
        let value = brightness ? system.brightness : system.volume
        let icon = brightness ? "sun.max.fill" : (value > 0 ? "speaker.wave.2.fill" : "speaker.slash.fill")
        return PlayerHUD(icon: icon, title: (brightness ? "亮度 " : "音量 ") + "\(Int((value * 100).rounded()))%", detail: brightness ? "左侧上下滑动" : "右侧上下滑动 · 系统音量", progress: value)
    }

    private func flash(_ value: PlayerHUD, duration: Double = 1.3) {
        hudTask?.cancel()
        hud = value
        dismissHUD(after: duration)
    }

    private func dismissHUD(after seconds: Double) {
        hudTask?.cancel()
        hudTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self, !self.model.isBoosting, self.activePan == nil else { return }
            self.hud = nil
        }
    }

    func accessibilityChanged(_ enabled: Bool) {
        controlsTask?.cancel()
        if enabled { controlsVisible = !locked }
        else { scheduleHide() }
    }

    func gestureCancelled() {
        cancelInteraction()
        scheduleHide()
    }

    func scheduleHide() {
        controlsTask?.cancel()
        guard !UIAccessibility.isVoiceOverRunning, !locked, panel == nil, activePan == nil, !model.isBoosting, model.isPlaying else { return }
        controlsTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, let self, self.model.isPlaying, self.panel == nil, !self.locked, self.activePan == nil else { return }
            withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeOut(duration: 0.2)) { self.controlsVisible = false }
        }
    }
}

struct PlayerScreen: View {
    @StateObject private var session: MobilePlaybackSession
    init(request: PlaybackRequest, store: AppStore) {
        _session = StateObject(wrappedValue: MobilePlaybackSession(request: request, store: store))
    }
    var body: some View { MobilePlayerLayout(session: session) }
}

private struct MobilePlayerLayout: View {
    @ObservedObject var session: MobilePlaybackSession
    @ObservedObject private var model: PlaybackModel
    @ObservedObject private var system: PlaybackSystemControls
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @State private var synopsis = ""

    init(session: MobilePlaybackSession) {
        self.session = session
        model = session.model
        system = session.system
    }

    var body: some View {
        GeometryReader { geometry in
            let immersive = session.expanded || (!session.inlineRequested && geometry.size.width > geometry.size.height)
            let videoHeight = immersive ? geometry.size.height : min(geometry.size.width * 9 / 16, geometry.size.height * 0.6)
            VStack(spacing: 0) {
                if !immersive { Color.black.frame(height: system.safeAreaInsets.top) }
                VideoStage(session: session, model: model, system: system, immersive: immersive, close: {
                    if immersive { session.toggleFullscreen(immersive: true) } else { close() }
                })
                    .frame(height: videoHeight)
                if !immersive {
                    MobilePlaybackDetails(model: model, synopsis: synopsis, bottomInset: system.safeAreaInsets.bottom, select: session.select, openEpisodes: { session.open(.episodes) })
                        .allowsHitTesting(!session.locked).accessibilityHidden(session.locked)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Cinema.canvas)
            .statusBarHidden(immersive)
            .persistentSystemOverlays(immersive ? .hidden : .automatic)
            .onAppear { session.geometryChanged(geometry.size) }
            .onChange(of: geometry.size) { value in session.geometryChanged(value) }
            .sheet(item: portraitPanel(immersive: immersive)) { panel in
                if #available(iOS 16.4, *) {
                    PlayerMenu(session: session, model: model, panel: panel)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                        .presentationCornerRadius(24)
                        .presentationBackground(Cinema.surface)
                } else {
                    PlayerMenu(session: session, model: model, panel: panel)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                        .background(Cinema.surface)
                }
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
        .tint(Cinema.text)
        .onAppear { session.appear(); session.accessibilityChanged(voiceOverEnabled) }
        .onDisappear { session.disappear() }
        .onChange(of: voiceOverEnabled) { enabled in session.accessibilityChanged(enabled) }
        .onChange(of: scenePhase) { phase in session.sceneChanged(phase) }
        .onChange(of: model.request.current.id) { _ in session.episodeChanged() }
        .onChange(of: model.isPlaying) { _ in session.playbackChanged() }
        .onChange(of: model.error) { error in if error != nil { session.cancelInteraction() } }
        .onChange(of: system.volume) { _ in session.systemVolumeChanged() }
        .onChange(of: session.shouldDismiss) { value in if value { close() } }
        .task(id: model.request.film?.id) {
            guard let film = model.request.film else { return }
            if let details = try? await session.repository.details(film), !Task.isCancelled { synopsis = details.synopsis }
        }
    }

    private func portraitPanel(immersive: Bool) -> Binding<PlayerPanel?> {
        Binding(get: { immersive ? nil : session.panel }, set: { value in if value == nil { session.closePanel() } })
    }

    private func close() {
        session.disappear()
        dismiss()
    }
}

private struct VideoStage: View {
    @ObservedObject var session: MobilePlaybackSession
    @ObservedObject var model: PlaybackModel
    @ObservedObject var system: PlaybackSystemControls
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let immersive: Bool
    let close: () -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                PlayerVideoLayer(player: model.player, fillScreen: session.fillScreen, pictureInPicture: session.pictureInPicture)
                PlayerGestureSurface(disabled: session.locked || session.panel != nil, resetID: session.gestureResetID,
                    onSingleTap: session.toggleControls, onDoubleTap: session.playPause, onHold: session.hold,
                    onPanBegan: session.beginPan, onPanChanged: session.changePan, onPanEnded: { session.endPan($0, commit: $1) },
                    onCancelled: session.gestureCancelled)
                if session.controlsVisible && !session.locked {
                    PlayerControls(model: model, immersive: immersive, insets: system.safeAreaInsets, close: close,
                        playPause: session.playPause, next: { session.select(model.request.index + 1) },
                        speed: { session.open(.speed) }, episodes: { session.open(.episodes) }, more: { session.open(.settings) }, fullscreen: { session.toggleFullscreen(immersive: immersive) },
                        progressBegan: session.progressBegan, progressChanged: session.progressChanged, progressEnded: session.progressEnded,
                        accessibleSeek: session.accessibleSeek, resetID: session.gestureResetID)
                        .transition(.opacity)
                }
                if session.controlsVisible || session.locked {
                    HStack {
                        Button(action: session.setLocked) {
                            Image(systemName: session.locked ? "lock.fill" : "lock.open")
                                .font(.system(size: 18, weight: .medium)).foregroundStyle(.white)
                                .frame(width: 44, height: 44).background(.ultraThinMaterial, in: Circle())
                        }.accessibilityLabel(session.locked ? "解锁播放器" : "锁定播放器，仅保留解锁")
                        Spacer()
                    }.padding(.leading, immersive ? max(12, system.safeAreaInsets.left) : 12)
                }
                statusOverlay(width: geometry.size.width)
                    .allowsHitTesting(model.error != nil && !session.locked)
                if let hud = session.hud { PlayerHUDView(hud: hud).allowsHitTesting(false).transition(.opacity) }
                if immersive, let panel = session.panel {
                    Color.black.opacity(0.45).onTapGesture { session.closePanel() }
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        PlayerMenu(session: session, model: model, panel: panel)
                            .frame(width: min(380, max(270, geometry.size.width * 0.48)))
                            .padding(.trailing, system.safeAreaInsets.right)
                            .padding(.top, system.safeAreaInsets.top)
                            .padding(.bottom, system.safeAreaInsets.bottom)
                            .background(Cinema.surface)
                    }.transition(reduceMotion ? .opacity : .move(edge: .trailing))
                }
            }
            .background(.black)
            .overlay(alignment: .bottomTrailing) {
                // The real system volume control must stay attached to this playback window.
                SystemVolumeHost(controls: system).frame(width: 120, height: 24).opacity(0.01).allowsHitTesting(false).clipped()
            }
        }
        .clipped()
    }

    @ViewBuilder private func statusOverlay(width: CGFloat) -> some View {
        if let error = model.error {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.circle").font(.title2)
                Text(error).font(.caption).lineLimit(3).multilineTextAlignment(.center)
                if !session.locked {
                    Button("重试播放", systemImage: "arrow.clockwise") { session.cancelInteraction(); model.retry() }
                        .font(.caption.weight(.semibold)).buttonStyle(CinemaPillStyle())
                }
            }.foregroundStyle(.white).padding(16).frame(maxWidth: min(420, width * 0.7))
                .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 15))
        } else if (model.loading || model.buffering) && session.hud == nil {
            HStack(spacing: 12) {
                ProgressView().tint(.white)
                Text(model.loading ? "正在连接视频…" : "正在缓冲…").font(.caption)
            }.foregroundStyle(.white).padding(16).background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

private struct PlayerControls: View {
    @ObservedObject var model: PlaybackModel
    let immersive: Bool
    let insets: UIEdgeInsets
    let close: () -> Void
    let playPause: () -> Void
    let next: () -> Void
    let speed: () -> Void
    let episodes: () -> Void
    let more: () -> Void
    let fullscreen: () -> Void
    let progressBegan: () -> Void
    let progressChanged: (Double) -> Void
    let progressEnded: (Bool) -> Void
    let accessibleSeek: (AccessibilityAdjustmentDirection) -> Void
    let resetID: Int

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: close) { Image(systemName: "chevron.left").font(.system(size: 21, weight: .medium)).frame(width: 44, height: 44) }
                    .accessibilityLabel(immersive ? "退出全屏" : "返回影片页面")
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.request.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(model.request.current.name).font(.system(size: 10)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button(action: more) { Image(systemName: "ellipsis").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44) }
                    .accessibilityLabel("更多播放设置")
            }
            .padding(.leading, immersive ? max(8, insets.left) : 4)
            .padding(.trailing, immersive ? max(12, insets.right) : 12)
            .padding(.top, immersive ? max(6, insets.top) : 3)
            .padding(.bottom, 20)
            .background(LinearGradient(colors: [.black.opacity(0.8), .clear], startPoint: .top, endPoint: .bottom))
            Spacer(minLength: 0)
            bottomControls
        }.foregroundStyle(.white).buttonStyle(.plain)
    }

    private var bottomControls: some View {
        VStack(spacing: 0) {
            HStack(spacing: 5) {
                if model.request.isLive {
                    Circle().fill(Cinema.text).frame(width: 5, height: 5)
                    Text("直播").font(.system(size: 11, weight: .medium))
                } else {
                    Text(WatchEntry.time(model.displayedPosition)).foregroundStyle(Cinema.text)
                    Text("/ " + WatchEntry.time(model.duration)).foregroundStyle(.white.opacity(0.75))
                }
                Spacer()
            }.font(.system(size: 11, weight: .medium, design: .monospaced))
            if !model.request.isLive {
                PlayerProgressBar(model: model, resetID: resetID, began: progressBegan, changed: progressChanged, ended: progressEnded, accessibleSeek: accessibleSeek)
                    .frame(height: 28)
            } else { Color.clear.frame(height: 7) }
            HStack(spacing: 12) {
                Button(action: playPause) {
                    Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 20, weight: .semibold)).foregroundStyle(Cinema.canvas)
                        .frame(width: 48, height: 44).background(Cinema.text, in: Capsule())
                }.accessibilityLabel(model.isPlaying ? "暂停" : "播放")
                if !model.request.isLive {
                    Button(action: next) { Image(systemName: "forward.end.fill").font(.system(size: 17)).frame(width: 44, height: 44) }
                        .disabled(!model.hasNext).opacity(model.hasNext ? 1 : 0.35).accessibilityLabel("下一集")
                }
                Spacer(minLength: 2)
                if !model.request.isLive {
                    Button(action: speed) { Text(model.selectedRate == 1 ? "倍速" : rateText(model.selectedRate) + "×").font(.system(size: 12, weight: .medium)).frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("播放速度 \(rateText(model.selectedRate)) 倍")
                }
                if !model.request.isLive || model.request.episodes.count > 1 {
                    Button(action: episodes) { Text(model.request.isLive ? "频道" : "选集").font(.system(size: 12, weight: .medium)).frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel(model.request.isLive ? "选择频道" : "选择剧集")
                }
                Button(action: fullscreen) { Image(systemName: immersive ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right").font(.system(size: 18)).frame(width: 44, height: 44) }
                    .accessibilityLabel(immersive ? "退出全屏" : "全屏播放")
            }
        }
        .padding(.leading, immersive ? max(16, insets.left) : 12)
        .padding(.trailing, immersive ? max(16, insets.right) : 12)
        .padding(.bottom, immersive ? max(8, insets.bottom) : 5)
        .padding(.top, 20)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
    }
}

private struct PlayerProgressBar: View {
    @ObservedObject var model: PlaybackModel
    let resetID: Int
    let began: () -> Void
    let changed: (Double) -> Void
    let ended: (Bool) -> Void
    let accessibleSeek: (AccessibilityAdjustmentDirection) -> Void

    var body: some View {
        GeometryReader { geometry in
            let fraction = model.duration > 0 ? min(max(model.displayedPosition / model.duration, 0), 1) : 0
            let buffered = model.duration > 0 ? min(max(model.buffered / model.duration, 0), 1) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.22)).frame(height: 3)
                Capsule().fill(.white.opacity(0.3)).frame(width: geometry.size.width * buffered, height: 3)
                Capsule().fill(Cinema.text).frame(width: geometry.size.width * fraction, height: 3)
                if !model.request.isLive {
                    Circle().fill(Cinema.text).frame(width: 10, height: 10).offset(x: max(0, min(geometry.size.width - 10, geometry.size.width * fraction - 5)))
                }
                PlayerProgressTouchSurface(enabled: model.canSeek, resetID: resetID, began: began, changed: changed, ended: ended)
            }.frame(maxHeight: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.request.isLive ? "直播进度不可调整" : "播放进度")
        .accessibilityValue(WatchEntry.time(model.displayedPosition) + "，总时长 " + WatchEntry.time(model.duration))
        .accessibilityAdjustableAction(accessibleSeek)
    }
}

private struct PlayerHUDView: View {
    let hud: PlayerHUD
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: hud.icon).font(.system(size: 25, weight: .medium)).foregroundStyle(Cinema.text)
            Text(hud.title).font(.system(size: 16, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
            Text(hud.detail).font(.system(size: 11)).foregroundStyle(.white.opacity(0.75))
            if let progress = hud.progress {
                GeometryReader { proxy in
                    Capsule().fill(.white.opacity(0.18))
                    Capsule().fill(Cinema.text).frame(width: proxy.size.width * min(max(progress, 0), 1))
                }.frame(width: 155, height: 3).padding(.top, 2)
            }
        }.padding(.horizontal, 22).padding(.vertical, 18)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Cinema.line))
            .accessibilityElement(children: .combine)
    }
}

private struct PlayerMenu: View {
    @ObservedObject var session: MobilePlaybackSession
    @ObservedObject var model: PlaybackModel
    @ObservedObject private var pictureInPicture: PlaybackPictureInPicture
    let panel: PlayerPanel

    init(session: MobilePlaybackSession, model: PlaybackModel, panel: PlayerPanel) {
        self.session = session; self.model = model; self.panel = panel
        pictureInPicture = session.pictureInPicture
    }

    private var title: String {
        switch panel {
        case .speed: return "播放速度"
        case .episodes: return model.request.isLive ? "频道" : "选集"
        case .settings: return "播放设置"
        }
    }
    private var subtitle: String {
        switch panel {
        case .speed: return "长按画面临时加速，松手恢复"
        case .episodes: return model.request.current.line
        case .settings: return "画面与播放操作"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.title3.weight(.semibold))
                    Text(subtitle).font(.caption).foregroundStyle(Cinema.faint).lineLimit(1)
                }
                Spacer()
                Button(action: session.closePanel) { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel("关闭")
            }
            ScrollView {
                if panel == .speed { speedOptions }
                else if panel == .episodes { episodeOptions }
                else { settingsOptions }
            }
        }.padding(20).foregroundStyle(Cinema.text).background(Cinema.surface)
    }

    private var speedOptions: some View {
        VStack(spacing: 10) {
            ForEach(PlaybackModel.supportedRates, id: \.self) { rate in
                Button { session.setRate(rate) } label: {
                    HStack {
                        Text(rateText(rate) + "×").font(.subheadline.weight(.medium))
                        if rate == 1 { Text("正常").font(.caption).foregroundStyle(model.selectedRate == rate ? Cinema.canvas.opacity(0.7) : Cinema.faint) }
                        Spacer()
                        if model.selectedRate == rate { Image(systemName: "checkmark").foregroundStyle(Cinema.canvas) }
                    }.foregroundStyle(model.selectedRate == rate ? Cinema.canvas : Cinema.text)
                        .padding(16).background(model.selectedRate == rate ? Cinema.text : Cinema.raised, in: RoundedRectangle(cornerRadius: 14))
                }.buttonStyle(.plain).accessibilityAddTraits(model.selectedRate == rate ? .isSelected : [])
            }
        }
    }

    private var episodeOptions: some View {
        ScrollViewReader { reader in
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92, maximum: 150), spacing: 10)], spacing: 10) {
                ForEach(Array(model.request.episodes.enumerated()), id: \.offset) { index, episode in
                    EpisodeButton(name: episode.name, selected: model.request.index == index) { session.select(index) }.id(index)
                }
            }.onAppear { reader.scrollTo(model.request.index, anchor: .center) }
        }
    }

    private var settingsOptions: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("画面显示").font(.caption).foregroundStyle(Cinema.faint)
            HStack(spacing: 10) {
                EpisodeButton(name: "适应画面", selected: !session.fillScreen) { session.setFillScreen(false) }
                EpisodeButton(name: "铺满屏幕", selected: session.fillScreen) { session.setFillScreen(true) }
            }
            if pictureInPicture.isPossible || pictureInPicture.isActive {
                Button(action: session.togglePictureInPicture) {
                    Label(pictureInPicture.isActive ? "关闭画中画" : "画中画播放", systemImage: "pip.enter")
                        .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(15)
                        .background(Cinema.chip.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
            Button(action: session.leaveForSource) {
                Label(model.request.isLive ? "返回频道列表" : "返回页面换源", systemImage: "arrow.uturn.backward")
                    .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(15)
                    .background(Cinema.chip.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
            if !model.request.isLive { Text("返回原页面后，可在影片详情切换线路，或搜索其他来源。").font(.caption).foregroundStyle(Cinema.faint).lineSpacing(4) }
            Divider().overlay(Cinema.line)
            Text("播放手势").font(.subheadline.weight(.medium))
            Text("单击显隐控制，双击播放 / 暂停。左侧上下调亮度，右侧上下调系统音量。").font(.caption).foregroundStyle(Cinema.muted).lineSpacing(5)
            if !model.request.isLive { Text("左右滑动预览，松手跳转。播放中长按临时 2×，原倍率更高时保持原速，松手恢复。").font(.caption).foregroundStyle(Cinema.muted).lineSpacing(5) }
            Text("锁定后仅保留左侧解锁按钮。").font(.caption).foregroundStyle(Cinema.faint)
        }
    }
}

private struct EpisodeButton: View {
    let name: String
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(name).font(.caption.weight(selected ? .semibold : .regular)).lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 8)
                .foregroundStyle(selected ? Cinema.canvas : Cinema.text)
                .background(selected ? Cinema.text : Cinema.raised, in: RoundedRectangle(cornerRadius: 13))
                .overlay(RoundedRectangle(cornerRadius: 13).stroke(selected ? .clear : Cinema.line))
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct MobilePlaybackDetails: View {
    @ObservedObject var model: PlaybackModel
    let synopsis: String
    let bottomInset: CGFloat
    let select: (Int) -> Void
    let openEpisodes: () -> Void
    @State private var expandedSynopsis = false
    @State private var showGestures = false

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    titleBlock
                    if geometry.size.width >= 700 {
                        HStack(alignment: .top, spacing: 28) {
                            information.frame(maxWidth: .infinity, alignment: .leading)
                            episodeGrid.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        information
                        episodeGrid
                    }
                    gestureHelp
                }
                .frame(maxWidth: 1160, alignment: .leading)
                .padding(20).padding(.bottom, bottomInset + 12)
                .frame(maxWidth: .infinity)
            }
        }.background(Cinema.canvas)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(model.request.title).font(.title2.weight(.semibold)).tracking(-0.5).foregroundStyle(Cinema.text)
                Spacer(minLength: 0)
                if model.request.isLive { Text("直播").font(.caption).foregroundStyle(Cinema.text).padding(.horizontal, 10).padding(.vertical, 6).background(Cinema.chip, in: Capsule()) }
            }
            Text(model.request.current.name + " · " + model.request.current.line).font(.caption).foregroundStyle(Cinema.muted)
            if let film = model.request.film, !film.subtitle.isEmpty { Text(film.subtitle).font(.caption).foregroundStyle(Cinema.faint) }
        }
    }

    private var information: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !synopsis.isEmpty {
                Text("简介").font(.headline).foregroundStyle(Cinema.text)
                Text(synopsis).font(.subheadline).foregroundStyle(Cinema.muted).lineSpacing(6).lineLimit(expandedSynopsis ? nil : 3)
                Button(expandedSynopsis ? "收起简介" : "展开简介") { expandedSynopsis.toggle() }.font(.caption).foregroundStyle(Cinema.faint)
            }
            Text(model.request.isLive ? "直播由第三方源站提供；部分频道需要 IPv6 网络。" : "当前播放源：" + (model.request.film?.source.name ?? model.request.current.line))
                .font(.caption).foregroundStyle(Cinema.faint).lineSpacing(4)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var episodeGrid: some View {
        if !model.request.isLive || model.request.episodes.count > 1 {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(model.request.isLive ? "频道" : "选集").font(.headline).foregroundStyle(Cinema.text)
                    Text("共 \(model.request.episodes.count) " + (model.request.isLive ? "个频道" : "集")).font(.caption).foregroundStyle(Cinema.faint)
                    Spacer()
                    Button("全部", action: openEpisodes).font(.caption).foregroundStyle(Cinema.muted)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90, maximum: 150), spacing: 10)], spacing: 10) {
                    ForEach(Array(model.request.episodes.enumerated()), id: \.offset) { index, episode in
                        EpisodeButton(name: episode.name, selected: index == model.request.index) { select(index) }
                    }
                }
            }
        }
    }

    private var gestureHelp: some View {
        DisclosureGroup("播放手势", isExpanded: $showGestures) {
            VStack(alignment: .leading, spacing: 10) {
                Text("单击显隐控制 · 双击播放 / 暂停")
                if !model.request.isLive { Text("左右滑动预览进度，松手跳转") }
                Text("左侧上下调屏幕亮度 · 右侧上下调系统音量")
                if !model.request.isLive { Text("播放中长按临时 2×，高倍率时保持原速，松手恢复") }
                Text("点击左侧锁定后，仅保留解锁按钮")
            }.font(.caption).foregroundStyle(Cinema.muted).lineSpacing(4).padding(.top, 12).frame(maxWidth: .infinity, alignment: .leading)
        }.font(.caption.weight(.medium)).foregroundStyle(Cinema.faint).tint(Cinema.faint)
            .padding(16).cinemaSurface(radius: 15)
    }
}

private struct PlayerVideoLayer: UIViewRepresentable {
    let player: AVPlayer
    let fillScreen: Bool
    let pictureInPicture: PlaybackPictureInPicture
    func makeUIView(context: Context) -> VideoLayerView {
        let view = VideoLayerView()
        view.videoLayer.player = player
        view.videoLayer.videoGravity = fillScreen ? .resizeAspectFill : .resizeAspect
        view.pictureInPicture = pictureInPicture
        pictureInPicture.attach(view.videoLayer)
        view.backgroundColor = .black
        return view
    }
    func updateUIView(_ view: VideoLayerView, context: Context) {
        if view.videoLayer.player !== player { view.videoLayer.player = player }
        view.videoLayer.videoGravity = fillScreen ? .resizeAspectFill : .resizeAspect
        pictureInPicture.attach(view.videoLayer)
    }
    static func dismantleUIView(_ view: VideoLayerView, coordinator: ()) {
        if view.pictureInPicture?.isActive != true {
            view.pictureInPicture?.detach(view.videoLayer)
            view.videoLayer.player = nil
        }
    }
}

private final class VideoLayerView: UIView {
    weak var pictureInPicture: PlaybackPictureInPicture?
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var videoLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

private func rateText(_ rate: Float) -> String {
    String(format: "%g", rate)
}
#endif
