package org.kongwotv.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.*;

public class ArtworkRepositoryTest {
    private static final TvRepository.Source SOURCE = new TvRepository.Source("fixture", "https://source.example/vod");
    private static final String PATH = "/AbCdEfGhIjKlMnOpQrStUvWxYz1.jpg";
    private static final String CATALOG = "{\"version\":1,\"items\":[{\"mediaType\":\"movie\",\"tmdbId\":531428,\"imdbId\":\"tt8613070\",\"doubanId\":\"30257175\",\"year\":\"2019\",\"titles\":[\"燃烧女子的肖像\",\"Portrait of a Lady on Fire\"],\"backdropPath\":\"" + PATH + "\",\"width\":3840,\"height\":2160}]}";

    @Test public void bundledCatalogIsTheSharedValidatedAsset() throws Exception {
        String path = System.getProperty("kongwotv.artwork.catalog");
        assertNotNull(path);
        String catalog = new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
        List<ArtworkRepository.CatalogItem> parsed = ArtworkRepository.parseCatalog(catalog);
        assertEquals(new JSONObject(catalog).getJSONArray("items").length(), parsed.size());
        Backdrop series = match(catalog, item("黑暗荣耀", "2022", "韩剧"));
        assertNotNull(series);
        assertEquals("tv", series.mediaType);
        assertEquals(136283, series.tmdbId);
        assertNull(match(catalog, item("黑暗荣耀", "2022", "剧情片")));
        Backdrop image = match(catalog, item("燃烧女子的肖像", "2019", "剧情片"));
        assertNotNull(image);
        assertEquals(531428, image.tmdbId);
        assertEquals(3840, image.width);
        assertEquals(2160, image.height);
    }

    @Test public void exactNormalizedTitlesRequireTheSameYear() {
        assertNotNull(match(CATALOG, item("Ｐｏｒｔｒａｉｔ of a Lady on Fire", "2019", "剧情片")));
        assertNull(match(CATALOG, item("燃烧女子的肖像", "2020", "剧情片")));
        assertNull(match(CATALOG, item("燃烧女子的肖像", "", "剧情片")));
        assertNull(match(CATALOG, item("燃烧女子的肖像", "2019-2020", "剧情片")));
        assertNull(match(CATALOG, item("燃烧女子的肖像 导演剪辑版", "2019", "剧情片")));
    }

    @Test public void stableIdsPermitMissingYearButRejectYearAndTypeConflicts() {
        assertNotNull(match(CATALOG, identified("别名", "", "剧情片", "movie", 531428, "", "")));
        assertNotNull(match(CATALOG, identified("别名", "", "", "", 0, "tt8613070", "")));
        assertNotNull(match(CATALOG, identified("别名", "", "", "", 0, "", "30257175")));
        assertNull(match(CATALOG, identified("别名", "2020", "剧情片", "movie", 531428, "", "")));
        assertNull(match(CATALOG, identified("别名", "2019", "国产剧", "tv", 531428, "", "")));
    }

    @Test public void catalogAllowsUnknownExternalFieldsOnlyAlongsideAKnownStableIdMatch() throws Exception {
        JSONObject catalog = new JSONObject(CATALOG);
        catalog.getJSONArray("items").getJSONObject(0).remove("imdbId");
        assertNotNull(match(catalog.toString(), identified("别名", "2019", "剧情片", "movie", 0, "tt8613070", "30257175")));
        assertNotNull(match(catalog.toString(), identified("别名", "", "剧情片", "movie", 531428, "tt8613070", "")));
        assertNull(match(catalog.toString(), identified("燃烧女子的肖像", "2019", "剧情片", "movie", 0, "tt8613070", "")));
        assertNull(match(catalog.toString(), identified("别名", "2019", "剧情片", "movie", 531428, "tt8613070", "1234567")));
    }

    @Test public void explicitAndInferredTypesCannotContradictEachOther() {
        assertNull(match(CATALOG, identified("燃烧女子的肖像", "2019", "国产剧", "movie", 531428, "", "")));
        assertNull(match(CATALOG, item("燃烧女子的肖像", "2019", "电视剧")));
        assertNotNull(match(CATALOG, item("燃烧女子的肖像", "2019", "未知分类")));
        assertEquals("movie", ArtworkRepository.mediaType("", "科幻片"));
        assertEquals("movie", ArtworkRepository.mediaType("", "动画电影"));
        assertEquals("tv", ArtworkRepository.mediaType("", "欧美剧"));
    }

