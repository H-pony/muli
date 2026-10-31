import Foundation

struct MediaSource: Codable, Identifiable, Hashable, Sendable {
    var name: String
    var url: String
    var id: String { url }
}

struct SourceConfiguration: Codable, Sendable {
    var vodSources: [MediaSource]
    var liveSubscriptions: [MediaSource]
    static func bundled() -> Self {
        guard let url = Bundle.main.url(forResource: "sources", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(Self.self, from: data) else {
            return Self(vodSources: [], liveSubscriptions: [])
        }
        return value
    }
}

struct Film: Codable, Identifiable, Hashable, Sendable {
    var source: MediaSource
    var mediaID: String
    var title: String
    var cover: String
    var category: String
    var year: String
    var remarks: String
    var id: String { source.id + "|" + mediaID }
    var subtitle: String { [year, category, remarks].filter { !$0.isEmpty }.joined(separator: " · ") }
}

struct Episode: Codable, Identifiable, Hashable, Sendable {
    var name: String
    var url: String
    var line: String
    var id: String { line + "|" + url }
}

struct FilmDetails: Sendable {
    var film: Film
    var synopsis: String
    var episodes: [Episode]
    var artworkIdentity: ArtworkIdentity? = nil
    var lines: [String] {
        episodes.map(\.line).reduce(into: []) { if !$0.contains($1) { $0.append($1) } }
    }

    func preferredEpisode(line: String, history: WatchEntry?) -> Episode? {
        let available = episodes.filter { $0.line == line }
        guard let history, history.request.film?.id == film.id, history.request.isValid,
              let index = available.firstIndex(where: { $0.id == history.request.current.id || $0.name == history.request.current.name }) else {
            return available.first
        }
        return available[history.isCompleted && index + 1 < available.count ? index + 1 : index]
    }
}

struct LiveChannel: Codable, Identifiable, Hashable, Sendable {
    var name: String
    var url: String
    var group: String
    var logo: String
    var id: String { url }
}

struct PlaybackRequest: Codable, Identifiable, Sendable {
    var title: String
    var film: Film?
    var episodes: [Episode]
    var index: Int
    var position: Double = 0
    var isLive: Bool = false
    var id: String { film?.id ?? episodes.first?.url ?? title }
    var current: Episode { episodes[min(max(index, 0), episodes.count - 1)] }
    var isValid: Bool {
        episodes.indices.contains(index) && episodes.allSatisfy { MediaRepository.httpURL($0.url) != nil }
    }
}

struct WatchEntry: Codable, Identifiable {
    var request: PlaybackRequest
    var updatedAt: Date
    var duration: Double
    var id: String { request.id }
    var isCompleted: Bool {
        !request.isLive && duration.isFinite && duration > 0 && request.position.isFinite && request.position >= duration - 0.5
    }
    var resumedRequest: PlaybackRequest? {
        guard request.isValid else { return nil }
        var value = request
        if request.isLive || isCompleted {
            if isCompleted && value.index + 1 < value.episodes.count { value.index += 1 }
            value.position = 0
        } else if !value.position.isFinite || value.position < 0 { value.position = 0 }
        return value
    }

    func position(for episode: Episode, film: Film) -> Double {
        guard request.isValid, request.film?.id == film.id, !isCompleted,
              request.current.id == episode.id || request.current.name == episode.name,
              request.position.isFinite, request.position >= 0 else { return 0 }
        return request.position
    }

    func playbackLabel(for episode: Episode, film: Film) -> String {
        guard request.isValid, request.film?.id == film.id else { return "立即播放" }
        if position(for: episode, film: film) > 3 { return "继续观看 · " + episode.name }
        if isCompleted {
            if request.current.name == episode.name { return "重新播放" }
            if request.index + 1 < request.episodes.count, request.episodes[request.index + 1].name == episode.name {
                return "播放下一集 · " + episode.name
            }
        }
        return "立即播放"
    }
    var progress: Double {
        guard duration > 0, !request.isLive else { return 0 }
        return min(max(request.position / duration, 0), 1)
    }
    var positionText: String {
        request.isLive ? "直播" : Self.time(request.position) + (duration > 0 ? " / " + Self.time(duration) : "")
    }
    static func time(_ value: Double) -> String {
        guard value.isFinite, value >= 0 else { return "00:00" }
        // Defensive bound for malformed persisted values before converting Double to Int.
        let seconds = Int(min(value, Double(Int.max / 2)))
        return seconds >= 3600 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

struct SourceResult: Sendable {
    var source: MediaSource
    var films: [Film]
    var error: String?
}

struct ChannelResult: Sendable {
    var channels: [LiveChannel]
    var warnings: [String]
}

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let message) = self { return message }
        return nil
    }
}
