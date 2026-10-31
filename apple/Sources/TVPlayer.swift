#if os(tvOS)
import SwiftUI
import AVKit
import Combine

private enum TVPlayerPanel: String { case episodes, speed, settings }
private enum TVPlayerFocus: Hashable {
    case video, back, more, progress, play, next, speed, episodes
    case closePanel, episode(Int), rate(Int), fit, fill, autoplay, reconnect, source, pip
    case retryError, exitError
}
private enum TVPlayerColor {
    static let accent = Cinema.text
    static let surface = Cinema.surface
    static let muted = Color.white.opacity(0.68)
}

/// Full-screen AVPlayerLayer with television focus and app-owned playback controls.
@MainActor
struct PlayerScreen: View {
    @StateObject private var model: PlaybackModel
    @StateObject private var pictureInPicture = TVPictureInPicture()
    @ObservedObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: TVPlayerFocus?
    @AppStorage("tvPlayerFillScreen") private var fillScreen = false
    @State private var controlsVisible = true
    @State private var panel: TVPlayerPanel?
    @State private var returnFocus: TVPlayerFocus = .play
    @State private var seekOrigin: Double?
    @State private var seekEpisodeID: String?
    @State private var hideTask: Task<Void, Never>?
    @State private var isExiting = false

    init(request: PlaybackRequest, store: AppStore) {
        _model = StateObject(wrappedValue: PlaybackModel(request: request, store: store))
        _store = ObservedObject(wrappedValue: store)
    }
    private var currentEpisode: Episode? { model.request.episodes.isEmpty ? nil : model.request.current }
    private var canChooseEpisodes: Bool { model.request.isLive ? model.request.episodes.count > 1 : !model.request.episodes.isEmpty }
    private var episodeLabel: String { model.request.isLive ? "选台" : "选集" }
    private var canAutoHide: Bool {
        !isExiting && controlsVisible && scenePhase == .active && model.isPlaying && !model.loading && !model.buffering && model.error == nil
            && panel == nil && model.previewPosition == nil && !voiceOverEnabled
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                TVVideoLayer(player: model.player, fillScreen: fillScreen, pictureInPicture: pictureInPicture)
                    .ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
                Button { showControls() } label: { Color.clear.contentShape(Rectangle()) }
                    .buttonStyle(TVVideoButtonStyle()).disabled(controlsVisible || panel != nil)
                    .focused($focused, equals: .video).accessibilityLabel("显示播放控制")
                    .accessibilityHidden(controlsVisible || panel != nil)
                    .onMoveCommand(perform: moveOnVideo)
                if controlsVisible && panel == nil { controls(size: geometry.size).transition(.opacity) }
                if let error = model.error {
                    errorCard(error, width: geometry.size.width).disabled(panel != nil)
                } else if model.loading || model.buffering {
                    VStack(spacing: 16) {
                        ProgressView().tint(.white)
                        Text(model.loading ? "正在连接视频…" : "正在缓冲…").font(.system(size: 22))
                    }.padding(28).background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 20))
                        .allowsHitTesting(false)
                }
                if let target = model.previewPosition { seekHUD(target).allowsHitTesting(false) }
                if let panel { panelView(panel, size: geometry.size).transition(reduceMotion ? .opacity : .move(edge: .trailing)) }
            }.frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea().background(.black).foregroundStyle(.white)
        .preferredColorScheme(.dark).tint(TVPlayerColor.accent)
        .onAppear { isExiting = false; showControls() }
        .onDisappear { isExiting = true; hideTask?.cancel(); cancelPreview(); pictureInPicture.stopForExit(); model.stop() }
        .onPlayPauseCommand { togglePlayback() }.onExitCommand(perform: handleBack)
        .onChange(of: focused) { old, new in
            if old == .progress && new != .progress { cancelPreview() }
            scheduleHide()
        }
        .onChange(of: model.isPlaying) { _, playing in
            if playing { scheduleHide() } else if panel == nil { showControls() }
        }
        .onChange(of: model.loading) { _, _ in scheduleHide() }
        .onChange(of: model.buffering) { _, _ in scheduleHide() }
        .onChange(of: model.error) { _, error in
            cancelPreview(); if error != nil { showControls(preferred: .retryError) }
        }
        .onChange(of: currentEpisode?.id) { _, _ in cancelPreview(); showControls() }
        .onChange(of: scenePhase) { _, phase in
            cancelPreview(); hideTask?.cancel(); model.save()
            if phase == .active { showControls() }
        }
        .onChange(of: voiceOverEnabled) { _, enabled in
            if enabled { showControls() } else { scheduleHide() }
        }
    }

    private func controls(size: CGSize) -> some View {
        ZStack {
            VStack {
                LinearGradient(colors: [.black.opacity(0.86), .clear], startPoint: .top, endPoint: .bottom).frame(height: 210)
                Spacer()
                LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .bottom).frame(height: 290)
            }.allowsHitTesting(false)
            VStack(spacing: 0) {
                HStack(spacing: 24) {
                    control("", icon: "chevron.backward", focus: .back, action: exitPlayback).accessibilityLabel("返回上一页")
                    VStack(alignment: .leading, spacing: 7) {
                        Text(model.request.title).font(.system(size: 30, weight: .semibold)).lineLimit(1)
                        if let episode = currentEpisode {
                            Text([episode.name, episode.line].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.system(size: 19)).foregroundStyle(TVPlayerColor.muted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 28)
                    control("", icon: "ellipsis", focus: .more) { open(.settings, from: .more) }.accessibilityLabel("更多播放设置")
                }
                Spacer(minLength: 20)
                VStack(spacing: 16) {
                    if !model.request.isLive { progressControl }
                    HStack(spacing: 18) {
                        control("", icon: model.isPlaying ? "pause.fill" : "play.fill", focus: .play, action: togglePlayback)
                            .accessibilityLabel(model.isPlaying ? "暂停" : "播放")
                        if !model.request.isLive && model.hasNext {
                            control("", icon: "forward.end.fill", focus: .next) { select(model.request.index + 1) }.accessibilityLabel("下一集")
                        }
                        if model.request.isLive {
                            HStack(spacing: 9) {
                                Circle().fill(TVPlayerColor.accent).frame(width: 9, height: 9)
                                Text("直播").font(.system(size: 22, weight: .medium))
                            }
                        } else {
                            Text(WatchEntry.time(model.displayedPosition) + " / " + (model.duration > 0 ? WatchEntry.time(model.duration) : "--:--"))
                                .font(.system(size: 22, weight: .medium, design: .monospaced)).monospacedDigit()
                                .accessibilityLabel("播放时间 " + WatchEntry.time(model.displayedPosition))
                        }
                        Spacer(minLength: 20)
                        if !model.request.isLive { control(rateLabel(model.selectedRate), focus: .speed) { open(.speed, from: .speed) } }
                        if canChooseEpisodes { control(episodeLabel, focus: .episodes) { open(.episodes, from: .episodes) } }
                    }
                    HStack {
                        Text(model.request.isLive ? "方向键选择控件 · 确认执行" : (model.previewPosition == nil ? "方向键导航 · 聚焦进度条后左右预览，确认跳转" : "左右调整目标时间 · 确认跳转 · 返回取消"))
                        Spacer()
                        Text("播放/暂停键控制播放 · 返回键逐层退出")
                    }.font(.system(size: 16)).foregroundStyle(TVPlayerColor.muted).accessibilityHidden(true)
                }
            }.padding(.horizontal, min(70, size.width * 0.05)).padding(.top, 46).padding(.bottom, 42)
        }
    }

    private var progressControl: some View {
        Button {
            if model.previewPosition != nil { commitPreview() } else { previewSeek(by: 0) }
        } label: {
            GeometryReader { geometry in
                let fraction = normalized(model.displayedPosition)
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.2))
                    Capsule().fill(.white.opacity(0.3)).frame(width: geometry.size.width * normalized(model.buffered))
                    Capsule().fill(TVPlayerColor.accent).frame(width: geometry.size.width * fraction)
                    if focused == .progress || model.previewPosition != nil {
                        Circle().fill(.white).frame(width: 20, height: 20)
                            .offset(x: min(max(geometry.size.width * fraction - 10, 0), max(0, geometry.size.width - 20)))
                    }
                }.frame(height: focused == .progress ? 8 : 5).frame(maxHeight: .infinity)
            }.frame(height: 34).padding(.horizontal, 12)
                .background(focused == .progress ? Color.white.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == .progress ? TVPlayerColor.accent : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain).focused($focused, equals: .progress).disabled(!model.canSeek)
        .accessibilityLabel("播放进度")
        .accessibilityValue(WatchEntry.time(model.displayedPosition) + "，共 " + WatchEntry.time(model.duration))
        .accessibilityHint("左右预览，确认跳转，返回取消")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.seek(to: model.position + 10)
            case .decrement: model.seek(to: model.position - 10)
            @unknown default: break
            }
            scheduleHide()
        }
        .onMoveCommand { direction in
            switch direction {
            case .left: previewSeek(by: -10)
            case .right: previewSeek(by: 10)
            case .up: cancelPreview(); focused = .back
            case .down: cancelPreview(); focused = .play
            @unknown default: break
            }
        }
    }

    private func seekHUD(_ target: Double) -> some View {
        VStack(spacing: 12) {
            let delta = target - (seekOrigin ?? model.position)
            Text(delta < 0 ? "后退 " + WatchEntry.time(abs(delta)) : "快进 " + WatchEntry.time(delta))
                .font(.system(size: 20)).foregroundStyle(TVPlayerColor.muted)
            Text(WatchEntry.time(target)).font(.system(size: 52, weight: .semibold, design: .monospaced))
                .foregroundStyle(TVPlayerColor.accent).monospacedDigit()
            Text("按确认跳转 · 返回键取消").font(.system(size: 19))
        }.padding(.horizontal, 45).padding(.vertical, 28)
            .background(TVPlayerColor.surface.opacity(0.97), in: RoundedRectangle(cornerRadius: 22))
    }
    private func errorCard(_ error: String, width: CGFloat) -> some View {
        VStack(spacing: 22) {
            Image(systemName: "exclamationmark.circle").font(.system(size: 38)).foregroundStyle(TVPlayerColor.accent)
            Text("暂时无法播放").font(.system(size: 28, weight: .semibold))
            Text(error).font(.system(size: 20)).foregroundStyle(TVPlayerColor.muted).multilineTextAlignment(.center).lineLimit(5)
            HStack(spacing: 22) {
                control("重试播放", icon: "arrow.clockwise", focus: .retryError) { model.retry(); showControls() }
                control("返回换源", icon: "chevron.backward", focus: .exitError, action: exitPlayback)
            }
        }.padding(35).frame(width: min(800, width * 0.7)).background(TVPlayerColor.surface, in: RoundedRectangle(cornerRadius: 24))
    }

    private func panelView(_ panel: TVPlayerPanel, size: CGSize) -> some View {
        HStack(spacing: 0) {
            Color.black.opacity(0.5).allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text(panel == .episodes ? episodeLabel : (panel == .speed ? "播放速度" : "更多设置"))
                        .font(.system(size: 30, weight: .semibold))
                    Spacer()
                    control("", icon: "xmark", focus: .closePanel, action: closePanel).accessibilityLabel("关闭菜单")
                }
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            switch panel {
                            case .episodes:
                                ForEach(Array(model.request.episodes.enumerated()), id: \.offset) { index, episode in
                                    control(episode.name, icon: index == model.request.index ? "play.fill" : nil,
                                            focus: .episode(index), selected: index == model.request.index) { select(index) }.id(index)
                                }
                            case .speed:
                                ForEach(Array(PlaybackModel.supportedRates.enumerated()), id: \.offset) { index, rate in
                                    control(rateLabel(rate), icon: rate == model.selectedRate ? "checkmark" : nil,
                                            focus: .rate(index), selected: rate == model.selectedRate) { model.setRate(rate); closePanel() }
                                }
                                panelNote("普通倍率会保存到本机，并用于恢复播放、下一集和重试。")
                            case .settings: settingsContent
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                    }.scrollIndicators(.hidden)
                        .onAppear { if panel == .episodes { proxy.scrollTo(model.request.index, anchor: .center) } }
                }
            }.padding(34).padding(.top, 18).padding(.bottom, 24)
                .frame(width: min(650, max(460, size.width * 0.35)), height: size.height).background(TVPlayerColor.surface)
        }
        .task(id: panel) {
            await Task.yield()
            guard !isExiting, self.panel == panel else { return }
            switch panel {
            case .episodes: focused = model.request.episodes.isEmpty ? .closePanel : .episode(model.request.index)
            case .speed: focused = .rate(PlaybackModel.supportedRates.firstIndex(of: model.selectedRate) ?? 2)
            case .settings: focused = fillScreen ? .fill : .fit
            }
        }
    }
    @ViewBuilder private var settingsContent: some View {
        control("适应画面", icon: fillScreen ? nil : "checkmark", focus: .fit, selected: !fillScreen) { fillScreen = false }
        control("铺满屏幕", icon: fillScreen ? "checkmark" : nil, focus: .fill, selected: fillScreen) { fillScreen = true }
        panelNote("铺满会裁切画面边缘；适应保留完整视频比例。")
        if !model.request.isLive {
            control(store.autoPlayNext ? "自动连播：开" : "自动连播：关", icon: "repeat", focus: .autoplay) { store.autoPlayNext.toggle() }
        }
        if pictureInPicture.isPossible || pictureInPicture.isActive {
            control(pictureInPicture.isActive ? "关闭画中画" : "画中画播放", icon: "pip.enter", focus: .pip) {
                pictureInPicture.toggle(); closePanel()
            }
        }
        if let error = pictureInPicture.failure { panelNote(error) }
        control(model.request.isLive ? "重新连接频道" : "重新连接视频", icon: "arrow.clockwise", focus: .reconnect) { model.retry(); closePanel() }
        control("返回原页面换源", icon: "arrow.uturn.backward", focus: .source, action: exitPlayback)
        panelNote(model.request.isLive ? "方向键选择控件，确认执行。播放/暂停键控制直播。返回键依次关闭菜单、隐藏控件、退出播放。电视音量由遥控器音量键和输出设备控制。" : "遥控器左右键在进度条上预览时间，确认后跳转。播放/暂停键随时控制播放。返回键依次取消预览、关闭菜单、隐藏控件、退出播放。电视音量由遥控器音量键和输出设备控制。")
    }
    private func panelNote(_ text: String) -> some View {
        Text(text).font(.system(size: 19)).foregroundStyle(TVPlayerColor.muted)
            .fixedSize(horizontal: false, vertical: true).padding(.vertical, 8).padding(.horizontal, 4)
    }
    private func control(_ title: String, icon: String? = nil, focus: TVPlayerFocus,
                         selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button { hideTask?.cancel(); action(); scheduleHide() } label: {
            HStack(spacing: 12) {
                if let icon { Image(systemName: icon).font(.system(size: 23, weight: .semibold)) }
                if !title.isEmpty { Text(title).font(.system(size: 22, weight: .medium)).lineLimit(2) }
            }
        }.buttonStyle(TVPlayerControlStyle(focused: focused == focus, selected: selected, primary: focus == .play)).focused($focused, equals: focus)
    }
    private func rateLabel(_ rate: Float) -> String { String(format: "%g×", rate) }
    private func normalized(_ value: Double) -> CGFloat {
        guard value.isFinite, model.duration.isFinite, model.duration > 0 else { return 0 }
        return CGFloat(min(max(value / model.duration, 0), 1))
    }
    private func moveOnVideo(_ direction: MoveCommandDirection) {
        switch direction {
        case .left: if model.canSeek { previewSeek(by: -10) } else { showControls() }
        case .right: if model.canSeek { previewSeek(by: 10) } else { showControls() }
        default: showControls()
        }
    }
    private func previewSeek(by delta: Double) {
        guard model.canSeek, let episode = currentEpisode else { return }
        hideTask?.cancel()
        if seekEpisodeID != episode.id || seekOrigin == nil { seekEpisodeID = episode.id; seekOrigin = model.position }
        model.previewPosition = min(max((model.previewPosition ?? model.position) + delta, 0), model.duration)
        controlsVisible = true
        Task { @MainActor in await Task.yield(); if !isExiting && model.previewPosition != nil { focused = .progress } }
    }
    private func commitPreview() {
        guard seekEpisodeID == currentEpisode?.id, let target = model.previewPosition else { cancelPreview(); return }
        cancelPreview(); model.seek(to: target); scheduleHide()
    }
    private func cancelPreview() { model.previewPosition = nil; seekOrigin = nil; seekEpisodeID = nil }
    private func select(_ index: Int) { cancelPreview(); model.select(index); panel = nil; showControls() }
    private func togglePlayback() {
        cancelPreview(); model.toggle()
        if panel == nil { showControls() } else { scheduleHide() }
    }
    private func showControls(preferred: TVPlayerFocus = .play) {
        guard !isExiting else { return }
        controlsVisible = true
        if panel == nil {
            Task { @MainActor in await Task.yield(); if !isExiting && panel == nil && controlsVisible { focused = preferred } }
        }
        scheduleHide()
    }
    private func hideControls() {
        guard panel == nil else { return }
        cancelPreview(); hideTask?.cancel(); controlsVisible = false
        Task { @MainActor in await Task.yield(); if !isExiting && !controlsVisible && panel == nil { focused = .video } }
    }
    private func open(_ panel: TVPlayerPanel, from focus: TVPlayerFocus) {
        cancelPreview(); hideTask?.cancel(); returnFocus = focus; controlsVisible = true; self.panel = panel
    }
    private func closePanel() { panel = nil; showControls(preferred: returnFocus) }
    private func handleBack() {
        if panel != nil { closePanel() }
        else if model.previewPosition != nil { cancelPreview(); scheduleHide() }
        else if controlsVisible { hideControls() }
        else { exitPlayback() }
    }
    private func exitPlayback() { isExiting = true; hideTask?.cancel(); cancelPreview(); pictureInPicture.stopForExit(); model.stop(); dismiss() }
    private func scheduleHide() {
        hideTask?.cancel(); hideTask = nil
        guard canAutoHide else { return }
        hideTask = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 4_000_000_000) } catch { return }
            guard !Task.isCancelled, canAutoHide else { return }
            hideControls()
        }
    }
}

