import Foundation

/// A dedicated ephemeral session never follows redirects, including redirects carrying credentials.
final class ArtworkHTTPClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = ArtworkHTTPClient()
    private var session: URLSession!

    override init() {
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 6
        configuration.timeoutIntervalForResource = 10
        configuration.httpMaximumConnectionsPerHost = 3
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpAdditionalHeaders = ["User-Agent": "Muli/2.16.12 (Apple; DetailArtwork)"]
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    static func allows(_ request: URLRequest) -> Bool {
        guard let url = request.url, url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil, request.httpMethod == nil || request.httpMethod == "GET" else { return false }
        if url.host == "api.themoviedb.org" {
            return url.path.range(of: #"^/3/(search/(movie|tv|multi)|(movie|tv)/[1-9][0-9]*(/images)?)$"#, options: .regularExpression) != nil
        }
        if url.host == "image.tmdb.org", url.path.hasPrefix("/t/p/original"), url.query == nil,
           request.value(forHTTPHeaderField: "Authorization") == nil {
            return BackdropArtwork.validPath(String(url.path.dropFirst("/t/p/original".count)))
        }
        return false
    }

    func download(_ request: URLRequest, limit: Int) async throws -> Data {
        guard Self.allows(request), limit > 0, limit <= 24 * 1024 * 1024 else { throw URLError(.badURL) }
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              response.url == request.url, response.expectedContentLength <= limit else { throw URLError(.badServerResponse) }
        var data = Data()
        data.reserveCapacity(min(limit, max(1024, Int(response.expectedContentLength))))
        for try await byte in bytes {
            if data.count >= limit { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        try Task.checkCancellation()
        return data
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum ArtworkCacheLifetime {
    static let success: TimeInterval = 24 * 60 * 60
    static let failure: TimeInterval = 10 * 60
}

/// Resolution only concerns artwork; it never calls or delays MediaRepository.details or playback.
actor BackdropRepository {
    typealias Fetch = @Sendable (URLRequest, Int) async throws -> Data
    private struct Key: Hashable {
        var identity: ArtworkIdentity
        var credentialRevision: Int
    }
    private struct Entry {
        var artwork: BackdropArtwork?
        var expires: Date
    }
    private let catalog: ArtworkCatalog
    private let fetch: Fetch
    private var cache: [Key: Entry] = [:]
    private var inFlight: [Key: Task<BackdropArtwork?, Never>] = [:]

    init(catalog: ArtworkCatalog = .bundled(), fetch: @escaping Fetch = { request, limit in
        try await ArtworkHTTPClient.shared.download(request, limit: limit)
    }) {
        self.catalog = catalog; self.fetch = fetch
    }

    func resolve(_ identity: ArtworkIdentity, credential: TMDBCredential?, credentialRevision: Int, now: Date = Date()) async -> BackdropArtwork? {
        guard identity.isUsable else { return nil }
        if let bundled = catalog.match(identity) { return bundled }
        let key = Key(identity: identity, credentialRevision: credentialRevision)
        if let entry = cache[key], entry.expires > now { return entry.artwork }
        if let task = inFlight[key] { return await task.value }
        guard let credential else { return nil }
        let fetch = self.fetch
        let task = Task { await Self.lookup(identity, credential: credential, fetch: fetch) }
        inFlight[key] = task
        let artwork = await task.value
        inFlight[key] = nil
        if cache.count >= 400 {
            cache = cache.filter { $0.value.expires > now }
            if cache.count >= 400, let oldest = cache.min(by: { $0.value.expires < $1.value.expires })?.key { cache[oldest] = nil }
        }
        cache[key] = Entry(artwork: artwork, expires: now.addingTimeInterval(artwork == nil ? ArtworkCacheLifetime.failure : ArtworkCacheLifetime.success))
        return artwork
    }

    private nonisolated static func lookup(_ identity: ArtworkIdentity, credential: TMDBCredential, fetch: Fetch) async -> BackdropArtwork? {
        do {
            let type: ArtworkMediaType
            let id: Int
            if let stableID = identity.tmdbID, let stableType = identity.mediaType {
                // /images has no release date. Validate a supplied ID's year/type against the official details first.
                guard let request = TMDBEndpoint.details(stableType, stableID).request(credential: credential) else { return nil }
                let data = try await fetch(request, 2 * 1024 * 1024)
                guard let details = try? JSONDecoder().decode(TMDBTitle.self, from: data), details.id == stableID,
                      details.type(endpoint: stableType) == stableType, details.matches(identity, type: stableType, requireTitle: false),
                      identity.imdbID == nil || identity.imdbID == details.resolvedIMDBID else { return nil }
                type = stableType; id = stableID
            } else {
                guard let year = identity.exactYear, !identity.normalizedTitle.isEmpty,
                      let request = TMDBEndpoint.search(identity.mediaType, title: identity.title, year: year, page: 1).request(credential: credential) else { return nil }
                let data = try await fetch(request, 2 * 1024 * 1024)
                guard let first = TMDBSearchPage.parse(data), let pages = first.total_pages,
                      (0...3).contains(pages), first.page == 1 else { return nil }
                var rows = first.results
                if pages > 1 {
                    for page in 2...pages {
                        guard let request = TMDBEndpoint.search(identity.mediaType, title: identity.title, year: year, page: page).request(credential: credential) else { return nil }
                        let data = try await fetch(request, 2 * 1024 * 1024)
                        guard let next = TMDBSearchPage.parse(data), next.total_pages == pages, next.page == page else { return nil }
                        rows.append(contentsOf: next.results)
                    }
                }
                guard let match = TMDBSearchPage.uniqueMatch(rows, identity: identity, endpoint: identity.mediaType) else { return nil }
                type = match.0; id = match.1
                if let imdb = identity.imdbID {
                    guard let request = TMDBEndpoint.details(type, id).request(credential: credential) else { return nil }
                    let data = try await fetch(request, 2 * 1024 * 1024)
                    guard let details = try? JSONDecoder().decode(TMDBTitle.self, from: data), details.id == id,
                          details.resolvedIMDBID == imdb, details.matches(identity, type: type, requireTitle: false) else { return nil }
                }
            }
            guard let request = TMDBEndpoint.images(type, id).request(credential: credential) else { return nil }
            let data = try await fetch(request, 2 * 1024 * 1024)
            return TMDBImages.best(data, type: type, id: id)
        } catch {
            // All errors intentionally reduce to the existing cover. Never log request URLs or credentials.
            return nil
        }
    }
}
