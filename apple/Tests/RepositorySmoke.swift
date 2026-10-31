import Foundation

@main
struct RepositorySmoke {
    static func main() async throws {
        let source = MediaSource(name: "测试源", url: "https://example.com/api.php/provide/vod?token=keep&AC=list&pg=9")
        let query = try MediaRepository.apiURL(source.url, parameter: "wd", value: "幕里 & TV")
        let parts = URLComponents(url: query, resolvingAgainstBaseURL: false)!.queryItems!
        precondition(parts.filter { $0.name.lowercased() == "ac" }.count == 1)
        precondition(parts.first { $0.name == "ac" }?.value == "videolist")
        precondition(parts.first { $0.name == "token" }?.value == "keep")
        precondition(parts.first { $0.name == "wd" }?.value == "幕里 & TV")
        precondition(!parts.contains { $0.name == "pg" })
        precondition(MediaRepository.httpURL("javascript:alert(1)") == nil)
        precondition(MediaRepository.httpURL("file:///etc/passwd") == nil)

        let json = #"{"data":{"list":[{"vod_id":42,"vod_name":"<b>测试&#x5f71;片</b>","vod_pic":"/cover.jpg","type_name":"剧情","vod_year":2026},{"vod_id":42,"vod_name":"重复"},{"vod_id":99,"vod_name":"过滤测试","type_name":"成人"},{"vod_id":100,"vod_name":"","type_name":"剧情"}]}}"#
        let films = try MediaRepository.parseFilms(Data(json.utf8), source: source)
        precondition(films.count == 1)
        precondition(films[0].mediaID == "42" && films[0].title == "测试影片")
        precondition(films[0].cover == "https://example.com/cover.jpg")
        precondition(films[0].year == "2026")
        precondition(MediaRepository.plainText("<script>alert(1)</script><p>第一行</p>第二行&nbsp;&amp;结尾") == "第一行\n第二行 &结尾")

        let commentaryJSON = #"{"list":[{"vod_id":1,"vod_name":"星际穿越","type_name":"电影解说"},{"vod_id":2,"vod_name":"电影解说：星际穿越"},{"vod_id":3,"vod_name":"星际穿越【<b>电影解说</b>】"},{"vod_id":4,"vod_name":"星际电影解说穿越"},{"vod_id":5,"vod_name":"星际穿越【影视解说】"},{"vod_id":6,"vod_name":"完整电影","vod_remarks":"电影解说"},{"vod_id":7,"vod_name":"正常影片","vod_content":"剧情涉及电影解说。"}]}"#
        let rawFilms = try MediaRepository.parseFilms(Data(commentaryJSON.utf8), source: source)
        let searchFilms = try MediaRepository.parseFilms(Data(commentaryJSON.utf8), source: source, filterSearchResults: true)
        precondition(rawFilms.count == 7)
        precondition(searchFilms.map(\.mediaID) == ["1", "5", "6", "7"])
        let legacyData = try JSONEncoder().encode(rawFilms)
        let legacyResults = SourceResult(source: source, films: try JSONDecoder().decode([Film].self, from: legacyData), error: nil)
        let cleaned = MediaRepository.merge([legacyResults], keyword: "星际穿越")
        precondition(Set(cleaned.map(\.mediaID)) == Set(searchFilms.map(\.mediaID)))
        precondition(MediaRepository.merge([legacyResults]).count == 7)
        let actorSource = MediaSource(name: "演员搜索第二源", url: "https://actor.example/api")
        let actorFilms = ["功夫足球", "功夫足球电影解说", "少林足球【电影解说】", "功夫", "功夫【电影解说】"].enumerated().map { index, title in
            Film(source: index < 3 ? source : actorSource, mediaID: String(index), title: title,
                 cover: "", category: "喜剧片", year: "", remarks: "")
        }
        let actorLegacy = try JSONDecoder().decode([Film].self, from: JSONEncoder().encode(actorFilms))
        let actorResults = [source, actorSource].map { current in
            SourceResult(source: current, films: actorLegacy.filter { $0.source == current }, error: nil)
        }
        let actorSearch = MediaRepository.merge(actorResults, keyword: "周星驰")
        precondition(actorSearch.count == 2 && Set(actorSearch.map(\.title)) == ["功夫足球", "功夫"])
        let onlyCommentary = SourceResult(source: source, films: rawFilms.filter { ["2", "3", "4"].contains($0.mediaID) }, error: nil)
        precondition(MediaRepository.merge([onlyCommentary], keyword: "星际穿越").isEmpty)
        let onlyCommentaryParsed = try MediaRepository.parseFilms(Data(#"{"list":[{"vod_id":9,"vod_name":"星际穿越【电影解说】"}]}"#.utf8), source: source, filterSearchResults: true)
        precondition(onlyCommentaryParsed.isEmpty)
        var cappedRows: [[String: Any]] = (0..<60).map { ["vod_id": $0, "vod_name": "电影解说\($0)"] }
        cappedRows.append(["vod_id": 1000, "vod_name": "正片保留"])
        let cappedData = try JSONSerialization.data(withJSONObject: ["list": cappedRows])
        let cappedSearch = try MediaRepository.parseFilms(cappedData, source: source, filterSearchResults: true)
        precondition(cappedSearch.map(\.mediaID) == ["1000"])
        let legacyCapped = SourceResult(source: source, films: cappedRows.map {
            Film(source: source, mediaID: String(describing: $0["vod_id"]!), title: $0["vod_name"] as! String,
                 cover: "", category: "", year: "", remarks: "")
        }, error: nil)
        precondition(MediaRepository.merge([legacyCapped], keyword: "正片保留").map(\.mediaID) == ["1000"])
        print("PASS: search-only title movie-commentary filtering, category/synopsis/remarks retention, parsed HTML title, legacy/multi-source actor-query sanitization, empty results and filtering before limits.")

        let episodes = MediaRepository.parseEpisodes("网页$https://example.com/page$$$第1集$https://example.com/1.m3u8#第2集$https://example.com/2.m3u8#重复$https://example.com/2.m3u8#错误$javascript:alert(1)", names: "web$$$hls")
        precondition(episodes.count == 3)
        precondition(episodes.first?.name == "第1集")
        precondition(episodes.first?.line == "hls · 2")
        precondition(episodes.filter { $0.line == "hls · 2" }.count == 2)
        let channels = MediaRepository.parseM3U("""
        #EXTM3U
        #EXTINF:-1 tvg-name="频道一" group-title="新闻,中文" tvg-logo="https://example.com/a.png",节目,一
        https://example.com/live.m3u8?x=1&amp;y=2
        #EXTINF:-1 group-title="重复",重复地址
        https://example.com/live.m3u8?x=1&y=2
        #EXTINF:-1 group-title="无效",无效频道
        javascript:alert(1)
        """)
        precondition(channels.count == 1 && channels[0].name == "节目,一" && channels[0].group == "新闻,中文")

        let result1 = SourceResult(source: source, films: films, error: nil)
        let source2 = MediaSource(name: "第二源", url: "https://second.example/api")
        let result2 = SourceResult(source: source2, films: [Film(source: source2, mediaID: "2", title: "第二个影片", cover: "", category: "", year: "", remarks: "")], error: nil)
        let merged = MediaRepository.merge([result1, result2])
        precondition(merged.count == 2 && merged[0].source == source && merged[1].source == source2)
        let history = WatchEntry(request: PlaybackRequest(title: films[0].title, film: films[0], episodes: episodes, index: 0, position: 65), updatedAt: Date(), duration: 130)
        let encoded = try JSONEncoder().encode(history)
        let restored = try JSONDecoder().decode(WatchEntry.self, from: encoded)
        precondition(restored.progress == 0.5 && restored.request.current.name == "第1集")
        precondition(WatchEntry.time(.infinity) == "00:00")
        precondition(WatchEntry.time(3661) == "1:01:01")
        print("PASS: API URL encoding, nested JSON/numeric IDs, source de-duplication, adult filtering, HTML/entities, multi-line HLS selection, invalid scheme rejection, quoted M3U metadata, aggregation, persisted resume data and time formatting.")

        let matchingDetails = #"{"list":[{"vod_id":7,"vod_name":"错误影片","vod_play_url":"正片$https://example.com/wrong.m3u8"},{"vod_id":42,"vod_name":"测试影片","vod_play_url":"第1集$https://example.com/new1.m3u8#第2集$https://example.com/new2.m3u8#第3集$https://example.com/new3.m3u8","vod_play_from":"hls"}]}"#
        let details = try MediaRepository.parseDetails(Data(matchingDetails.utf8), film: films[0])
        precondition(details.film.id == films[0].id && details.episodes.count == 3)
        let wrongDetails = #"{"list":[{"vod_id":7,"vod_name":"错误影片","vod_play_url":"正片$https://example.com/wrong.m3u8"}]}"#
        do {
            _ = try MediaRepository.parseDetails(Data(wrongDetails.utf8), film: films[0])
            preconditionFailure("A response for a different film must not open or play")
        } catch is ClientError {}
        var oldEpisodes = details.episodes
        oldEpisodes[1].url = "https://example.com/expired2.m3u8"
        let continuing = WatchEntry(request: PlaybackRequest(title: films[0].title, film: films[0], episodes: oldEpisodes, index: 1, position: 65), updatedAt: Date(), duration: 130)
        let preferred = details.preferredEpisode(line: details.lines[0], history: continuing)!
        precondition(preferred == details.episodes[1])
        precondition(continuing.position(for: preferred, film: details.film) == 65)
        precondition(continuing.playbackLabel(for: preferred, film: details.film) == "继续观看 · 第2集")
        precondition(continuing.resumedRequest?.index == 1 && continuing.resumedRequest?.position == 65)
        precondition(continuing.position(for: preferred, film: result2.films[0]) == 0)
        var alternate = preferred
        alternate.line = "备用线路"
        alternate.url = "https://example.com/alternate2.m3u8"
        precondition(continuing.position(for: alternate, film: details.film) == 65)
        var completed = continuing
        completed.request.position = 130
        precondition(completed.resumedRequest?.index == 2 && completed.resumedRequest?.position == 0)
        precondition(details.preferredEpisode(line: details.lines[0], history: completed) == details.episodes[2])
        precondition(completed.playbackLabel(for: details.episodes[2], film: details.film) == "播放下一集 · 第3集")
        completed.request.index = 2
        precondition(completed.resumedRequest?.index == 2 && completed.resumedRequest?.position == 0)
        precondition(completed.playbackLabel(for: details.episodes[2], film: details.film) == "重新播放")
        precondition(completed.position(for: details.episodes[2], film: details.film) == 0)
        var invalid = continuing
        invalid.request.episodes = []
        precondition(!invalid.request.isValid && invalid.resumedRequest == nil)
        invalid = continuing; invalid.request.index = 99
        precondition(!invalid.request.isValid && invalid.resumedRequest == nil)
        invalid = continuing; invalid.request.position = .infinity
        precondition(invalid.resumedRequest?.position == 0)
        _ = WatchEntry.time(Double.greatestFiniteMagnitude)
        print("PASS: exact film detail identity, refreshed episode URL resume, same-episode line switching, completed episode advances, completed final episode restarts, invalid history rejection and oversized time formatting.")

        if CommandLine.arguments.contains("--network") {
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let configuration = try JSONDecoder().decode(SourceConfiguration.self, from: Data(contentsOf: root.appendingPathComponent("Resources/sources.json")))
            let repository = MediaRepository()
            let results = await repository.aggregate(configuration.vodSources)
            var report: [[String: Any]] = []
            for result in results {
                var row: [String: Any] = ["source": result.source.name, "recommendationCount": result.films.count]
                if let error = result.error { row["error"] = error }
                if let film = result.films.first {
                    do {
                        let details = try await repository.details(film)
                        row["detailEpisodeCount"] = details.episodes.count
                        row["directStreamCount"] = details.episodes.filter { $0.url.contains(".m3u8") }.count
                        let search = await repository.query(result.source, keyword: film.title)
                        row["searchCount"] = search.films.count
                        if let error = search.error { row["searchError"] = error }
                    } catch { row["detailError"] = error.localizedDescription }
                }
                report.append(row)
            }
            let data = try JSONSerialization.data(withJSONObject: ["networkResults": report], options: [.prettyPrinted, .sortedKeys])
            print(String(decoding: data, as: UTF8.self))
        }
    }
}