private struct TVPlayerControlStyle: ButtonStyle {
    let focused: Bool
    let selected: Bool
    var primary = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(focused || primary ? Cinema.canvas : Cinema.text)
            .padding(.horizontal, 24).padding(.vertical, 17).frame(minWidth: 68, minHeight: 62)
            .background(focused || primary ? Cinema.text : (selected ? Cinema.chip : Cinema.raised.opacity(0.9)), in: RoundedRectangle(cornerRadius: 28))
            .overlay(RoundedRectangle(cornerRadius: 28).stroke(focused ? Color.white : .clear, lineWidth: 3).padding(-5))
            .shadow(color: .black.opacity(focused ? 0.4 : 0), radius: 16, y: 8)
            .scaleEffect(focused && !reduceMotion ? 1.055 : 1).opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.35)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: focused)
    }
}
private struct TVVideoButtonStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label } }

@MainActor
private final class TVPictureInPicture: NSObject, ObservableObject, AVPictureInPictureControllerDelegate {
    @Published private(set) var isPossible = false
    @Published private(set) var isActive = false
    @Published private(set) var failure: String?
    private var controller: AVPictureInPictureController?
    private var layer: AVPlayerLayer?
    private var observation: NSKeyValueObservation?
    private var leaving = false
    func attach(_ layer: AVPlayerLayer) {
        guard AVPictureInPictureController.isPictureInPictureSupported(), self.layer !== layer, controller?.isPictureInPictureActive != true else { return }
        self.layer = layer; leaving = false; observation = nil; controller?.delegate = nil
        guard let controller = AVPictureInPictureController(playerLayer: layer) else { return }
        self.controller = controller; controller.delegate = self
        observation = controller.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] controller, _ in
            Task { @MainActor [weak self] in
                guard let self, self.controller === controller else { return }; self.isPossible = controller.isPictureInPicturePossible
            }
        }
    }
    func detach(_ layer: AVPlayerLayer) {
        guard self.layer === layer, controller?.isPictureInPictureActive != true else { return }; clear()
    }
    func toggle() {
        guard !leaving, let controller else { return }; failure = nil
        if controller.isPictureInPictureActive { controller.stopPictureInPicture() }
        else if controller.isPictureInPicturePossible { controller.startPictureInPicture() }
    }
    func stopForExit() {
        leaving = true
        if controller?.isPictureInPictureActive == true { controller?.stopPictureInPicture() } else { clear() }
    }
    private func clear() {
        observation = nil; controller?.delegate = nil; controller = nil
        layer?.player = nil; layer = nil; isPossible = false; isActive = false
    }
    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in self?.isActive = true }
    }
    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor [weak self] in guard let self else { return }; self.isActive = false; if self.leaving { self.clear() } }
    }
    nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        Task { @MainActor [weak self] in self?.isActive = false; self?.failure = "系统未能开启画中画，请重试。" }
    }
    nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}
