package org.kongwotv.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

public class TvRepositoryTest {
    private static final TvRepository.Source SOURCE = new TvRepository.Source("测试资源", "https://api.example/api.php/provide/vod");

    @Test public void m3uReadsBomQuotedCommasAndMetadata() {
        String text = "\uFEFF#EXTM3U\r\n#EXTINF:-1 group-title=\"中央,高清\" tvg-logo=\"https://img.example/logo.png\",央视综合,高清\r\n#EXTVLCOPT:http-user-agent=ignored\r\nhttps://stream.example/live.m3u8\r\n";
        List<TvRepository.Channel> channels = TvRepository.parseM3u(text);
        assertEquals(1, channels.size());
        assertEquals("央视综合,高清", channels.get(0).name);
        assertEquals("中央,高清", channels.get(0).group);
        assertEquals("https://img.example/logo.png", channels.get(0).logo);
        assertEquals("https://stream.example/live.m3u8", channels.get(0).url);
    }
    @Test public void m3uSupportsSingleQuotesTvgNameExtgrpAndCarriageReturns() {
        String text = "#EXTM3U\r#extinf:-1 tvg-name='卫视频道' tvg-logo='//img.example/a.png',\r#EXTGRP:地方卫视\rhttps://stream.example/satellite.m3u8\r";
        TvRepository.Channel channel = TvRepository.parseM3u(text).get(0);
        assertEquals("卫视频道", channel.name);
        assertEquals("地方卫视", channel.group);
        assertEquals("https://img.example/a.png", channel.logo);
    }
    @Test public void m3uDeduplicatesEquivalentUrlsAndKeepsFirstChineseName() {
        String text = "#EXTINF:-1,央视一套\nHTTP://EXAMPLE.com:80/live.m3u8\n#EXTINF:-1,English duplicate\nhttp://example.com/live.m3u8\n";
        List<TvRepository.Channel> channels = TvRepository.parseM3u(text);
        assertEquals(1, channels.size());
        assertEquals("央视一套", channels.get(0).name);
    }
    @Test public void m3uInvalidEntryDoesNotLeakMetadataToNextUrl() {
        List<TvRepository.Channel> channels = TvRepository.parseM3u("#EXTINF:-1 group-title=\"错误分组\",错误名称\njavascript:alert(1)\nhttps://stream.example/ok.m3u8\n#EXTINF:-1,无效地址\nftp://example.com/a\n");
        assertEquals(1, channels.size());
        assertEquals("ok.m3u8", channels.get(0).name);
        assertEquals("", channels.get(0).group);
        assertEquals("", channels.get(0).logo);
    }
    @Test public void m3uEmptyAndUnsupportedContentProduceNoChannels() {
        assertTrue(TvRepository.parseM3u(null).isEmpty());
        assertTrue(TvRepository.parseM3u("\uFEFF#EXTM3U\n#EXTINF:-1,未完成").isEmpty());
        assertTrue(TvRepository.parseM3u("file:///tmp/video\nhttps://\nrtsp://example.com/live").isEmpty());
    }
    @Test public void playbackPrefersDirectHlsInsteadOfM3u8InsideParserQuery() {
        List<TvRepository.Episode> episodes = TvRepository.parsePlayUrls("网页$https://player.example/?url=https://cdn.example/fake.m3u8$$$第一集$https://cdn.example/1.m3u8?token=a&amp;b=c#第二集$https://cdn.example/2.m3u8");
        assertEquals(2, episodes.size());
        assertEquals("第一集", episodes.get(0).name);
        assertEquals("https://cdn.example/1.m3u8?token=a&b=c", episodes.get(0).url);
        assertEquals("第二集", episodes.get(1).name);
    }
    @Test public void playbackKeepsGroupsSeparateAndUsesFirstHlsGroup() {
        List<TvRepository.Episode> episodes = TvRepository.parsePlayUrls("正片$https://cdn.example/movie.mp4$$$上集$https://cdn.example/a.M3U8?sign=1#下集$https://cdn.example/b.m3u8$$$备用$https://backup.example/c.m3u8");
        assertEquals(2, episodes.size());
        assertEquals("上集", episodes.get(0).name);
        assertEquals("下集", episodes.get(1).name);
    }
    @Test public void playbackRejectsExecutableSchemesDeduplicatesAndRetainsDollarInUrl() {
        List<TvRepository.Episode> episodes = TvRepository.parsePlayUrls("错误$javascript:alert(1)#本地$file:///tmp/a#第一集$https://cdn.example/a.m3u8?key=a$b#重复$https://cdn.example/a.m3u8?key=a$b");
        assertEquals(1, episodes.size());
        assertEquals("第一集", episodes.get(0).name);
        assertEquals("https://cdn.example/a.m3u8?key=a$b", episodes.get(0).url);
    }
    @Test public void playbackFallsBackToHttpVideoAndSupportsBareUrl() {
        List<TvRepository.Episode> episodes = TvRepository.parsePlayUrls("坏组$magnet:invalid$$$https://cdn.example/video.mp4?key=a$b$$$备用$https://b.example/other.mp4");
        assertEquals(1, episodes.size());
        assertEquals("第1集", episodes.get(0).name);
        assertEquals("https://cdn.example/video.mp4?key=a$b", episodes.get(0).url);
        assertTrue(TvRepository.parsePlayUrls(null).isEmpty());
        assertTrue(TvRepository.parsePlayUrls("无效$rtsp://example.com/live").isEmpty());
    }
    @Test public void apiQueryReplacesOldFiltersAndEncodesKeyword() {
        assertEquals("https://api.example/vod?token=a%2Bb&ac=videolist&wd=%E6%B5%81%E6%B5%AA+%26+%2B", TvRepository.buildApiUrl("https://api.example/vod?token=a%2Bb&ac=list&ids=3&pg=7#ignored", "wd", "流浪 & +"));
    }
    @Test public void apiQueryHandlesEncodedKeysAndEmptyExistingQuery() {
        assertEquals("https://api.example/vod?token=raw%2Fvalue&ac=videolist&ids=12%2C13", TvRepository.buildApiUrl("https://api.example/vod?%61%63=list&wd=old&token=raw%2Fvalue&ids=1", "ids", "12,13"));
        assertEquals("https://api.example/vod?ac=videolist&wd=abc", TvRepository.buildApiUrl("https://api.example/vod?", "wd", "abc"));
    }
    @Test public void discoveryExplicitlyRequestsFirstPageAndRemovesSearchFilter() {
        assertEquals("https://api.example/vod?token=1&ac=videolist&pg=1", TvRepository.buildApiUrl("https://api.example/vod?token=1&wd=old&pg=9&ids=8", "pg", "1"));
    }
    @Test(expected = IllegalArgumentException.class) public void apiQueryRejectsNonHttpSource() {
        TvRepository.buildApiUrl("javascript:alert(1)", "wd", "测试");
    }
    @Test(expected = IllegalArgumentException.class) public void apiQueryRejectsUnsupportedActionParameter() {
        TvRepository.buildApiUrl(SOURCE.url, "action", "eval");
    }
    @Test public void responseSupportsListDataAndNestedDataWhilePreservingSource() throws Exception {
        JSONObject row = new JSONObject().put("vod_id", 123).put("vod_name", "<b>流浪地球</b>&nbsp;2").put("vod_pic", "/covers/a.jpg").put("type_name", "科幻片").put("vod_year", 2023).put("vod_remarks", "HD");
        JSONArray rows = new JSONArray().put(row);
        String[] variants = { new JSONObject().put("list", rows).toString(), new JSONObject().put("data", rows).toString(), new JSONObject().put("data", new JSONObject().put("list", rows)).toString(), rows.toString(), new JSONObject().put("data", row).toString() };
        for (String json : variants) {
            List<TvRepository.VodItem> parsed = TvRepository.parseSearchResponse(SOURCE, json);
            assertEquals(1, parsed.size());
            TvRepository.VodItem item = parsed.get(0);
            assertSame(SOURCE, item.source);
            assertEquals("123", item.id);
            assertEquals("流浪地球 2", item.title);
            assertEquals("https://api.example/covers/a.jpg", item.cover);
            assertEquals("2023", item.year);
            assertEquals("HD", item.remarks);
        }
    }
    @Test public void responseFiltersObviousAdultContentWithoutBlockingOrdinaryTitles() throws Exception {
        JSONArray rows = new JSONArray().put(vod("1", "正常影片", "伦理片")).put(vod("2", "<b>成人</b>影片合集", "其他")).put(vod("3", "激情燃烧的岁月", "国产剧")).put(vod("4", "成人初学者", "喜剧片")).put(vod("5", "xXx：极限特工", "动作片"));
        List<TvRepository.VodItem> parsed = TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", rows).toString());
        assertEquals(3, parsed.size());
        assertEquals("3", parsed.get(0).id);
        assertEquals("4", parsed.get(1).id);
        assertEquals("5", parsed.get(2).id);
    }
    @Test public void searchFiltersMovieCommentaryTitlesButNotTypesOrOtherCommentaryWords() throws Exception {
        JSONArray rows = new JSONArray()
                .put(vod("film", "星际穿越", "科幻片").put("vod_content", "包含解说角色的一部普通电影"))
                .put(vod("suffix", "星际穿越【电影解说】", "科幻片"))
                .put(vod("prefix", "电影解说：星际穿越", "其他"))
                .put(vod("middle", "星际电影解说穿越", "其他"))
                .put(vod("category-only", "星际穿越", "电影解说"))
                .put(vod("other-label", "星际穿越【影视解说】", "影视解说"))
                .put(vod("ordinary", "解说员的故事", "剧情片"));
        List<TvRepository.VodItem> parsed = TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", rows).toString());
        List<String> ids = new ArrayList<>();
        for (TvRepository.VodItem item : parsed) ids.add(item.id);
        assertEquals(Arrays.asList("film", "category-only", "other-label", "ordinary"), ids);
    }
    @Test public void commentaryOnlySearchStaysEmptyAfterFinalVisibilityFilter() throws Exception {
        JSONArray rows = new JSONArray().put(vod("1", "星际穿越【电影解说】", "其他"))
                .put(vod("2", "电影解说：星际穿越", "其他"));
        List<TvRepository.VodItem> parsed = TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", rows).toString());
        assertTrue(parsed.isEmpty());
        assertTrue(TvRepository.filterSearchResults(parsed).isEmpty());
    }
    @Test public void actorKeywordSearchKeepsFilmsAndRemovesAdjacentCommentaryAcrossSources() throws Exception {
        // An actor query can legitimately return film names that do not contain the keyword.
        String keyword = "周星驰";
        JSONArray rows = new JSONArray()
                .put(vod("football", "功夫足球", "喜剧片").put("vod_actor", keyword))
                .put(vod("football-commentary", "功夫足球电影解说", "其他").put("vod_actor", keyword))
                .put(vod("shaolin-commentary", "少林足球【电影解说】", "其他").put("vod_actor", keyword))
                .put(vod("kungfu", "功夫", "动作片").put("vod_actor", keyword))
                .put(vod("kungfu-commentary", "功夫【电影解说】", "其他").put("vod_actor", keyword));
        TvRepository.Source second = new TvRepository.Source("另一资源", "https://b.example/vod");
        JSONArray alternatives = new JSONArray()
                .put(vod("shaolin", "少林足球", "喜剧片").put("vod_actor", keyword))
                .put(vod("football-commentary", "功夫足球电影解说", "其他").put("vod_actor", keyword));
        List<TvRepository.VodItem> visible = TvRepository.filterSearchResults(TvRepository.mergeDiscovery(Arrays.asList(
                TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", rows).toString()),
                TvRepository.parseSearchResponse(second, new JSONObject().put("list", alternatives).toString()))));
        List<String> titles = new ArrayList<>();
        for (TvRepository.VodItem item : visible) titles.add(item.title);
        assertEquals(Arrays.asList("功夫足球", "少林足球", "功夫"), titles);
    }
    @Test public void oldCachedCommentaryCannotReturnThroughDiscoveryMergeOrDisplay() {
        TvRepository.Source second = new TvRepository.Source("另一资源", "https://b.example/vod");
        TvRepository.VodItem commentary = item(SOURCE, "old", "星际穿越【电影解说】");
        TvRepository.VodItem film = item(SOURCE, "film", "星际穿越");
        TvRepository.VodItem alternative = item(second, "film", "星际穿越");
        List<TvRepository.VodItem> cache = Arrays.asList(commentary, film);
        assertEquals(Collections.singletonList(film), TvRepository.filterSearchResults(cache));
        List<TvRepository.VodItem> merged = TvRepository.mergeDiscovery(Arrays.asList(cache, Arrays.asList(
                item(second, "old", "电影解说：星际穿越"), alternative)));
        assertEquals(Arrays.asList(film, alternative), merged);
    }
    @Test public void responseEmptyJsonResultsAreNormal() throws Exception {
        for (String json : Arrays.asList("{}", "[]", "{\"list\":[]}", "{\"data\":[]}", "{\"data\":{\"list\":[]}}", "\uFEFF{\"code\":1,\"total\":0,\"list\":[]}")) assertTrue(TvRepository.parseSearchResponse(SOURCE, json).isEmpty());
    }
    @Test public void responseSkipsMalformedRowsDeduplicatesIdsAndCapsEachSourceAt60() throws Exception {
        JSONArray rows = new JSONArray().put(JSONObject.NULL).put("invalid").put(new JSONObject().put("vod_id", "missing-title")).put(vod("0", "影片0", "剧情片")).put(vod("0", "重复ID", "剧情片"));
        for (int i = 1; i < 90; i++) rows.put(vod(String.valueOf(i), "影片" + i, "剧情片"));
        List<TvRepository.VodItem> parsed = TvRepository.parseSearchResponse(SOURCE, new JSONObject().put("list", rows).toString());
        assertEquals(60, parsed.size());
        assertEquals("影片0", parsed.get(0).title);
        assertEquals("59", parsed.get(59).id);
    }
    @Test(expected = IOException.class) public void responseRejectsHtmlInsteadOfTreatingItAsEmptyResults() throws Exception {
        TvRepository.parseSearchResponse(SOURCE, "<html>登录页面</html>");
    }
    @Test(expected = IOException.class) public void responseRejectsTrailingGarbage() throws Exception {
        TvRepository.parseSearchResponse(SOURCE, "{\"list\":[]}<script>bad</script>");
    }
    @Test public void discoveryDeduplicatesTitlesWithinSourceAndKeepsAlternativeSources() {
        TvRepository.Source second = new TvRepository.Source("另一资源", "https://b.example/vod");
        List<TvRepository.VodItem> merged = TvRepository.mergeDiscovery(Arrays.asList(Arrays.asList(item(SOURCE, "1", "同名片"), item(SOURCE, "2", " 同 名片 ")), Collections.singletonList(item(second, "3", "同名片"))));
        assertEquals(2, merged.size());
        assertSame(SOURCE, merged.get(0).source);
        assertSame(second, merged.get(1).source);
    }
    @Test public void discoveryCaps72AndPreservesEachSourceRecentOrder() {
        List<List<TvRepository.VodItem>> batches = new ArrayList<>();
        for (int source = 0; source < 3; source++) {
            TvRepository.Source provider = new TvRepository.Source("资源" + source, "https://s" + source + ".example/vod");
            List<TvRepository.VodItem> batch = new ArrayList<>();
            for (int i = 0; i < 60; i++) batch.add(item(provider, String.valueOf(i), "影片" + i));
            batches.add(batch);
        }
        List<TvRepository.VodItem> merged = TvRepository.mergeDiscovery(batches);
        assertEquals(72, merged.size());
        assertEquals("资源0", merged.get(0).source.name);
        assertEquals("资源1", merged.get(1).source.name);
        assertEquals("资源2", merged.get(2).source.name);
        assertEquals("0", merged.get(0).id);
        assertEquals("23", merged.get(71).id);
    }
    @Test public void detailsSelectsRequestedIdEvenWhenAnotherFilmComesFirst() throws Exception {
        JSONArray rows = new JSONArray().put(vod("wrong", "其他影片", "剧情片"))
                .put(vod("wanted", "所选影片", "剧情片").put("vod_play_url", "正片$https://cdn.example/wanted.mp4"));
        TvRepository.VideoDetails detail = TvRepository.parseDetailsResponse(item(SOURCE, "wanted", "所选影片"), new JSONObject().put("list", rows).toString());
        assertEquals("wanted", detail.item.id);
        assertEquals("https://cdn.example/wanted.mp4", detail.episodes.get(0).url);
    }
    @Test(expected = IOException.class) public void detailsRejectsUnrelatedFirstResultWhenRequestedIdIsMissing() throws Exception {
        JSONArray rows = new JSONArray().put(vod("wrong", "其他影片", "剧情片").put("vod_play_url", "正片$https://cdn.example/wrong.mp4"));
        TvRepository.parseDetailsResponse(item(SOURCE, "wanted", "所选影片"), new JSONObject().put("list", rows).toString());
    }
    @Test public void discoveryKeepsSameTitleDifferentYearWithinOneSource() {
        TvRepository.VodItem original = new TvRepository.VodItem(SOURCE, "1", "同名片", "", "剧情片", "1990", "");
        TvRepository.VodItem remake = new TvRepository.VodItem(SOURCE, "2", "同名片", "", "剧情片", "2026", "");
        assertEquals(2, TvRepository.mergeDiscovery(Collections.singletonList(Arrays.asList(original, remake))).size());
    }
    private static JSONObject vod(String id, String title, String type) throws Exception { return new JSONObject().put("vod_id", id).put("vod_name", title).put("type_name", type); }
    private static TvRepository.VodItem item(TvRepository.Source source, String id, String title) { return new TvRepository.VodItem(source, id, title, "", "剧情片", "2026", ""); }
}