    @Test public void suppliedWrongStableIdsNeverFallBackToMatchingTitle() {
        assertNull(match(CATALOG, identified("燃烧女子的肖像", "2019", "剧情片", "movie", 123, "", "")));
        assertNull(match(CATALOG, identified("燃烧女子的肖像", "2019", "剧情片", "movie", 531428, "tt1234567", "")));
        // Source-local numeric IDs are not TMDB IDs.
        TvRepository.VodItem sourceId = new TvRepository.VodItem(SOURCE, "531428", "未识别片名", "https://poster.example/a.jpg", "剧情片", "", "");
        assertNull(match(CATALOG, sourceId));
    }

    @Test public void ambiguousCatalogTitlesAreRejected() throws Exception {
        JSONObject root = new JSONObject(CATALOG);
        JSONObject other = new JSONObject(root.getJSONArray("items").getJSONObject(0).toString()).put("tmdbId", 77);
        root.getJSONArray("items").put(other);
        assertNull(match(root.toString(), item("燃烧女子的肖像", "2019", "剧情片")));
    }

    @Test public void backdropRejectsBadPathsDimensionsAndRatios() {
        for (String path : new String[]{"https://evil.example/a.jpg", "//evil.example/a.jpg", "/../a.jpg", "/abc.jpg?x=1", "/AbCdEfGhIj/evil.jpg", "/AbCdEfGhIj.jpg#x"}) {
            assertNull(Backdrop.create("movie", 1, path, 3840, 2160));
        }
        assertNull(Backdrop.create("movie", 1, PATH, 640, 360));
        assertNull(Backdrop.create("movie", 1, PATH, 1920, 500));
        assertNull(Backdrop.create("movie", 1, PATH, 1920, 1920));
        assertNull(Backdrop.create("tv", 1, PATH, Integer.MAX_VALUE, 1080));
        assertNull(Backdrop.create("person", 1, PATH, 1920, 1080));
        assertNull(Backdrop.create("movie", 0, PATH, 1920, 1080));
        assertNotNull(Backdrop.create("movie", 1, PATH, 1920, 1080));
    }

    @Test public void catalogSkipsMalformedEntriesAndUnknownSchema() throws Exception {
        JSONObject root = new JSONObject(CATALOG);
        root.getJSONArray("items").getJSONObject(0).put("width", -1);
        assertTrue(ArtworkRepository.parseCatalog(root.toString()).isEmpty());
        root.put("version", 2);
        assertTrue(ArtworkRepository.parseCatalog(root.toString()).isEmpty());
        assertTrue(ArtworkRepository.parseCatalog("<html>not an API</html>").isEmpty());
    }

    @Test public void apiMatchesOriginalOrTranslatedTitleWithStrictReleaseYear() throws Exception {
        ArtworkRepository.Query query = ArtworkRepository.Query.from(item("燃烧女子的肖像", "2019", "剧情片"));
        JSONObject exact = movie(42, "燃烧女子的肖像", "2019-09-18");
        assertNotNull(ArtworkRepository.selectCandidate(results(exact), query));
        assertNull(ArtworkRepository.selectCandidate(results(movie(42, "燃烧女子的肖像", "2020-01-01")), query));
        assertNull(ArtworkRepository.selectCandidate(results(movie(42, "燃烧女子的肖像 2", "2019-09-18")), query));
        exact.put("title", "Portrait").put("original_title", "燃烧女子的肖像");
        assertNotNull(ArtworkRepository.selectCandidate(results(exact), query));
    }

    @Test public void multiSearchRejectsWrongTypePeopleAndAmbiguity() throws Exception {
        ArtworkRepository.Query movie = ArtworkRepository.Query.from(item("同名作品", "2019", "剧情片"));
        JSONObject series = new JSONObject().put("id", 2).put("media_type", "tv").put("name", "同名作品").put("first_air_date", "2019-01-01");
        assertNull(ArtworkRepository.selectCandidate(results(series), movie));
        assertNull(ArtworkRepository.selectCandidate(results(movie(1, "同名作品", "2019-01-01"), movie(2, "同名作品", "2019-03-01")), movie));
        ArtworkRepository.Query unknown = ArtworkRepository.Query.from(item("同名作品", "2019", ""));
        assertNull(ArtworkRepository.selectCandidate(results(movie(1, "同名作品", "2019-01-01").put("media_type", "movie"), series), unknown));
        assertNull(ArtworkRepository.selectCandidate(results(new JSONObject().put("id", 2).put("media_type", "person").put("name", "同名作品")), unknown));
        assertNull(ArtworkRepository.selectCandidate(results(movie(1, "同名作品", "2019-01-01")).put("total_pages", 2), movie));
    }

