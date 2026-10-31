package org.kongwotv.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.*;

public class TvFeaturedCatalogTest {
    private static final String SOURCE_URL = "https://360zy.com/api.php/seaxml/vod";
    private static final TvRepository.Source SOURCE = new TvRepository.Source("三六资源", SOURCE_URL);

    @Test public void bundledSelectionsAreRealSourceReferencesWithSharedArtworkIdentities() throws Exception {
        String sharedPath = System.getProperty("kongwotv.artwork.catalog");
        assertNotNull(sharedPath);
        Path catalogPath = Paths.get(sharedPath).toAbsolutePath();
        Path root = catalogPath.getParent().getParent();
        String manifest = read(root.resolve("android-tv/app/src/tv/assets/home-featured.json"));
        List<TvRepository.VodItem> items = TvFeaturedCatalog.parse(manifest, Collections.singletonList(SOURCE));
        assertEquals(3, items.size());
        List<ArtworkRepository.CatalogItem> artwork = ArtworkRepository.parseCatalog(read(catalogPath));
        List<String> expectedIds = Arrays.asList("60387", "60328", "71142");
        List<String> expectedTitles = Arrays.asList("星际穿越", "盗梦空间", "流浪地球2");
        for (int index = 0; index < items.size(); index++) {
            TvRepository.VodItem item = items.get(index);
            assertSame(SOURCE, item.source);
            assertEquals(expectedIds.get(index), item.id);
            assertEquals(expectedTitles.get(index), item.title);
            assertEquals("movie", item.mediaType);
            assertEquals("正片", item.remarks);
            assertTrue(item.cover.startsWith("https://www.imgzy360.com:7788/upload/vod/"));
            Backdrop image = ArtworkRepository.matchCatalog(artwork, ArtworkRepository.Query.from(item));
            assertNotNull(item.title, image);
            assertEquals(item.tmdbId, image.tmdbId);
            assertTrue(image.width >= 1920);
        }
    }

    @Test public void onlyAnExactCurrentlyConfiguredSourceIsEligible() throws Exception {
        String json = manifest(entry("60387", "星际穿越", "2014"));
        assertTrue(TvFeaturedCatalog.parse(json, Collections.emptyList()).isEmpty());
        assertTrue(TvFeaturedCatalog.parse(json, Collections.singletonList(new TvRepository.Source("different", SOURCE_URL + "/"))).isEmpty());
        TvRepository.Source renamed = new TvRepository.Source("用户来源名称", SOURCE_URL);
        assertSame(renamed, TvFeaturedCatalog.parse(json, Collections.singletonList(renamed)).get(0).source);
        assertTrue(TvFeaturedCatalog.parse(json, null).isEmpty());
    }

    @Test public void repeatedSourceIdsKeepTheFirstVerifiedEntry() throws Exception {
        List<TvRepository.VodItem> parsed = parse(manifest(entry("60387", "星际穿越", "2014"),
                entry("60387", "不应覆盖首项", "2014"), entry("60328", "盗梦空间", "2010")));
        assertEquals(2, parsed.size());
        assertEquals("星际穿越", parsed.get(0).title);
        assertEquals("盗梦空间", parsed.get(1).title);
    }

    @Test public void invalidCatalogsAndMalformedRequiredFieldsAreRejected() throws Exception {
        for (String json : new String[]{null, "", "<html>error</html>", "[]", "{}", "{\"items\":[] } trailing"})
            assertTrue(TvFeaturedCatalog.parse(json, Collections.singletonList(SOURCE)).isEmpty());
        assertTrue(parse(manifest(entry("", "星际穿越", "2014"), entry("60387", "...", "2014"),
                entry("60387", "星际穿越", "2014-2015"), entry("60387", "星际穿越", ""),
                entry("60387", "星际穿越", "2014").put("sourceId", new JSONObject()),
                entry("60387", "星际穿越", "2014").put("type", "电视剧"))).isEmpty());
    }

    @Test(expected = UnsupportedOperationException.class) public void parsedSelectionsAreImmutable() throws Exception {
        parse(manifest(entry("60387", "星际穿越", "2014"))).clear();
    }

    @Test public void matchingNormalizesTitlesButAlwaysRequiresTheSameReleaseYear() {
        TvRepository.VodItem expected = item("Inception", "2010", "movie", "科幻片", 27205, "tt1375666", "3541415");
        assertTrue(TvFeaturedCatalog.matches(expected, item(" ＩＮＣＥＰＴＩＯＮ ", "2010", "", "科幻片", 0, "", "")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("Inception 解说", "2010", "movie", "科幻片", 27205, "tt1375666", "3541415")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("Inception", "2011", "movie", "科幻片", 27205, "tt1375666", "3541415")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("Inception", "", "movie", "科幻片", 27205, "tt1375666", "3541415")));
    }

    @Test public void matchingRejectsEveryKnownStableIdentityConflict() {
        TvRepository.VodItem expected = item("盗梦空间", "2010", "movie", "科幻片", 27205, "tt1375666", "3541415");
        assertFalse(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "movie", "科幻片", 157336, "tt1375666", "3541415")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "movie", "科幻片", 27205, "tt0816692", "3541415")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "movie", "科幻片", 27205, "tt1375666", "1889243")));
        assertTrue(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "", "科幻片", 0, "", "")));
    }

    @Test public void matchingRejectsSeriesKindsAndContradictoryTypeMetadata() {
        TvRepository.VodItem expected = item("盗梦空间", "2010", "movie", "科幻片", 27205, "", "");
        assertFalse(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "tv", "电视剧", 27205, "", "")));
        assertFalse(TvFeaturedCatalog.matches(expected, item("盗梦空间", "2010", "movie", "韩剧", 27205, "", "")));
        assertFalse(TvFeaturedCatalog.matches(expected, null));
        assertFalse(TvFeaturedCatalog.matches(null, expected));
    }

    @Test public void matchingAlsoRequiresTheSameSourceLocalReference() {
        TvRepository.VodItem expected = item("盗梦空间", "2010", "movie", "科幻片", 27205, "", "");
        assertFalse(TvFeaturedCatalog.matches(expected, new TvRepository.VodItem(SOURCE, "other", "盗梦空间", "", "科幻片", "2010", "正片")));
        assertFalse(TvFeaturedCatalog.matches(expected, new TvRepository.VodItem(new TvRepository.Source("other", "https://other.example/vod"),
                "60328", "盗梦空间", "", "科幻片", "2010", "正片")));
    }

    private static JSONObject entry(String id, String title, String year) throws Exception {
        return new JSONObject().put("sourceUrl", SOURCE_URL).put("sourceId", id).put("title", title)
                .put("year", year).put("cover", "https://www.imgzy360.com:7788/upload/vod/fixture.jpg")
                .put("type", "科幻片").put("remarks", "正片");
    }

    private static String manifest(JSONObject... entries) throws Exception {
        JSONArray rows = new JSONArray();
        for (JSONObject entry : entries) rows.put(entry);
        return new JSONObject().put("version", 1).put("items", rows).toString();
    }

    private static List<TvRepository.VodItem> parse(String json) { return TvFeaturedCatalog.parse(json, Collections.singletonList(SOURCE)); }
    private static String read(Path path) throws Exception { return new String(Files.readAllBytes(path), StandardCharsets.UTF_8); }
    private static TvRepository.VodItem item(String title, String year, String media, String type, int tmdb, String imdb, String douban) {
        return new TvRepository.VodItem(SOURCE, "60328", title, "", type, year, "正片", media, tmdb, imdb, douban);
    }
}
