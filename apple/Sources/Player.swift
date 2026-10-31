import SwiftUI
import AVKit
import Combine

@MainActor
final class PlaybackModel: ObservableObject {
    let player = AVPlayer()
    @Published var request: PlaybackRequest
    @Published var error: String?
    @Published var loading = true
    @Published private(set) var isPlaying = false
    @Published private(set) var buffering = false
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var buffered: Double = 0
    @Published private(set) var selectedRate: Float = 1
    @Published private(set) var isBoosting = false
    @Published var previewPosition: Double?
    private weak var store: AppStore?
    private var statusObserver: NSKeyValueObservation?
    private var playbackObserver: NSKeyValueObservation?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var failureObserver: NSObjectProtocol?
    private var lastSaved = Date.distantPast
    private var hasResumed = false
    private var seekingResume = false
    private var stopped = false
    private var wantsToPlay = true

    static let supportedRates: [Float] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
    var temporaryRate: Float { max(2, selectedRate) }

    init(request: PlaybackRequest, store: AppStore) {
        self.request = request
        self.store = store
        let savedRate = UserDefaults.standard.float(forKey: "playbackRate")
        if Self.supportedRates.contains(savedRate) { selectedRate = savedRate }
        player.automaticallyWaitsToMinimizeStalling = true
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { self.error = "无法启用音频输出：" + error.localizedDescription }
        playbackObserver = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            Task { @MainActor [weak self] in
                guard let self, !self.stopped else { return }
                self.isPlaying = player.timeControlStatus != .paused
                self.buffering = !self.loading && player.timeControlStatus == .waitingToPlayAtSpecifiedRate
            }
        }
        #if os(iOS)
        let clockInterval = 0.25
        #else
        let clockInterval = 1.0
        #endif
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: clockInterval, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.stopped else { return }
                self.updateClock()
                if Date().timeIntervalSince(self.lastSaved) >= 8 { self.save() }
            }
        }
        load()
    }

    var hasPrevious: Bool { request.index > 0 }
    var hasNext: Bool { request.index + 1 < request.episodes.count }
    var canSeek: Bool { !request.isLive && duration.isFinite && duration > 0 && !loading && error == nil }
    var displayedPosition: Double { previewPosition ?? position }

    private func load() {
        guard !stopped else { return }
        cancelTransientPlayback()
        statusObserver = nil
        if let observer = endObserver { NotificationCenter.default.removeObserver(observer); endObserver = nil }
        if let observer = failureObserver { NotificationCenter.default.removeObserver(observer); failureObserver = nil }
        error = nil; loading = true; hasResumed = false; seekingResume = false
        position = 0; duration = 0; buffered = 0; buffering = false; wantsToPlay = true
        player.pause()
        guard request.isValid, let url = MediaRepository.httpURL(request.current.url) else {
            player.replaceCurrentItem(with: nil)
            error = "播放地址无效，请返回并切换线路。"; loading = false; return
        }
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPUserAgentKey": "Muli/2.16.12 (Apple; Native)"])
        let item = AVPlayerItem(asset: asset)
        player.replaceCurrentItem(with: item)
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            Task { @MainActor [weak self] in
                guard let self, !self.stopped, self.player.currentItem === item else { return }
                switch item.status {
                case .readyToPlay:
                    self.loading = false
                    self.updateClock()
                    if !self.hasResumed {
                        self.hasResumed = true
                        let storedPosition = self.request.position
                        let position = storedPosition.isFinite && storedPosition >= 0 && (self.duration <= 0 || storedPosition < self.duration - 0.5) ? storedPosition : 0
                        self.request.position = position
                        if !self.request.isLive, position > 3, position.isFinite {
                            self.seekingResume = true
                            self.player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600)) { [weak self] _ in
                                Task { @MainActor [weak self] in
                                    guard let self, !self.stopped, self.player.currentItem === item else { return }
                                    self.seekingResume = false
                                    self.playIfWanted()
                                    self.save()
                                }
                            }
                        } else {
                            self.playIfWanted()
                            self.save()
                        }
                    }
                case .failed:
                    self.loading = false
                    self.cancelTransientPlayback()
                    self.error = "此地址暂时无法播放。可返回详情切换线路，或更换来源。\n" + (item.error?.localizedDescription ?? "源站未响应")
                default: break
                }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.stopped, self.player.currentItem === item else { return }
                self.cancelTransientPlayback()
                self.save()
                if self.store?.autoPlayNext == true, self.hasNext { self.select(self.request.index + 1) }
            }
        }
        failureObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] notification in
            let reason = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
            Task { @MainActor [weak self] in
                guard let self, !self.stopped, self.player.currentItem === item else { return }
                self.save()
                self.cancelTransientPlayback()
                self.player.pause()
                self.loading = false; self.buffering = false
                self.error = "播放中断，请重试播放，或返回页面切换线路。\n" + (reason ?? "源站连接已中断")
            }
        }
    }

    private func playIfWanted() {
        guard wantsToPlay, !stopped else { return }
        player.playImmediately(atRate: request.isLive ? 1 : (isBoosting ? temporaryRate : selectedRate))
    }

    private func updateClock() {
        let current = player.currentTime().seconds
        if current.isFinite { position = max(0, current) }
        let length = player.currentItem?.duration.seconds ?? 0
        duration = length.isFinite && length > 0 ? length : 0
        let ranges = player.currentItem?.loadedTimeRanges ?? []
        buffered = ranges.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds }.filter { $0.isFinite }.max() ?? 0
    }

    func select(_ index: Int) {
        guard !stopped, request.episodes.indices.contains(index) else { return }
        cancelTransientPlayback()
        save()
        request.index = index
        request.position = 0
        load()
    }

    func retry() { save(); load() }

    func toggle() {
        endTemporaryBoost()
        if !request.isLive, duration > 0, player.timeControlStatus == .paused,
           player.currentTime().seconds >= duration - 0.25 {
            wantsToPlay = true; position = 0
            let item = player.currentItem
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, !self.stopped, self.player.currentItem === item else { return }
                    self.updateClock(); self.playIfWanted(); self.save()
                }
            }
            return
        }
        if player.timeControlStatus != .paused {
            wantsToPlay = false; player.pause()
        } else {
            wantsToPlay = true; playIfWanted()
        }
    }

    func seek(to seconds: Double) {
        previewPosition = nil
        guard canSeek, seconds.isFinite else { return }
        let target = min(max(seconds, 0), duration)
        position = target
        let item = player.currentItem
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 0.5, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.stopped, self.player.currentItem === item else { return }
                self.updateClock(); self.save()
            }
        }
    }

    func setRate(_ rate: Float) {
        guard !request.isLive else { return }
        guard Self.supportedRates.contains(rate) else { return }
        endTemporaryBoost()
        selectedRate = rate
        UserDefaults.standard.set(rate, forKey: "playbackRate")
        if player.timeControlStatus != .paused { player.rate = rate }
    }

    @discardableResult func beginTemporaryBoost() -> Bool {
        guard !request.isLive, !loading, error == nil, isPlaying, player.timeControlStatus != .paused, wantsToPlay, !isBoosting else { return false }
        isBoosting = true
        player.rate = temporaryRate
        return true
    }

    func endTemporaryBoost() {
        guard isBoosting else { return }
        isBoosting = false
        if player.timeControlStatus != .paused && wantsToPlay { player.rate = selectedRate }
    }

    func cancelTransientPlayback() {
        endTemporaryBoost()
        previewPosition = nil
    }

    func save() {
        // Opening a failing source must not create history or erase a saved position.
        guard !stopped, hasResumed, !seekingResume else { return }
        let time = player.currentTime().seconds
        if !request.isLive, hasResumed, !seekingResume, time.isFinite, time >= 0 { request.position = time }
        let duration = player.currentItem?.duration.seconds ?? 0
        store?.remember(request, duration: duration)
        lastSaved = Date()
    }

    func stop() {
        guard !stopped else { return }
        cancelTransientPlayback()
        save()
        stopped = true
        player.pause()
        statusObserver = nil; playbackObserver = nil
        if let observer = timeObserver { player.removeTimeObserver(observer); timeObserver = nil }
        if let observer = endObserver { NotificationCenter.default.removeObserver(observer); endObserver = nil }
        if let observer = failureObserver { NotificationCenter.default.removeObserver(observer); failureObserver = nil }
        player.replaceCurrentItem(with: nil)
    }
}