    @Test public void seriesSearchRequiresFirstAirDateAndSeriesNames() throws Exception {
        ArtworkRepository.Query query = ArtworkRepository.Query.from(item("测试剧集", "2019", "国产剧"));
        JSONObject series = new JSONObject().put("id", 2).put("name", "译名").put("original_name", "测试剧集").put("first_air_date", "2019-01-01");
        assertNotNull(ArtworkRepository.selectCandidate(results(series), query));
        series.put("first_air_date", "2020-01-01").put("release_date", "2019-01-01");
        assertNull(ArtworkRepository.selectCandidate(results(series), query));
    }

    @Test public void imagesPreferTextlessAndSufficientResolution() throws Exception {
        ArtworkRepository.Candidate movie = new ArtworkRepository.Candidate("movie", 1);
        JSONObject response = new JSONObject().put("backdrops", new JSONArray()
                .put(image("/TranslatedAbCdEfGhIjKlMn.jpg", 3840, 2160, "zh"))
                .put(image(PATH, 1920, 1080, JSONObject.NULL))
                .put(image("/TextlessAbCdEfGhIjKlMn.jpg", 3840, 2160, JSONObject.NULL)));
        assertEquals(PATH, ArtworkRepository.selectBackdrop(response, movie, 1920).path);
        assertEquals(3840, ArtworkRepository.selectBackdrop(response, movie, 3840).width);
        response.getJSONArray("backdrops").remove(2);
        assertEquals(PATH, ArtworkRepository.selectBackdrop(response, movie, 3840).path);
    }

    @Test public void imagesIgnoreSpoofedRatioAndUnsafeOrSmallCandidates() throws Exception {
        JSONObject response = new JSONObject().put("backdrops", new JSONArray()
                .put(image("/../malicious.jpg", 3840, 2160, JSONObject.NULL))
                .put(image(PATH, 1920, 400, JSONObject.NULL).put("aspect_ratio", 1.777))
                .put(image(PATH, 800, 450, JSONObject.NULL))
                .put(image(PATH, 1920, 1080, "fr")));
        assertNull(ArtworkRepository.selectBackdrop(response, new ArtworkRepository.Candidate("movie", 1), 1920));
    }

    @Test public void noCredentialUsesVerifiedCatalogAndNeverCallsApi() {
        MemoryStore store = new MemoryStore();
        AtomicInteger calls = new AtomicInteger();
        ArtworkRepository repo = repo(CATALOG, store, (endpoint, credential, deadline) -> { calls.incrementAndGet(); throw new IOException(); });
        List<Backdrop> result = new ArrayList<>();
        repo.request(item("燃烧女子的肖像", "2019", "剧情片"), 3840, result::add);
        repo.request(item("未知作品", "2019", "剧情片"), 3840, result::add);
        assertNotNull(result.get(0));
        assertNull(result.get(1));
        assertEquals(0, calls.get());
        store.enabled = false;
        repo.request(item("燃烧女子的肖像", "2019", "剧情片"), 3840, result::add);
        assertNull(result.get(2));
    }

    @Test public void apiFailureCachesTenMinutesAndCredentialChangesBypassThatFailure() {
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key-A";
        MutableClock clock = new MutableClock();
        AtomicInteger calls = new AtomicInteger();
        ArtworkRepository repo = new ArtworkRepository("{}", store, (endpoint, credential, deadline) -> { calls.incrementAndGet(); throw new IOException(); }, clock, Runnable::run, Runnable::run);
        TvRepository.VodItem item = item("未知作品", "2019", "剧情片");
        repo.request(item, 1920, ignored -> { });
        repo.request(item, 1920, ignored -> { });
        assertEquals(1, calls.get());
        repo.saveSettings(true, "fixture-key-B", false);
        repo.request(item, 1920, ignored -> { });
        assertEquals(2, calls.get());
        clock.now += ArtworkRepository.FAILURE_MS + 1;
        repo.request(item, 1920, ignored -> { });
        assertEquals(3, calls.get());
        assertFalse(store.cache.contains("fixture-key"));
    }

