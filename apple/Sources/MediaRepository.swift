import Foundation

/// Native, on-device source aggregation. No companion server or WebView is used.
actor MediaRepository {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 14
        configuration.httpAdditionalHeaders = [
            "User-Agent": "Muli/2.16.12 (Apple; Native)",
            "Accept": "application/json, application/x-mpegURL, text/plain, */*"
        ]
        configuration.httpMaximumConnectionsPerHost = 3
        session = URLSession(configuration: configuration)
    }

    func query(_ source: MediaSource, keyword: String? = nil) async -> SourceResult {
        do {
            let url = try Self.apiURL(source.url, parameter: keyword == nil ? "pg" : "wd", value: keyword ?? "1")
            let data = try await download(url, limit: 4 * 1024 * 1024)
            return SourceResult(source: source, films: try Self.parseFilms(data, source: source,
                                                                         filterSearchResults: keyword != nil), error: nil)
        } catch {
            return SourceResult(source: source, films: [], error: Self.message(error))
        }
    }

    func aggregate(_ sources: [MediaSource], keyword: String? = nil) async -> [SourceResult] {
        await withTaskGroup(of: (Int, SourceResult).self) { group in
            for (index, source) in sources.prefix(12).enumerated() {
                group.addTask { (index, await self.query(source, keyword: keyword)) }
            }
            var values: [(Int, SourceResult)] = []
            for await value in group { values.append(value) }
            return values.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    func details(_ film: Film) async throws -> FilmDetails {
        let url = try Self.apiURL(film.source.url, parameter: "ids", value: film.mediaID)
        return try Self.parseDetails(try await download(url, limit: 4 * 1024 * 1024), film: film)
    }

    nonisolated static func parseDetails(_ data: Data, film: Film) throws -> FilmDetails {
        let rows = try rows(data)
        guard let row = rows.first(where: { field($0, "vod_id", "id") == film.mediaID }) else {
            throw ClientError.message("来源未返回这部影片的详情，请尝试其他来源。")
        }
        guard !Self.isFiltered(row) else { throw ClientError.message("该内容已被过滤。") }
        let complete = Self.film(row, source: film.source) ?? film
        let episodes = Self.parseEpisodes(Self.field(row, "vod_play_url", "play_url"), names: Self.field(row, "vod_play_from", "play_from"))
        guard !episodes.isEmpty else { throw ClientError.message("此来源没有可直接播放的 HTTP(S) 地址。请返回并选择其他来源。") }
        let synopsis = Self.plainText(Self.field(row, "vod_content", "vod_blurb", "description", "content"))
        return FilmDetails(film: complete, synopsis: synopsis.isEmpty ? "暂无简介" : synopsis, episodes: episodes,
                           artworkIdentity: ArtworkIdentity.from(row, film: complete, original: film))
    }

    func refreshChannels(_ subscriptions: [MediaSource], bundled: [LiveChannel]) async -> ChannelResult {
        await withTaskGroup(of: (Int, [LiveChannel], String?).self) { group in
            for (index, source) in subscriptions.prefix(6).enumerated() {
                group.addTask {
                    do {
                        guard let url = Self.httpURL(source.url) else { throw ClientError.message("订阅地址无效") }
                        let data = try await self.download(url, limit: 8 * 1024 * 1024)
                        let channels = Self.parseM3U(String(decoding: data, as: UTF8.self))
                        guard !channels.isEmpty else { throw ClientError.message("订阅未返回频道") }
                        return (index, channels, nil)
                    } catch { return (index, [], source.name + "：" + Self.message(error)) }
                }
            }
            var results: [(Int, [LiveChannel], String?)] = []
            for await result in group { results.append(result) }
            var seen = Set<String>()
            let channels = (bundled + results.sorted { $0.0 < $1.0 }.flatMap(\.1)).filter { seen.insert($0.url).inserted }
            return ChannelResult(channels: Array(channels.prefix(6000)), warnings: results.compactMap(\.2))
        }
    }

    private func download(_ url: URL, limit: Int) async throws -> Data {
        // Async byte streaming bounds memory even if a third-party server sends an oversized response.
        let (bytes, response) = try await session.bytes(from: url)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw ClientError.message("服务器返回 HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }
        guard response.expectedContentLength <= limit else { throw ClientError.message("来源响应过大") }
        var data = Data()
        data.reserveCapacity(min(limit, max(1024, Int(response.expectedContentLength))))
        for try await byte in bytes {
            if data.count >= limit { throw ClientError.message("来源响应过大") }
            data.append(byte)
        }
        return data
    }

    nonisolated static func apiURL(_ base: String, parameter: String, value: String) throws -> URL {
        guard httpURL(base) != nil, ["wd", "ids", "pg"].contains(parameter), var parts = URLComponents(string: base) else {
            throw ClientError.message("点播接口地址无效")
        }
        parts.fragment = nil
        var query = (parts.queryItems ?? []).filter { !["ac", "wd", "ids", "pg"].contains($0.name.lowercased()) }
        query += [URLQueryItem(name: "ac", value: "videolist"), URLQueryItem(name: parameter, value: value)]
        parts.queryItems = query
        guard let url = parts.url else { throw ClientError.message("无法生成来源请求") }
        return url
    }

    nonisolated static func rows(_ data: Data) throws -> [[String: Any]] {
        let root: Any
        do { root = try JSONSerialization.jsonObject(with: data) }
        catch { throw ClientError.message("来源返回的内容不是有效 JSON") }
        func unwrap(_ value: Any, depth: Int = 0) -> [[String: Any]] {
            if let array = value as? [[String: Any]] { return array }
            guard let object = value as? [String: Any], depth < 5 else { return [] }
            if let list = object["list"] { return unwrap(list, depth: depth + 1) }
            if let nested = object["data"] { return unwrap(nested, depth: depth + 1) }
            if object["vod_id"] != nil || (object["id"] != nil && object["vod_name"] != nil) { return [object] }
            return []
        }
        return unwrap(root)
    }

    nonisolated static func parseFilms(_ data: Data, source: MediaSource, filterSearchResults: Bool = false) throws -> [Film] {
        var seen = Set<String>()
        return try rows(data).compactMap { row -> Film? in
            guard !isFiltered(row), let value = film(row, source: source),
                  !(filterSearchResults && isMovieCommentaryTitle(value.title)),
                  seen.insert(value.id).inserted else { return nil }
            return value
        }.prefix(60).map { $0 }
    }

    /// Match the existing mobile search rule: only the parsed film title, not its category or synopsis.
    nonisolated static func isMovieCommentaryTitle(_ title: String) -> Bool { title.contains("电影解说") }

    nonisolated static func filterSearchFilms(_ films: [Film]) -> [Film] {
        films.filter { !isMovieCommentaryTitle($0.title) }
    }

    nonisolated static func film(_ row: [String: Any], source: MediaSource) -> Film? {
        let id = field(row, "vod_id", "id")
        let title = plainText(field(row, "vod_name", "name", "title"))
        guard !id.isEmpty, !title.isEmpty else { return nil }
        let cover = field(row, "vod_pic", "pic", "cover")
        let coverURL = URL(string: cover, relativeTo: URL(string: source.url))?.absoluteURL.absoluteString ?? ""
        return Film(source: source, mediaID: id, title: title,
                    cover: httpURL(coverURL) == nil ? "" : coverURL,
                    category: plainText(field(row, "type_name", "vod_class", "type")),
                    year: field(row, "vod_year", "year"), remarks: plainText(field(row, "vod_remarks", "remarks", "note")))
    }

    nonisolated static func parseEpisodes(_ text: String, names: String = "") -> [Episode] {
        let lineNames = names.components(separatedBy: "$$$")
        var all: [[Episode]] = []
        for (index, group) in text.components(separatedBy: "$$$").enumerated() {
            let rawName = index < lineNames.count ? plainText(lineNames[index]) : ""
            let line = rawName.isEmpty ? "线路 \(index + 1)" : "\(rawName) · \(index + 1)"
            var seen = Set<String>()
            var episodes: [Episode] = []
            for (ordinal, raw) in group.components(separatedBy: "#").enumerated() {
                let entry = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                var name = "第\(ordinal + 1)集"
                var address = entry
                if httpURL(entry) == nil, let split = entry.firstIndex(of: "$") {
                    let label = plainText(String(entry[..<split]))
                    if !label.isEmpty { name = label }
                    address = String(entry[entry.index(after: split)...])
                }
                guard let url = httpURL(decodeEntities(address)), seen.insert(url.absoluteString).inserted else { continue }
                episodes.append(Episode(name: name, url: url.absoluteString, line: line))
            }
            if !episodes.isEmpty { all.append(episodes) }
        }
        // HLS is the most portable direct stream format on Apple platforms.
        all.sort { lhs, rhs in
            let a = lhs.contains { $0.url.lowercased().contains(".m3u8") }
            let b = rhs.contains { $0.url.lowercased().contains(".m3u8") }
            return a && !b
        }
        return all.flatMap { $0 }
    }

    nonisolated static func parseM3U(_ text: String) -> [LiveChannel] {
        var result: [LiveChannel] = []
        var seen = Set<String>()
        var name = "", group = "", logo = ""
        let pattern = #"([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))"#
        let regex = try? NSRegularExpression(pattern: pattern)
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\u{FEFF}", with: "")
            if line.hasPrefix("#EXTINF:") {
                var quoted: Character?
                let split = line.indices.first { index in
                    let character = line[index]
                    if character == "\"" || character == "'" {
                        if quoted == character { quoted = nil } else if quoted == nil { quoted = character }
                    }
                    return character == "," && quoted == nil
                }
                let metadata = split.map { String(line[..<$0]) } ?? line
                name = split.map { plainText(String(line[line.index(after: $0)...])) } ?? ""
                var attributes: [String: String] = [:]
                let ns = metadata as NSString
                for match in regex?.matches(in: metadata, range: NSRange(location: 0, length: ns.length)) ?? [] {
                    let key = ns.substring(with: match.range(at: 1)).lowercased()
                    for capture in 2...4 where match.range(at: capture).location != NSNotFound {
                        attributes[key] = decodeEntities(ns.substring(with: match.range(at: capture)))
                    }
                }
                if name.isEmpty { name = attributes["tvg-name"] ?? "" }
                group = attributes["group-title"] ?? "其他"
                logo = attributes["tvg-logo"] ?? ""
            } else if line.hasPrefix("#EXTGRP:") {
                group = String(line.dropFirst(8))
            } else if !line.hasPrefix("#"), let url = httpURL(decodeEntities(line)) {
                if seen.insert(url.absoluteString).inserted {
                    result.append(LiveChannel(name: name.isEmpty ? url.host ?? "直播频道" : name,
                                              url: url.absoluteString, group: group.isEmpty ? "其他" : group, logo: logo))
                }
                name = ""; group = ""; logo = ""
            }
        }
        return result
    }

    nonisolated static func bundledChannels() -> [LiveChannel] {
        guard let url = Bundle.main.url(forResource: "channels", withExtension: "m3u"),
              let value = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return parseM3U(value)
    }

    nonisolated static func merge(_ results: [SourceResult], keyword: String? = nil) -> [Film] {
        // Sanitize before interleaving/limits too, so older source results cannot restore excluded titles.
        let eligible = keyword == nil ? results : results.map {
            SourceResult(source: $0.source, films: filterSearchFilms($0.films), error: $0.error)
        }
        var values: [Film] = []
        for row in 0..<60 {
            for result in eligible where row < result.films.count { values.append(result.films[row]) }
        }
        if let keyword {
            let query = keyword.lowercased()
            values.sort { lhs, rhs in
                func score(_ item: Film) -> Int {
                    let title = item.title.lowercased()
                    return title == query ? 0 : title.hasPrefix(query) ? 1 : title.contains(query) ? 2 : 3
                }
                return score(lhs) < score(rhs)
            }
        }
        return Array(values.prefix(keyword == nil ? 72 : 180))
    }

    nonisolated static func field(_ object: [String: Any], _ keys: String...) -> String {
        for key in keys {
            if let text = object[key] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
            if let number = object[key] as? NSNumber { return number.stringValue }
        }
        return ""
    }

    nonisolated static func httpURL(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    nonisolated static func plainText(_ text: String) -> String {
        let clean = text.replacingOccurrences(of: #"(?is)<(script|style)\b[^>]*>.*?</\1\s*>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)<br\s*/?>|</p\s*>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
        return decodeEntities(clean).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated static func decodeEntities(_ text: String) -> String {
        var value = text
        for (entity, replacement) in [("&nbsp;", " "), ("&quot;", "\""), ("&#39;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")] {
            value = value.replacingOccurrences(of: entity, with: replacement)
        }
        guard let regex = try? NSRegularExpression(pattern: #"&#(x[0-9a-fA-F]+|[0-9]+);"#) else { return value }
        let matches = regex.matches(in: value, range: NSRange(value.startIndex..., in: value))
        for match in matches.reversed() {
            guard let range = Range(match.range(at: 1), in: value), let full = Range(match.range, in: value) else { continue }
            let digits = String(value[range])
            let code = digits.hasPrefix("x") ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits)
            if let code, let scalar = UnicodeScalar(code) { value.replaceSubrange(full, with: String(scalar)) }
        }
        return value
    }

    nonisolated static func isFiltered(_ row: [String: Any]) -> Bool {
        let category = ["type_name", "type_name_1", "type_name_2", "vod_class", "type"].map { field(row, $0) }.joined(separator: " ")
        let title = field(row, "vod_name", "name", "title") + " " + field(row, "vod_remarks", "remarks")
        return category.range(of: #"伦理|情色|色情|成人|福利|里番|无码|有码|三级|18禁|(?i:\b(porn|hentai|xxx|r18|adult)\b)"#, options: .regularExpression) != nil
            || title.range(of: #"AV片|av女优|无码|有码|色情|成人视频|成人影片|成人影视|成人动漫|成人专区|成人直播|成人写真|18禁|18\+|三级片|里番|(?i:\b(porn|hentai)\b)"#, options: .regularExpression) != nil
    }

    nonisolated static func message(_ error: Error) -> String {
        if let error = error as? URLError {
            switch error.code {
            case .timedOut: return "请求超时，请稍后重试"
            case .notConnectedToInternet: return "当前没有网络连接"
            case .cancelled: return "请求已取消"
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "无法连接此来源"
            default: break
            }
        }
        return error.localizedDescription
    }
}
