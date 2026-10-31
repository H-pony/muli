package org.kongwotv.tv;

import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class PlaybackStateTest {
    private static TvRepository.VodItem item(String source, String id, String title, String year, String type) {
        return new TvRepository.VodItem(new TvRepository.Source("来源", source), id, title, "", type, year, "");
    }
    private static TvRepository.Episode episode(String name) { return new TvRepository.Episode(name, "https://example.test/" + name); }

    @Test public void sameTitleNeverSharesSelectionAcrossSourcesOrIds() {
        TvRepository.VodItem first = item("https://a.test", "1", "同名电影", "2020", "电影");
        assertNotEquals(PlaybackState.contentKey(first), PlaybackState.contentKey(item("https://a.test", "2", "同名电影", "2024", "电影")));
        assertNotEquals(PlaybackState.contentKey(first), PlaybackState.contentKey(item("https://b.test", "1", "同名电影", "2020", "电影")));
    }

    @Test public void metadataRenameDoesNotLoseScopedSelection() {
        assertEquals(PlaybackState.contentKey(item("https://a.test", "1", "旧片名", "2020", "电影")),
                PlaybackState.contentKey(item("https://a.test", "1", "新片名", "2020", "剧情片")));
    }

    @Test public void reorderedEpisodesResumeTheActualSavedUrl() {
        assertEquals(2, PlaybackState.selectedIndex(Arrays.asList("a", "b", "c"), "c", 0));
    }

    @Test public void missingSavedUrlUsesOnlyValidScopedIndex() {
        assertEquals(1, PlaybackState.selectedIndex(Arrays.asList("a", "b"), "gone", 1));
        assertEquals(0, PlaybackState.selectedIndex(Arrays.asList("a", "b"), "gone", 8));
    }

    @Test public void failedLoadingPreservesResumeInsteadOfReplacingItWithZero() {
        assertEquals(600_000L, PlaybackState.savedPosition(600_000L, 0L, -1L, false, false));
        assertEquals(600_000L, PlaybackState.savedPosition(600_000L, 0L, 3_600_000L, false, false));
    }

    @Test public void seekingBackToZeroAfterReadyIsPersisted() {
        assertEquals(0L, PlaybackState.savedPosition(600_000L, 0L, 3_600_000L, true, false));
    }

    @Test public void finishedEpisodeClearsResumeButOrdinaryProgressIsPreserved() {
        assertEquals(0L, PlaybackState.savedPosition(600_000L, 900_000L, 900_000L, true, true));
        assertEquals(0L, PlaybackState.savedPosition(600_000L, 899_000L, 900_000L, true, false));
        assertEquals(300_000L, PlaybackState.savedPosition(600_000L, 300_000L, 900_000L, true, false));
    }

    @Test public void sourceHandoffRequiresMatchingYearAndTitle() {
        TvRepository.VodItem first = item("https://a.test", "1", "同名电影", "2020", "剧情片");
        assertTrue(PlaybackState.sameContent(first, item("https://b.test", "2", "同名 电影", "2020", "电影")));
        assertFalse(PlaybackState.sameContent(first, item("https://b.test", "2", "同名电影", "2024", "电影")));
        assertFalse(PlaybackState.sameContent(first, item("https://b.test", "2", "同名电影", "", "电影")));
        assertFalse(PlaybackState.sameContent(first, item("https://b.test", "2", "另一部影片", "2020", "电影")));
    }

    @Test public void movieAndSeriesCannotTransferBySameTitleAndYear() {
        assertFalse(PlaybackState.sameContent(item("https://a.test", "1", "同名", "2020", "电影"),
                item("https://b.test", "2", "同名", "2020", "国产剧")));
    }

    @Test public void matchingStableIdCanTransferWithoutYearButConflictCannot() {
        TvRepository.Source source = new TvRepository.Source("来源", "https://a.test");
        TvRepository.VodItem first = new TvRepository.VodItem(source, "1", "片名", "", "电影", "", "", "movie", 123, "tt1234567", "");
        TvRepository.VodItem same = new TvRepository.VodItem(source, "2", "译名", "", "电影", "", "", "movie", 123, "tt1234567", "");
        TvRepository.VodItem conflict = new TvRepository.VodItem(source, "3", "片名", "", "电影", "", "", "movie", 123, "tt1234568", "");
        assertTrue(PlaybackState.sameContent(first, same));
        assertFalse(PlaybackState.sameContent(first, conflict));
    }

    @Test public void sourceHandoffMapsNamesInsteadOfEpisodeArrayOffsets() {
        assertEquals(2, PlaybackState.matchingEpisode(Arrays.asList(episode("预告"), episode("第01集"), episode("第02集")), "EP02", 2));
        assertEquals(0, PlaybackState.matchingEpisode(Arrays.asList(episode("第02集"), episode("第01集")), "第2集", 2));
    }

    @Test public void ambiguousOrUnknownEpisodeDoesNotGuessByIndex() {
        assertEquals(-1, PlaybackState.matchingEpisode(Arrays.asList(episode("正片"), episode("正片")), "正片", 2));
        assertEquals(-1, PlaybackState.matchingEpisode(Arrays.asList(episode("上"), episode("下")), "第2集", 2));
    }

    @Test public void singleMovieCanTransferAcrossQualityLabels() {
        assertEquals(0, PlaybackState.matchingEpisode(Collections.singletonList(episode("1080P")), "HD", 1));
        assertEquals(-1, PlaybackState.matchingEpisode(Collections.singletonList(episode("HD")), "第4集", 4));
    }

    @Test public void discoveryKeepsRemakesAndMovieSeriesSeparate() {
        TvRepository.VodItem first = item("https://a.test", "1", "同名", "2020", "电影");
        assertNotEquals(PlaybackState.discoveryKey(first), PlaybackState.discoveryKey(item("https://a.test", "2", "同名", "2024", "电影")));
        assertNotEquals(PlaybackState.discoveryKey(first), PlaybackState.discoveryKey(item("https://a.test", "3", "同名", "2020", "电视剧")));
        assertEquals(PlaybackState.discoveryKey(first), PlaybackState.discoveryKey(item("https://b.test", "4", " 同 名 ", "2020", "剧情片")));
    }

    @Test public void dramaAndComedyFilmsStayInMovieCategory() {
        assertEquals("电影", PlaybackState.browseCategory(item("https://a.test", "1", "电影", "2020", "剧情片")));
        assertEquals("电影", PlaybackState.browseCategory(item("https://a.test", "2", "电影", "2020", "喜剧片")));
        assertEquals("剧集", PlaybackState.browseCategory(item("https://a.test", "3", "剧集", "2020", "国产剧")));
        assertEquals("综艺", PlaybackState.browseCategory(item("https://a.test", "4", "节目", "2020", "综艺")));
        assertEquals("纪录片", PlaybackState.browseCategory(item("https://a.test", "5", "纪录", "2020", "纪录片")));
    }
}