    @Test public void apiChecksImdbIdentityAndStillSearchesTitlesWithUnlistedDoubanIds() {
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key";
        AtomicInteger images = new AtomicInteger();
        ArtworkRepository repo = repo("{}", store, (endpoint, credential, deadline) -> {
            try {
                if (endpoint.startsWith("/search/")) return results(movie(42, "未知作品", "2019-01-01"));
                if (endpoint.contains("/external_ids")) return new JSONObject().put("imdb_id", "tt1234567");
                images.incrementAndGet();
                return new JSONObject().put("backdrops", new JSONArray().put(image(PATH, 3840, 2160, JSONObject.NULL)));
            } catch (Exception error) { throw new IOException(error); }
        });
        List<Backdrop> matches = new ArrayList<>();
        repo.request(identified("未知作品", "2019", "剧情片", "movie", 0, "tt1234567", ""), 1920, matches::add);
        repo.request(identified("未知作品", "2019", "剧情片", "movie", 0, "tt7654321", ""), 1920, matches::add);
        repo.request(identified("未知作品", "2019", "剧情片", "movie", 0, "", "1234567"), 1920, matches::add);
        assertNotNull(matches.get(0)); assertNull(matches.get(1)); assertNotNull(matches.get(2));
        assertEquals(2, images.get());
    }

    @Test public void knownStableIdentityConflictDoesNotAttemptApiTitleFallback() {
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key";
        AtomicInteger calls = new AtomicInteger();
        ArtworkRepository repo = repo(CATALOG, store, (e, c, d) -> { calls.incrementAndGet(); throw new IOException(); });
        repo.request(identified("燃烧女子的肖像", "2020", "剧情片", "movie", 531428, "", ""), 1920, image -> assertNull(image));
        repo.request(identified("燃烧女子的肖像", "2019", "剧情片", "movie", 531428, "tt1234567", ""), 1920, image -> assertNull(image));
        assertEquals(0, calls.get());
    }

    @Test public void successfulApiMetadataPersistsFor24HoursWithoutCredentialLeak() throws Exception {
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key";
        MutableClock clock = new MutableClock(); AtomicInteger calls = new AtomicInteger();
        ArtworkRepository.Transport api = (endpoint, credential, deadline) -> {
            calls.incrementAndGet();
            try { return endpoint.startsWith("/search/") ? results(movie(42, "未知作品", "2019-01-01"))
                    : new JSONObject().put("backdrops", new JSONArray().put(image(PATH, 3840, 2160, JSONObject.NULL))); }
            catch (Exception error) { throw new IOException(error); }
        };
        TvRepository.VodItem item = item("未知作品", "2019", "剧情片");
        List<Backdrop> results = new ArrayList<>();
        ArtworkRepository first = new ArtworkRepository("{}", store, api, clock, Runnable::run, Runnable::run);
        first.request(item, 3840, results::add);
        assertEquals(2, calls.get()); assertNotNull(results.get(0));
        ArtworkRepository restored = new ArtworkRepository("{}", store, api, clock, Runnable::run, Runnable::run);
        restored.request(item, 3840, results::add);
        assertEquals(2, calls.get()); assertNotNull(results.get(1));
        clock.now += ArtworkRepository.SUCCESS_MS + 1;
        restored.request(item, 3840, results::add);
        assertEquals(4, calls.get());
        assertFalse(store.cache.contains(store.credential));
    }

    @Test public void concurrentQueriesDeduplicateAndCancelledOrClosedCallbacksDoNotRun() {
        MemoryStore store = new MemoryStore(); QueueExecutor executor = new QueueExecutor();
        ArtworkRepository repo = new ArtworkRepository(CATALOG, store, (e, c, d) -> { throw new IOException(); }, new MutableClock(), executor, Runnable::run);
        AtomicInteger delivered = new AtomicInteger();
        TvRepository.VodItem item = item("燃烧女子的肖像", "2019", "剧情片");
        ArtworkRepository.Ticket first = repo.request(item, 3840, image -> delivered.incrementAndGet());
        repo.request(item, 3840, image -> delivered.incrementAndGet());
        assertEquals(1, executor.queue.size());
        first.cancel(); executor.run();
        assertEquals(1, delivered.get());
        repo.request(item("另一个", "2019", "剧情片"), 3840, image -> delivered.incrementAndGet());
        repo.close(); executor.run();
        assertEquals(1, delivered.get());
    }

