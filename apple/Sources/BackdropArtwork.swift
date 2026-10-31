import Foundation

/// Detail artwork has its own identity and never changes a Film's persisted poster URL.
enum ArtworkMediaType: String, Codable, Hashable, Sendable {
    case movie, tv

    static func hint(_ category: String) -> (type: Self?, conflicting: Bool) {
        let text = category.lowercased()
        let tv = text.range(of: #"电视剧|连续剧|剧集|短剧|国产剧|港剧|台剧|美剧|英剧|韩剧|日剧|泰剧|海外剧|综艺|动漫|动画剧|欧美剧|日韩剧|香港剧|台湾剧|日本剧|韩国剧|泰国剧|\btv\b|\bseries\b"#, options: .regularExpression) != nil
        let movie = text.range(of: #"电影|剧情片|喜剧片|爱情片|动作片|科幻片|恐怖片|惊悚片|悬疑片|犯罪片|战争片|动画片|纪录片|记录片|冒险片|奇幻片|灾难片|\bmovie\b|\bfilm\b"#, options: .regularExpression) != nil
        return (tv == movie ? nil : tv ? .tv : .movie, tv && movie)
    }
}

struct ArtworkIdentity: Hashable, Sendable {
    var title: String
    var year: String
    var mediaType: ArtworkMediaType?
    var tmdbID: Int?
    var imdbID: String?
    var doubanID: String?
    var hasTypeConflict = false
    var hasYearConflict = false

    init(title: String, year: String, mediaType: ArtworkMediaType? = nil, tmdbID: Int? = nil,
         imdbID: String? = nil, doubanID: String? = nil, hasTypeConflict: Bool = false, hasYearConflict: Bool = false) {
        self.title = title; self.year = year; self.mediaType = mediaType
        self.tmdbID = tmdbID; self.imdbID = imdbID; self.doubanID = doubanID
        self.hasTypeConflict = hasTypeConflict; self.hasYearConflict = hasYearConflict
    }

    init(film: Film) {
        let hint = ArtworkMediaType.hint(film.category)
        self.init(title: film.title, year: film.year, mediaType: hint.type, hasTypeConflict: hint.conflicting)
    }

    static func from(_ row: [String: Any], film: Film, original: Film? = nil) -> Self {
        let categories = [film.category, original?.category ?? "", MediaRepository.field(row, "type_name_1"),
                          MediaRepository.field(row, "type_name_2"), MediaRepository.field(row, "vod_class")].joined(separator: " ")
        let hint = ArtworkMediaType.hint(categories)
        let originalYear = strictYear(original?.year ?? "")
        let detailYear = strictYear(film.year)
        let yearConflict = originalYear != nil && detailYear != nil && originalYear != detailYear
        let year = film.year.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? original?.year ?? "" : film.year
        let tmdb = MediaRepository.field(row, "tmdb_id", "vod_tmdb_id", "tmdbId")
        let imdb = MediaRepository.field(row, "imdb_id", "vod_imdb_id", "vod_imdb", "imdbId")
        let douban = MediaRepository.field(row, "douban_id", "vod_douban_id", "doubanId")
        return Self(title: film.title, year: year, mediaType: hint.type,
                    tmdbID: positiveID(tmdb), imdbID: imdb.range(of: #"^tt[0-9]{5,12}$"#, options: .regularExpression) == nil ? nil : imdb,
                    doubanID: positiveID(douban).map(String.init), hasTypeConflict: hint.conflicting, hasYearConflict: yearConflict)
    }

    static func positiveID(_ text: String) -> Int? {
        guard text.range(of: #"^[0-9]{1,12}$"#, options: .regularExpression) != nil, let id = Int(text), id > 0 else { return nil }
        return id
    }

    static func normalizeTitle(_ text: String) -> String {
        let folded = text.precomposedStringWithCompatibilityMapping.folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        // Keep all letters/numbers, including Chinese. Never remove years, season numbers or title suffixes.
        return String(folded.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
    }

    static func strictYear(_ text: String) -> String? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.range(of: #"^[12][0-9]{3}$"#, options: .regularExpression) == nil ? nil : value
    }

    var normalizedTitle: String { Self.normalizeTitle(title) }
    var exactYear: String? { Self.strictYear(year) }
    var isUsable: Bool {
        !hasTypeConflict && !hasYearConflict && (!year.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? exactYear != nil : true)
            && (tmdbID == nil || tmdbID! > 0)
    }
    var hasStableID: Bool { tmdbID != nil || imdbID != nil || doubanID != nil }
}

struct BackdropArtwork: Codable, Hashable, Sendable {
    var mediaType: ArtworkMediaType
    var tmdbID: Int
    var filePath: String
    var width: Int
    var height: Int

    static func validDimensions(width: Int, height: Int) -> Bool {
        guard width >= 1280, height >= 720, width <= 16384, height <= 16384 else { return false }
        let ratio = Double(width) / Double(height)
        return (1.5...2.4).contains(ratio) && Double(width) * Double(height) <= 80_000_000
    }
    static func validPath(_ path: String) -> Bool {
        path.range(of: #"^/[A-Za-z0-9]{8,80}\.(jpg|png|webp)\z"#, options: .regularExpression) != nil
    }
    var url: URL? {
        guard tmdbID > 0, Self.validPath(filePath), Self.validDimensions(width: width, height: height) else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/original" + filePath)
    }
}

struct ArtworkCatalog: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        var mediaType: ArtworkMediaType
        var tmdbId: Int
        var imdbId: String?
        var doubanId: String?
        var year: String
        var titles: [String]
        var backdropPath: String
        var width: Int
        var height: Int
        var artwork: BackdropArtwork {
            BackdropArtwork(mediaType: mediaType, tmdbID: tmdbId, filePath: backdropPath, width: width, height: height)
        }
    }
    var version: Int
    var items: [Item]
    static let empty = Self(version: 1, items: [])
    static func parse(_ data: Data) -> Self {
        guard data.count <= 2 * 1024 * 1024, let value = try? JSONDecoder().decode(Self.self, from: data), value.version == 1 else { return .empty }
        return value
    }
    static func bundled() -> Self {
        guard let url = Bundle.main.url(forResource: "artwork-catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return .empty }
        return parse(data)
    }

    func match(_ identity: ArtworkIdentity) -> BackdropArtwork? {
        guard identity.isUsable else { return nil }
        let matches = items.filter { item in
            guard item.artwork.url != nil, ArtworkIdentity.strictYear(item.year) != nil,
                  identity.mediaType == nil || identity.mediaType == item.mediaType,
                  identity.exactYear == nil || identity.exactYear == item.year else { return false }
            if identity.hasStableID {
                // Unknown catalog fields are not conflicts, but at least one known stable ID must agree.
                var matched = false
                if let id = identity.tmdbID {
                    guard id == item.tmdbId else { return false }
                    matched = true
                }
                if let id = identity.imdbID, let known = item.imdbId {
                    guard id == known else { return false }
                    matched = true
                }
                if let id = identity.doubanID, let known = item.doubanId {
                    guard id == known else { return false }
                    matched = true
                }
                return matched
            }
            guard identity.exactYear != nil, !identity.normalizedTitle.isEmpty else { return false }
            return item.titles.contains { ArtworkIdentity.normalizeTitle($0) == identity.normalizedTitle }
        }
        let unique = Set(matches.map(\.artwork))
        return unique.count == 1 ? unique.first : nil
    }
}

/// Credentials never enter Film, UserDefaults, a cache key, an error description, or a diagnostic.
enum TMDBCredential: Sendable {
    case apiKey(String), bearer(String)
    init?(_ input: String?) {
        guard var value = input?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        if value.lowercased().hasPrefix("bearer ") { value = String(value.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines) }
        guard value.count <= 4096, value.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil else { return nil }
        self = value.contains(".") ? .bearer(value) : .apiKey(value)
    }
}

enum TMDBEndpoint: Sendable {
    case search(ArtworkMediaType?, title: String, year: String, page: Int)
    case details(ArtworkMediaType, Int)
    case images(ArtworkMediaType, Int)

    func request(credential: TMDBCredential) -> URLRequest? {
        var parts = URLComponents()
        parts.scheme = "https"; parts.host = "api.themoviedb.org"
        switch self {
        case .search(let type, let title, let year, let page):
            guard !title.isEmpty, title.count <= 250, ArtworkIdentity.strictYear(year) != nil, (1...3).contains(page) else { return nil }
            parts.path = "/3/search/" + (type?.rawValue ?? "multi")
            parts.queryItems = [URLQueryItem(name: "query", value: title), URLQueryItem(name: "language", value: "zh-CN"),
                                URLQueryItem(name: "include_adult", value: "false"), URLQueryItem(name: "page", value: String(page))]
            if let type { parts.queryItems?.append(URLQueryItem(name: type == .movie ? "year" : "first_air_date_year", value: year)) }
        case .details(let type, let id):
            guard id > 0 else { return nil }
            parts.path = "/3/\(type.rawValue)/\(id)"
            parts.queryItems = [URLQueryItem(name: "language", value: "zh-CN"),
                                URLQueryItem(name: "append_to_response", value: "external_ids")]
        case .images(let type, let id):
            guard id > 0 else { return nil }
            parts.path = "/3/\(type.rawValue)/\(id)/images"
            parts.queryItems = [URLQueryItem(name: "include_image_language", value: "null,zh,en")]
        }
        if case .apiKey(let value) = credential { parts.queryItems?.append(URLQueryItem(name: "api_key", value: value)) }
        guard let url = parts.url, url.host == "api.themoviedb.org" else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if case .bearer(let value) = credential { request.setValue("Bearer " + value, forHTTPHeaderField: "Authorization") }
        return request
    }
}

struct TMDBTitle: Decodable, Sendable {
    var id: Int
    var media_type: String?
    var title: String?
    var original_title: String?
    var name: String?
    var original_name: String?
    var release_date: String?
    var first_air_date: String?
    var imdb_id: String?
    struct ExternalIDs: Decodable, Sendable { var imdb_id: String? }
    var external_ids: ExternalIDs?
    var resolvedIMDBID: String? { imdb_id ?? external_ids?.imdb_id }

    func type(endpoint: ArtworkMediaType?) -> ArtworkMediaType? {
        if let media_type {
            guard let type = ArtworkMediaType(rawValue: media_type), endpoint == nil || type == endpoint else { return nil }
            return type
        }
        return endpoint
    }
    func matches(_ identity: ArtworkIdentity, type: ArtworkMediaType, requireTitle: Bool) -> Bool {
        guard id > 0, identity.isUsable, identity.mediaType == nil || identity.mediaType == type,
              identity.tmdbID == nil || identity.tmdbID == id else { return false }
        if let expectedYear = identity.exactYear {
            let date = type == .movie ? release_date : first_air_date
            guard let date, date.range(of: #"^[12][0-9]{3}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil,
                  String(date.prefix(4)) == expectedYear else { return false }
        } else if requireTitle { return false }
        if requireTitle {
            let names = type == .movie ? [title, original_title] : [name, original_name]
            return !identity.normalizedTitle.isEmpty && names.compactMap { $0 }.contains { ArtworkIdentity.normalizeTitle($0) == identity.normalizedTitle }
        }
        return true
    }
}

struct TMDBSearchPage: Decodable, Sendable {
    var results: [TMDBTitle]
    var total_pages: Int?
    var page: Int?

    static func parse(_ data: Data) -> Self? { try? JSONDecoder().decode(Self.self, from: data) }
    static func uniqueMatch(_ rows: [TMDBTitle], identity: ArtworkIdentity, endpoint: ArtworkMediaType?) -> (ArtworkMediaType, Int)? {
        var matches = Set<String>()
        var result: (ArtworkMediaType, Int)?
        for row in rows {
            guard let type = row.type(endpoint: endpoint), row.matches(identity, type: type, requireTitle: true) else { continue }
            matches.insert(type.rawValue + ":" + String(row.id)); result = (type, row.id)
        }
        return matches.count == 1 ? result : nil
    }
}

struct TMDBImages: Decodable, Sendable {
    struct Image: Decodable, Sendable {
        var file_path: String
        var width: Int
        var height: Int
        var iso_639_1: String?
        var vote_average: Double?
        var vote_count: Int?
    }
    var id: Int?
    var backdrops: [Image]

    static func best(_ data: Data, type: ArtworkMediaType, id: Int) -> BackdropArtwork? {
        guard data.count <= 2 * 1024 * 1024, let images = try? JSONDecoder().decode(Self.self, from: data),
              images.id == nil || images.id == id else { return nil }
        let valid = images.backdrops.filter {
            BackdropArtwork.validPath($0.file_path) && BackdropArtwork.validDimensions(width: $0.width, height: $0.height)
                && ($0.iso_639_1 == nil || ["zh", "en"].contains($0.iso_639_1))
        }.sorted { a, b in
            if (a.iso_639_1 == nil) != (b.iso_639_1 == nil) { return a.iso_639_1 == nil }
            if (a.width >= 1920) != (b.width >= 1920) { return a.width >= 1920 }
            let aPixels = a.width * a.height, bPixels = b.width * b.height
            if aPixels != bPixels { return aPixels > bPixels }
            if (a.vote_count ?? 0) != (b.vote_count ?? 0) { return (a.vote_count ?? 0) > (b.vote_count ?? 0) }
            if (a.vote_average ?? 0) != (b.vote_average ?? 0) { return (a.vote_average ?? 0) > (b.vote_average ?? 0) }
            return a.file_path < b.file_path
        }
        guard let best = valid.first else { return nil }
        return BackdropArtwork(mediaType: type, tmdbID: id, filePath: best.file_path, width: best.width, height: best.height)
    }
}
