import Foundation
import CoreGraphics
import ImageIO

private func bytes(_ value: String) -> Data { Data(value.utf8) }
private let searchFixture = bytes(#"{"page":1,"total_pages":1,"results":[{"id":10,"title":"同名影片","original_title":"The Same Title","release_date":"2019-06-12"}]}"#)
private let imagesFixture = bytes(#"{"id":10,"backdrops":[{"file_path":"/abcdefgh12345678.jpg","width":3840,"height":2160,"iso_639_1":null}]}"#)

private actor FixtureTransport {
    var calls = 0
    var search: Data
    var images: Data
    var details: Data
    var secondPage: Data?
    var failing: Bool
    init(search: Data = searchFixture, images: Data = imagesFixture,
         details: Data = bytes(#"{"id":10,"title":"同名影片","release_date":"2019-06-12","imdb_id":"tt1234567"}"#),
         secondPage: Data? = nil, failing: Bool = false) {
        self.search = search; self.images = images; self.details = details
        self.secondPage = secondPage; self.failing = failing
    }
    func fetch(_ request: URLRequest, limit: Int) async throws -> Data {
        calls += 1
        precondition(ArtworkHTTPClient.allows(request) && limit == 2 * 1024 * 1024)
        // Yield to exercise overlapping callers without a timer or real network access.
        for _ in 0..<12 { await Task.yield() }
        if failing { throw URLError(.timedOut) }
        let url = request.url!
        if url.path.contains("/search/") {
            let page = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "page" }?.value
            return page == "2" ? secondPage ?? search : search
        }
        return url.path.hasSuffix("/images") ? images : details
    }
}

@main
struct ArtworkSmoke {
    static func main() async throws {
        let catalog = ArtworkCatalog.parse(bytes(#"""
        {"version":1,"future_field":"allowed","items":[
          {"mediaType":"movie","tmdbId":10,"imdbId":"tt1234567","doubanId":"1234567","year":"2019","titles":["同名影片","The Same Title"],"backdropPath":"/abcdefgh12345678.jpg","width":3840,"height":2160},
          {"mediaType":"movie","tmdbId":11,"year":"1982","titles":["同名影片"],"backdropPath":"/ijklmnop12345678.jpg","width":1920,"height":1080},
          {"mediaType":"tv","tmdbId":12,"doubanId":"7654321","year":"2019","titles":["同名影片"],"backdropPath":"/qrstuvwx12345678.jpg","width":1920,"height":1080}
        ]}
        """#))
        let identity = ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .movie)
        precondition(catalog.match(identity)?.tmdbID == 10)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "1982", mediaType: .movie))?.tmdbID == 11)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv))?.tmdbID == 12)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2020", mediaType: .movie)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019")) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "", mediaType: .movie)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019/2020", mediaType: .movie)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "THE SAME: TITLE", year: "2019", mediaType: .movie))?.tmdbID == 10)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片 第二季", year: "2019", mediaType: .movie)) == nil)
        precondition(ArtworkIdentity.normalizeTitle("ＳＡＭＥ　Title！") == "sametitle")
        print("PASS: exact normalized title/year, remake separation, movie/TV ambiguity, missing/invalid year and title suffix rejection.")

        precondition(catalog.match(ArtworkIdentity(title: "其他译名", year: "", mediaType: .movie, tmdbID: 10))?.tmdbID == 10)
        precondition(catalog.match(ArtworkIdentity(title: "", year: "", imdbID: "tt1234567"))?.tmdbID == 10)
        precondition(catalog.match(ArtworkIdentity(title: "", year: "", doubanID: "1234567"))?.tmdbID == 10)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "1982", mediaType: .movie, tmdbID: 10)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv, tmdbID: 10)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .movie, tmdbID: 11)) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "", year: "", tmdbID: 10, imdbID: "tt9999999")) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv,
                                                   imdbID: "tt9999999", doubanID: "7654321"))?.tmdbID == 12)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv,
                                                   tmdbID: 12, imdbID: "tt9999999"))?.tmdbID == 12)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv,
                                                   imdbID: "tt9999999")) == nil)
        precondition(catalog.match(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv,
                                                   tmdbID: 12, doubanID: "1111111")) == nil)
        precondition(ArtworkCatalog.parse(bytes("bad-json")).items.isEmpty)
        precondition(ArtworkCatalog.parse(bytes(#"{"version":2,"items":[]}"#)).items.isEmpty)
        print("PASS: stable TMDB/IMDb/Douban matching with at least one known ID hit, unknown optional IDs tolerated, known ID/year/type conflicts rejected, forward-compatible/corrupt/versioned catalog fallback.")

        for path in ["https://evil.example/image.jpg", "//evil.example/a.jpg", "/../abcdefgh.jpg", "/abcdefgh.jpg?key=bad", "/abcdefgh.jpg#bad", "/abcdefgh%2Fbad.jpg", "/abcdefgh.svg", "/a.jpg", "/abcdefgh.jpg\n"] {
            precondition(!BackdropArtwork.validPath(path))
        }
        precondition(BackdropArtwork.validPath("/abcdefgh12345678.jpg"))
        for (width, height) in [(640, 360), (720, 1280), (1280, 719), (1920, 400), (1600, 1200), (20000, 12000), (0, 0)] {
            precondition(!BackdropArtwork.validDimensions(width: width, height: height))
        }
        precondition(BackdropArtwork.validDimensions(width: 1280, height: 720))
        precondition(BackdropArtwork.validDimensions(width: 3840, height: 2160))
        precondition(catalog.match(identity)?.url?.absoluteString == "https://image.tmdb.org/t/p/original/abcdefgh12345678.jpg")
        print("PASS: safe hash-only original image URLs, minimum dimensions, landscape ratio and decoded memory bounds.")

        let ranked = bytes(#"""
        {"backdrops":[
          {"file_path":"/landscape111.jpg","width":3840,"height":2160,"iso_639_1":"en"},
          {"file_path":"/neutral11111.jpg","width":1280,"height":720,"iso_639_1":null},
          {"file_path":"/neutral22222.jpg","width":1920,"height":1080,"iso_639_1":null},
          {"file_path":"/neutral33333.jpg","width":3840,"height":2160,"iso_639_1":null},
          {"file_path":"/portrait1111.jpg","width":2160,"height":3840,"iso_639_1":null},
          {"file_path":"/japanese1111.jpg","width":7680,"height":4320,"iso_639_1":"ja"},
          {"file_path":"/../bad.jpg","width":7680,"height":4320,"iso_639_1":null}
        ],"posters":[{"file_path":"/poster111111.jpg","width":3840,"height":2160}]}
        """#)
        precondition(TMDBImages.best(ranked, type: .movie, id: 10)?.filePath == "/neutral33333.jpg")
        precondition(TMDBImages.best(bytes(#"{"posters":[{"file_path":"/poster111111.jpg","width":3840,"height":2160}]}"#), type: .movie, id: 10) == nil)
        precondition(TMDBImages.best(bytes(#"{"id":99,"backdrops":[]}"#), type: .movie, id: 10) == nil)
        precondition(TMDBImages.best(bytes("<html>error</html>"), type: .movie, id: 10) == nil)
        print("PASS: backdrop-only response selection, text-free/HD/pixel ranking and malformed/wrong-ID response fallback.")

        let mixed = TMDBSearchPage.parse(bytes(#"""
        {"results":[
          {"id":10,"media_type":"movie","title":"同名影片","release_date":"2019-01-01"},
          {"id":11,"media_type":"movie","title":"同名影片","release_date":"1982-01-01"},
          {"id":12,"media_type":"tv","name":"同名影片","first_air_date":"2019-01-01"},
          {"id":13,"media_type":"person","name":"同名影片"},
          {"id":14,"media_type":"movie","title":"同名影片 第二季","release_date":"2019-01-01"}
        ]}
        """#))!
        precondition(TMDBSearchPage.uniqueMatch(mixed.results, identity: identity, endpoint: nil)?.1 == 10)
        precondition(TMDBSearchPage.uniqueMatch(mixed.results, identity: ArtworkIdentity(title: "同名影片", year: "2019"), endpoint: nil) == nil)
        let original = TMDBSearchPage.parse(searchFixture)!
        precondition(TMDBSearchPage.uniqueMatch(original.results, identity: ArtworkIdentity(title: "The Same Title", year: "2019", mediaType: .movie), endpoint: .movie)?.1 == 10)
        let duplicate = TMDBSearchPage.parse(bytes(#"{"results":[{"id":15,"title":"同名影片","release_date":"2019-06-12"}]}"#))!
        precondition(TMDBSearchPage.uniqueMatch(original.results + duplicate.results, identity: identity, endpoint: .movie) == nil)
        precondition(TMDBSearchPage.uniqueMatch(original.results, identity: ArtworkIdentity(title: "同名影片", year: "", mediaType: .movie), endpoint: .movie) == nil)
        print("PASS: TMDB original-title matching, strict release year, person/type exclusion and multiple exact matches rejected.")

        let key = TMDBCredential("test_fixture_key")!
        let bearer = TMDBCredential("Bearer fixture.payload.signature")!
        let apiRequest = TMDBEndpoint.search(.tv, title: "A & B", year: "2019", page: 1).request(credential: key)!
        let apiParts = URLComponents(url: apiRequest.url!, resolvingAgainstBaseURL: false)!
        precondition(apiParts.host == "api.themoviedb.org" && apiParts.path == "/3/search/tv")
        precondition(apiParts.queryItems?.first { $0.name == "query" }?.value == "A & B")
        precondition(apiParts.queryItems?.first { $0.name == "first_air_date_year" }?.value == "2019")
        precondition(apiParts.queryItems?.first { $0.name == "api_key" }?.value == "test_fixture_key")
        let jwtRequest = TMDBEndpoint.images(.movie, 10).request(credential: bearer)!
        precondition(jwtRequest.value(forHTTPHeaderField: "Authorization") == "Bearer fixture.payload.signature")
        precondition(URLComponents(url: jwtRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains { $0.name == "api_key" } == false)
        precondition(URLComponents(url: jwtRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "include_image_language" }?.value == "null,zh,en")
        precondition(TMDBCredential("bad\ncredential") == nil && TMDBCredential("https://other.example/key") == nil)
        precondition(TMDBEndpoint.images(.movie, -1).request(credential: key) == nil)
        for url in ["https://api.themoviedb.org.evil.example/3/search/movie", "https://api.themoviedb.org@evil.example/3/search/movie", "http://api.themoviedb.org/3/search/movie", "https://www.themoviedb.org/movie/10", "https://image.tmdb.org/t/p/w500/abcdefgh.jpg", "https://api.themoviedb.org/3/configuration"] {
            precondition(!ArtworkHTTPClient.allows(URLRequest(url: URL(string: url)!)))
        }
        var unauthorizedImage = URLRequest(url: catalog.match(identity)!.url!)
        unauthorizedImage.setValue("Bearer fixture.payload.signature", forHTTPHeaderField: "Authorization")
        precondition(!ArtworkHTTPClient.allows(unauthorizedImage))
        print("PASS: official API endpoint construction, v3 key/Bearer routing, fixed-host restrictions and no credentials on image requests.")

        let source = MediaSource(name: "fixture", url: "https://source.invalid/api")
        let film = Film(source: source, mediaID: "777", title: "同名影片", cover: "https://source.invalid/poster.jpg", category: "剧情片", year: "2019", remarks: "")
        let parsed = ArtworkIdentity.from(["vod_tmdb_id": 10, "vod_imdb": "tt1234567", "vod_douban_id": 1234567], film: film)
        precondition(parsed.tmdbID == 10 && parsed.imdbID == "tt1234567" && parsed.doubanID == "1234567")
        precondition(ArtworkIdentity(film: film).tmdbID == nil) // source-local vod_id is not a TMDB ID
        precondition(ArtworkIdentity.from(["type_name_1": "电视剧"], film: film).hasTypeConflict)
        var incomplete = film; incomplete.year = ""; incomplete.category = ""
        let retained = ArtworkIdentity.from([:], film: incomplete, original: film)
        precondition(retained.exactYear == "2019" && retained.mediaType == .movie)
        var changedYear = film; changedYear.year = "1982"
        let yearConflict = ArtworkIdentity.from([:], film: changedYear, original: film)
        precondition(yearConflict.hasYearConflict && !yearConflict.isUsable && catalog.match(yearConflict) == nil)
        var changedType = film; changedType.category = "电视剧"
        precondition(!ArtworkIdentity.from([:], film: changedType, original: film).isUsable)
        let legacy = bytes(#"{"source":{"name":"旧来源","url":"https://source.invalid/api"},"mediaID":"old","title":"旧片","cover":"https://source.invalid/old.jpg","category":"剧情片","year":"2019","remarks":""}"#)
        let restored = try JSONDecoder().decode(Film.self, from: legacy)
        let entry = WatchEntry(request: PlaybackRequest(title: restored.title, film: restored, episodes: [Episode(name: "正片", url: "https://source.invalid/play.m3u8", line: "a")], index: 0, position: 60), updatedAt: Date(), duration: 120)
        let history = try JSONDecoder().decode(WatchEntry.self, from: JSONEncoder().encode(entry))
        precondition(history.request.film?.cover == "https://source.invalid/old.jpg" && history.progress == 0.5)
        let stored = try JSONSerialization.jsonObject(with: JSONEncoder().encode(film)) as! [String: Any]
        precondition(stored["cover"] as? String == film.cover && stored["artworkIdentity"] == nil && stored["api_key"] == nil)
        print("PASS: source stable-ID extraction, conflicting category rejection, legacy Film/history decoding and unchanged poster persistence.")

        precondition(BackdropImageDecoder.decode(bytes("broken-image")) == nil)
        precondition(BackdropImageDecoder.decode(bytes(#"{"error":"not an image"}"#)) == nil)
        for (width, height) in [(400, 600), (1600, 1200), (720, 1280)] {
            precondition(BackdropImageDecoder.decode(makePNG(width: width, height: height)) == nil)
        }
        let decoded = BackdropImageDecoder.decode(makePNG(width: 1280, height: 720))
        precondition(decoded?.width == 1280 && decoded?.height == 720)
        print("PASS: actual image decode accepts HD landscape, rejects corrupt payloads, undersized covers and portrait/non-landscape images.")

        let t0 = Date(timeIntervalSince1970: 1_000_000)
        let noKeyTransport = FixtureTransport()
        let noKey = BackdropRepository(catalog: catalog, fetch: { try await noKeyTransport.fetch($0, limit: $1) })
        let builtIn = await noKey.resolve(identity, credential: nil, credentialRevision: 0, now: t0)
        precondition(builtIn?.tmdbID == 10)
        let unknown = await noKey.resolve(ArtworkIdentity(title: "未收录影片", year: "2019", mediaType: .movie), credential: nil, credentialRevision: 0, now: t0)
        precondition(unknown == nil)
        let noKeyCalls = await noKeyTransport.calls
        precondition(noKeyCalls == 0)
        print("PASS: no credential means no API request; only the explicitly bundled catalog resolves without a key.")

        let tvTransport = FixtureTransport(
            images: bytes(#"{"id":12,"backdrops":[{"file_path":"/tvbackdrop123456.jpg","width":1920,"height":1080,"iso_639_1":null}]}"#),
            details: bytes(#"{"id":12,"name":"同名影片","first_air_date":"2019-01-01","external_ids":{"imdb_id":"tt9999999"}}"#))
        let tvRepository = BackdropRepository(catalog: .empty, fetch: { try await tvTransport.fetch($0, limit: $1) })
        let tvIdentity = ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .tv, tmdbID: 12, imdbID: "tt9999999")
        let tvArtwork = await tvRepository.resolve(tvIdentity, credential: key, credentialRevision: 0, now: t0)
        precondition(tvArtwork?.mediaType == .tv && tvArtwork?.tmdbID == 12)
        let tvCalls = await tvTransport.calls
        precondition(tvCalls == 2)
        let tvMetadataRequest = TMDBEndpoint.details(.tv, 12).request(credential: key)!
        precondition(URLComponents(url: tvMetadataRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "append_to_response" }?.value == "external_ids")
        print("PASS: TV stable-ID metadata validates nested IMDb external IDs using the official append_to_response API.")

        let transport = FixtureTransport()
        let repository = BackdropRepository(catalog: .empty, fetch: { try await transport.fetch($0, limit: $1) })
        let concurrent = await withTaskGroup(of: BackdropArtwork?.self) { group in
            for _ in 0..<20 { group.addTask { await repository.resolve(identity, credential: key, credentialRevision: 0, now: t0) } }
            var values: [BackdropArtwork?] = []
            for await value in group { values.append(value) }
            return values
        }
        precondition(concurrent.count == 20 && concurrent.allSatisfy { $0?.tmdbID == 10 })
        let initialCalls = await transport.calls
        precondition(initialCalls == 2)
        _ = await repository.resolve(identity, credential: key, credentialRevision: 0, now: t0.addingTimeInterval(86399))
        let cachedCalls = await transport.calls
        precondition(cachedCalls == 2)
        _ = await repository.resolve(identity, credential: key, credentialRevision: 0, now: t0.addingTimeInterval(86401))
        let expiredCalls = await transport.calls
        precondition(expiredCalls == 4)
        print("PASS: 20 overlapping queries share one search/images pair, success cache lasts 24h and expires deterministically.")

        let failureTransport = FixtureTransport(failing: true)
        let failing = BackdropRepository(catalog: .empty, fetch: { try await failureTransport.fetch($0, limit: $1) })
        let firstFailure = await failing.resolve(identity, credential: key, credentialRevision: 0, now: t0)
        let cachedFailure = await failing.resolve(identity, credential: key, credentialRevision: 0, now: t0.addingTimeInterval(599))
        precondition(firstFailure == nil && cachedFailure == nil)
        let failureCalls = await failureTransport.calls
        precondition(failureCalls == 1)
        _ = await failing.resolve(identity, credential: key, credentialRevision: 0, now: t0.addingTimeInterval(601))
        let retriedCalls = await failureTransport.calls
        precondition(retriedCalls == 2)
        _ = await failing.resolve(identity, credential: bearer, credentialRevision: 1, now: t0.addingTimeInterval(602))
        let changedCredentialCalls = await failureTransport.calls
        precondition(changedCredentialCalls == 3)
        print("PASS: timeouts silently fall back, failures cache for 10min and a new credential revision retries immediately.")

        for malformed in [bytes("<html>failure</html>"), bytes(#"{"results":[]}"#), bytes(#"{"page":1,"total_pages":4,"results":[]}"#)] {
            let stub = FixtureTransport(search: malformed)
            let repo = BackdropRepository(catalog: .empty, fetch: { try await stub.fetch($0, limit: $1) })
            let result = await repo.resolve(identity, credential: key, credentialRevision: 0, now: t0)
            precondition(result == nil)
            let calls = await stub.calls
            precondition(calls == 1)
        }
        let conflict = FixtureTransport(details: bytes(#"{"id":10,"title":"同名影片","release_date":"1982-01-01"}"#))
        let conflictRepo = BackdropRepository(catalog: .empty, fetch: { try await conflict.fetch($0, limit: $1) })
        let conflictResult = await conflictRepo.resolve(ArtworkIdentity(title: "同名影片", year: "2019", mediaType: .movie, tmdbID: 10), credential: key, credentialRevision: 0, now: t0)
        precondition(conflictResult == nil)
        let conflictCalls = await conflict.calls
        precondition(conflictCalls == 1)
        let badImages = FixtureTransport(images: bytes(#"{"backdrops":[{"file_path":"https://bad.example/a.jpg","width":3840,"height":2160}]}"#))
        let badImagesRepo = BackdropRepository(catalog: .empty, fetch: { try await badImages.fetch($0, limit: $1) })
        let badImageResult = await badImagesRepo.resolve(identity, credential: key, credentialRevision: 0, now: t0)
        precondition(badImageResult == nil)
        print("PASS: broken/missing/truncated API responses, wrong stable-ID year and invalid image response all preserve fallback.")

        let firstPage = bytes(#"{"page":1,"total_pages":2,"results":[{"id":10,"title":"同名影片","release_date":"2019-06-12"}]}"#)
        let secondPage = bytes(#"{"page":2,"total_pages":2,"results":[{"id":15,"title":"同名影片","release_date":"2019-06-12"}]}"#)
        let paged = FixtureTransport(search: firstPage, secondPage: secondPage)
        let pagedRepo = BackdropRepository(catalog: .empty, fetch: { try await paged.fetch($0, limit: $1) })
        let ambiguous = await pagedRepo.resolve(identity, credential: key, credentialRevision: 0, now: t0)
        precondition(ambiguous == nil)
        let pagedCalls = await paged.calls
        precondition(pagedCalls == 2)
        print("PASS: ambiguity on a later search page is detected before any image request.")

        if CommandLine.arguments.count > 1 {
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let shared = ArtworkCatalog.parse(try Data(contentsOf: root.appendingPathComponent("../shared/artwork-catalog.json")))
            precondition(!shared.items.isEmpty && shared.items.allSatisfy { $0.artwork.url != nil })
            let portrait = shared.match(ArtworkIdentity(title: "燃烧女子的肖像", year: "2019", mediaType: .movie))
            precondition(portrait?.tmdbID == 531428 && portrait?.width == 3840 && portrait?.height == 2160)
            let glory = shared.match(ArtworkIdentity(title: "黑暗荣耀", year: "2022", mediaType: .tv))
            precondition(glory?.tmdbID == 136283 && glory?.width == 3839 && glory?.height == 2160)
            print("PASS: current shared verified catalog loads (\(shared.items.count) items), including Portrait of a Lady on Fire 2019 and The Glory 2022 with verified 4K backgrounds.")
        }
        print("All artwork checks passed. Offline fixtures only; no TMDB credentials or live API requests were used.")
    }

    private static func makePNG(width: Int, height: Int) -> Data {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.2, green: 0.3, blue: 0.4, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        precondition(CGImageDestinationFinalize(destination))
        return data as Data
    }
}