    @Test public void imageFailurePlanReturnsTheCurrentFilmsCoverOnlyOnce() {
        ImageFallback fallback = new ImageFallback("https://image.tmdb.org/t/p/original" + PATH, "https://poster.example/current.jpg");
        assertTrue(fallback.initial().startsWith("https://image.tmdb.org/"));
        assertEquals("https://poster.example/current.jpg", fallback.onFailure());
        assertEquals("", fallback.onFailure());
        assertEquals("https://poster.example/current.jpg", new ImageFallback("bad://invalid", "https://poster.example/current.jpg").initial());
        assertEquals("", new ImageFallback("https://poster.example/current.jpg", "https://poster.example/current.jpg").onFailure());
    }

    @Test public void failedLookupPreservesOldDetailsCoverAndPlayableEpisodes() {
        TvRepository.VodItem item = item("旧历史中的作品", "", "剧情片");
        TvRepository.VideoDetails detail = new TvRepository.VideoDetails(item, "旧简介", Collections.singletonList(new TvRepository.Episode("正片", "https://video.example/a.m3u8")));
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key";
        ArtworkRepository repo = repo("{}", store, (e, c, d) -> { fail("Missing year must never search"); return null; });
        repo.request(item, 3840, image -> detail.backdrop = image);
        assertNull(detail.backdrop);
        assertEquals("https://poster.example/current.jpg", detail.item.cover);
        assertEquals("https://video.example/a.m3u8", detail.episodes.get(0).url);
    }

    @Test public void oldHistoryWithoutArtworkMetadataRemainsReadableAndStableIdsRoundTrip() throws Exception {
        JSONObject old = new JSONObject().put("sourceName", "历史来源").put("sourceUrl", SOURCE.url)
                .put("id", "531428").put("title", "燃烧女子的肖像").put("cover", "https://poster.example/old.jpg");
        TvRepository.VodItem item = TvRepository.VodItem.fromHistory(old);
        assertEquals("https://poster.example/old.jpg", item.cover);
        assertEquals(0, item.tmdbId); assertEquals("", item.year);
        assertFalse(ArtworkRepository.Query.from(item).valid);
        TvRepository.VodItem complete = identified("燃烧女子的肖像", "2019", "剧情片", "movie", 531428, "tt8613070", "30257175");
        TvRepository.VodItem restored = TvRepository.VodItem.fromHistory(complete.toHistory());
        assertEquals(531428, restored.tmdbId); assertEquals("tt8613070", restored.imdbId);
        assertEquals("30257175", restored.doubanId); assertEquals(complete.cover, restored.cover);
    }

    @Test public void sourceParserRetainsDedicatedIdsWithoutPromotingSourceId() throws Exception {
        JSONObject row = new JSONObject().put("vod_id", 123).put("vod_name", "燃烧女子的肖像").put("tmdb_id", 531428)
                .put("vod_imdb", "tt8613070").put("vod_douban_id", "30257175").put("media_type", "movie").put("vod_year", "2019");
        TvRepository.VodItem parsed = TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", new JSONArray().put(row)).toString()).get(0);
        assertEquals("123", parsed.id); assertEquals(531428, parsed.tmdbId);
        assertEquals("tt8613070", parsed.imdbId); assertEquals("30257175", parsed.doubanId);
    }

    @Test public void decodePlansPreserve1080pAnd4kWithinActualDisplayAndPixelBudget() {
        ImageDecodePolicy hd = ImageDecodePolicy.backdrop(1920, 512L * 1024 * 1024, false);
        ImageDecodePolicy uhd = ImageDecodePolicy.backdrop(3840, 512L * 1024 * 1024, false);
        assertEquals(1920, hd.plan(3840, 2160).width);
        assertEquals(3840, uhd.plan(3840, 2160).width);
        assertEquals(3840, uhd.plan(4096, 2160).width);
        for (int[] size : new int[][]{{7680, 4320}, {50000, 50000}, {1280, 720}, {10000, 1000}}) {
            ImageDecodePolicy.Plan plan = uhd.plan(size[0], size[1]);
            assertTrue(plan.width <= 3840); assertTrue(plan.height <= 3840);
            assertTrue((long) plan.width * plan.height <= ImageDecodePolicy.UHD_PIXELS);
        }
        assertNull(uhd.plan(Integer.MAX_VALUE, Integer.MAX_VALUE));
        assertEquals(480, ImageDecodePolicy.poster().plan(3840, 5760).width);
        assertEquals(720, ImageDecodePolicy.poster().plan(3840, 5760).height);
    }