private struct TVVideoLayer: UIViewRepresentable {
    let player: AVPlayer
    let fillScreen: Bool
    let pictureInPicture: TVPictureInPicture
    func makeCoordinator() -> Coordinator { Coordinator(pictureInPicture) }
    func makeUIView(context: Context) -> TVVideoView {
        let view = TVVideoView(); view.isUserInteractionEnabled = false; view.videoLayer.player = player
        context.coordinator.attach(view.videoLayer); return view
    }
    func updateUIView(_ view: TVVideoView, context: Context) {
        if view.videoLayer.player !== player { view.videoLayer.player = player }
        view.videoLayer.videoGravity = fillScreen ? .resizeAspectFill : .resizeAspect
        context.coordinator.attach(view.videoLayer)
    }
    static func dismantleUIView(_ view: TVVideoView, coordinator: Coordinator) { coordinator.detach(view.videoLayer) }
    @MainActor final class Coordinator {
        weak var pictureInPicture: TVPictureInPicture?
        init(_ pictureInPicture: TVPictureInPicture) { self.pictureInPicture = pictureInPicture }
        func attach(_ layer: AVPlayerLayer) { DispatchQueue.main.async { [weak self] in self?.pictureInPicture?.attach(layer) } }
        func detach(_ layer: AVPlayerLayer) { DispatchQueue.main.async { [weak pictureInPicture] in pictureInPicture?.detach(layer) } }
    }
}
private final class TVVideoView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var videoLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}
#endif
