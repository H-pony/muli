import SwiftUI
import Combine

@MainActor
final class AppStore: ObservableObject {
    let repository = MediaRepository()
    let backdrops = BackdropRepository()
    let configuration = SourceConfiguration.bundled()
    @Published private(set) var tmdbCredentialConfigured = false
    @Published private(set) var artworkCredentialRevision = 0
    @Published var highQualityArtworkEnabled = true {
        didSet { UserDefaults.standard.set(highQualityArtworkEnabled, forKey: "highQualityArtworkEnabled") }
    }
    @Published var home: [Film] = []
    @Published var homeWarnings: [String] = []
    @Published var homeLoading = false
    @Published var channels: [LiveChannel] = []
    @Published var liveWarnings: [String] = []
    @Published var liveLoading = false
    @Published var history: [WatchEntry] = []
    @Published var playback: PlaybackRequest?
    @Published var disabledSources: Set<String> = []
    @Published var autoPlayNext: Bool = true {
        didSet { UserDefaults.standard.set(autoPlayNext, forKey: "autoPlayNext") }
    }
    private var loadedSignature: String?
    private var homeGeneration = UUID()

    var activeSources: [MediaSource] { configuration.vodSources.filter { !disabledSources.contains($0.id) } }
    var sourceSignature: String { activeSources.map(\.id).joined(separator: "|") }

    init() {
        let defaults = UserDefaults.standard
        tmdbCredentialConfigured = TMDBCredential(TMDBCredentialStore.read()) != nil
        if defaults.object(forKey: "highQualityArtworkEnabled") != nil {
            highQualityArtworkEnabled = defaults.bool(forKey: "highQualityArtworkEnabled")
        }
        disabledSources = Set(defaults.stringArray(forKey: "disabledSources") ?? [])
        if defaults.object(forKey: "autoPlayNext") != nil { autoPlayNext = defaults.bool(forKey: "autoPlayNext") }
        history = (Self.load([WatchEntry].self, key: "watchHistory") ?? []).filter { $0.request.isValid }
        home = Self.load([Film].self, key: "homeCache") ?? []
        let bundled = MediaRepository.bundledChannels()
        let cached = configuration.liveSubscriptions.isEmpty ? [] : Self.load([LiveChannel].self, key: "channelCache") ?? []
        var seen = Set<String>()
        channels = (bundled + cached).filter { seen.insert($0.id).inserted }
    }

    @discardableResult
    func saveTMDBCredential(_ input: String) -> Bool {
        guard TMDBCredentialStore.save(input) else { return false }
        tmdbCredentialConfigured = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        artworkCredentialRevision += 1
        return true
    }

    func setSource(_ source: MediaSource, enabled: Bool) {
        if enabled { disabledSources.remove(source.id) } else { disabledSources.insert(source.id) }
        UserDefaults.standard.set(Array(disabledSources), forKey: "disabledSources")
    }

    func loadHome(force: Bool = false) async {
        let signature = sourceSignature
        guard force || loadedSignature != signature else { return }
        let generation = UUID()
        homeGeneration = generation
        let sources = activeSources
        home = home.filter { film in sources.contains { $0.id == film.source.id } }
        guard !sources.isEmpty else {
            home = []; homeWarnings = ["请在设置中启用至少一个点播来源。"]
            homeLoading = false; loadedSignature = signature
            return
        }
        homeLoading = true
        defer { if homeGeneration == generation { homeLoading = false } }
        let results = await repository.aggregate(sources)
        guard !Task.isCancelled, homeGeneration == generation, signature == sourceSignature else { return }
        let merged = MediaRepository.merge(results)
        homeWarnings = results.compactMap { result in result.error.map { result.source.name + "：" + $0 } }
        if !merged.isEmpty {
            home = merged
            Self.save(home, key: "homeCache")
        } else if home.isEmpty {
            homeWarnings.insert("当前来源暂时没有返回推荐，可尝试搜索或观看直播。", at: 0)
        } else {
            homeWarnings.insert("显示上次成功加载的推荐。", at: 0)
        }
        loadedSignature = signature
    }

    func refreshLive() async {
        guard !liveLoading else { return }
        liveLoading = true
        defer { liveLoading = false }
        let result = await repository.refreshChannels(configuration.liveSubscriptions, bundled: MediaRepository.bundledChannels())
        guard !Task.isCancelled else { return }
        liveWarnings = result.warnings
        if configuration.liveSubscriptions.isEmpty || result.channels.count > MediaRepository.bundledChannels().count {
            channels = result.channels
            Self.save(channels, key: "channelCache")
        } else if channels.isEmpty { channels = result.channels }
    }

    func play(_ details: FilmDetails, episode: Episode) {
        let episodes = details.episodes.filter { $0.line == episode.line }
        guard let index = episodes.firstIndex(of: episode) else { return }
        let position = historyEntry(for: details.film)?.position(for: episode, film: details.film) ?? 0
        playback = PlaybackRequest(title: details.film.title, film: details.film, episodes: episodes, index: index, position: position)
    }

    func historyEntry(for film: Film) -> WatchEntry? { history.first { $0.request.film?.id == film.id } }

    func preferredLine(for details: FilmDetails) -> String {
        if let entry = historyEntry(for: details.film), entry.request.isValid, details.lines.contains(entry.request.current.line) {
            return entry.request.current.line
        }
        return details.lines.first ?? ""
    }

    func play(_ channel: LiveChannel) {
        playback = PlaybackRequest(title: channel.name, film: nil,
                                   episodes: [Episode(name: "直播", url: channel.url, line: channel.group)], index: 0, isLive: true)
    }

    func remember(_ request: PlaybackRequest, duration: Double) {
        guard request.isValid else { return }
        var request = request
        if !request.position.isFinite || request.position < 0 { request.position = 0 }
        history.removeAll { $0.id == request.id }
        history.insert(WatchEntry(request: request, updatedAt: Date(), duration: duration.isFinite ? duration : 0), at: 0)
        history = Array(history.prefix(80))
        Self.save(history, key: "watchHistory")
    }

    func removeHistory(_ entry: WatchEntry) {
        history.removeAll { $0.id == entry.id }
        Self.save(history, key: "watchHistory")
    }

    func clearHistory() {
        history = []
        UserDefaults.standard.removeObject(forKey: "watchHistory")
    }

    private static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

@main
struct KongwoTVApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(KongwoOrientationDelegate.self) private var orientationDelegate
    #endif
    @StateObject private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG && targetEnvironment(simulator)
                if ProcessInfo.processInfo.arguments.contains("--artwork-qa-detail") { ArtworkDebugPreview() }
                else { RootView() }
                #else
                RootView()
                #endif
            }
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Cinema.text)
        }
    }
}