    @Test public void lowMemoryDevicesDegradeAndNeverDecodeFull4k() {
        ImageDecodePolicy low = ImageDecodePolicy.backdrop(3840, 96L * 1024 * 1024, true);
        assertTrue(low.lowMemory);
        ImageDecodePolicy.Plan plan = low.plan(3840, 2160);
        assertEquals(1280, plan.width); assertEquals(720, plan.height);
        assertTrue((long) plan.width * plan.height <= 1280 * 720);
    }

    @Test public void apiAddressPinsTheOfficialHostAndNeverPutsJwtInQuery() throws Exception {
        String endpoint = "/search/movie?query=fixture&language=zh-CN";
        assertEquals("https://api.themoviedb.org/3" + endpoint + "&api_key=fixture-key", ArtworkRepository.apiUrl(endpoint, "fixture-key"));
        assertEquals("https://api.themoviedb.org/3" + endpoint, ArtworkRepository.apiUrl(endpoint, "fixture.jwt.signature"));
        for (String invalid : new String[]{"https://evil.example/search/movie?q=a", "//evil.example/?q=a", "/configuration?x=1", "/movie/1?x=1"}) {
            try { ArtworkRepository.apiUrl(invalid, "fixture-key"); fail("Must reject a non-allowlisted endpoint"); }
            catch (IOException expected) { }
        }
    }

    @Test public void credentialsDistinguishJwtAndKeyAndBlankSettingsRetainLocally() {
        assertTrue(ArtworkRepository.bearer("fixture.jwt.signature"));
        assertFalse(ArtworkRepository.bearer("fixture-key"));
        assertEquals("fixture.jwt.signature", ArtworkRepository.cleanCredential(" Bearer fixture.jwt.signature "));
        assertEquals("", ArtworkRepository.cleanCredential("key\nwith-control"));
        MemoryStore store = new MemoryStore(); store.credential = "fixture-key";
        ArtworkRepository repo = repo("{}", store, (e, c, d) -> { throw new IOException(); });
        repo.saveSettings(false, "", false); assertEquals("fixture-key", store.credential); assertFalse(store.enabled);
        repo.saveSettings(true, "", true); assertEquals("", store.credential); assertTrue(store.enabled);
    }

    private static ArtworkRepository repo(String catalog, MemoryStore store, ArtworkRepository.Transport transport) {
        return new ArtworkRepository(catalog, store, transport, new MutableClock(), Runnable::run, Runnable::run);
    }
    private static TvRepository.VodItem item(String title, String year, String type) {
        return new TvRepository.VodItem(SOURCE, "local-123", title, "https://poster.example/current.jpg", type, year, "");
    }
    private static TvRepository.VodItem identified(String title, String year, String type, String kind, int tmdb, String imdb, String douban) {
        return new TvRepository.VodItem(SOURCE, "local-123", title, "https://poster.example/current.jpg", type, year, "", kind, tmdb, imdb, douban);
    }
    private static Backdrop match(String catalog, TvRepository.VodItem item) {
        return ArtworkRepository.matchCatalog(ArtworkRepository.parseCatalog(catalog), ArtworkRepository.Query.from(item));
    }
    private static JSONObject movie(int id, String title, String date) throws Exception {
        return new JSONObject().put("id", id).put("title", title).put("original_title", "Original").put("release_date", date);
    }
    private static JSONObject results(JSONObject... items) throws Exception {
        JSONArray rows = new JSONArray(); for (JSONObject item : items) rows.put(item);
        return new JSONObject().put("total_pages", 1).put("results", rows);
    }
    private static JSONObject image(String path, int width, int height, Object language) throws Exception {
        return new JSONObject().put("file_path", path).put("width", width).put("height", height).put("iso_639_1", language);
    }
    private static final class MemoryStore implements ArtworkRepository.Store {
        boolean enabled = true; String credential = "", cache = "";
        public boolean enabled() { return enabled; }
        public String credential() { return credential; }
        public void settings(boolean enabled, String credential) { this.enabled = enabled; this.credential = credential; }
        public String cache() { return cache; }
        public void cache(String json) { cache = json; }
    }
    private static final class MutableClock implements ArtworkRepository.Clock {
        long now = 1_000_000;
        public long now() { return now; }
    }
    private static final class QueueExecutor implements Executor {
        final ArrayDeque<Runnable> queue = new ArrayDeque<>();
        public void execute(Runnable command) { queue.add(command); }
        void run() { while (!queue.isEmpty()) queue.remove().run(); }
    }
}
