package org.kongwotv.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Verified home selections are references into currently configured sources, never new sources. */
final class TvFeaturedCatalog {
    private TvFeaturedCatalog() { }

    static List<TvRepository.VodItem> parse(String json, List<TvRepository.Source> configuredSources) {
        if (json == null || configuredSources == null || configuredSources.isEmpty()) return Collections.emptyList();
        try {
            JSONTokener tokener = new JSONTokener(json);
            Object root = tokener.nextValue();
            if (!(root instanceof JSONObject) || tokener.nextClean() != 0) return Collections.emptyList();
            JSONArray rows = ((JSONObject) root).optJSONArray("items");
            if (rows == null) return Collections.emptyList();
            Map<String, TvRepository.Source> enabled = new LinkedHashMap<>();
            for (TvRepository.Source source : configuredSources) {
                if (source != null && !source.url.isEmpty() && !enabled.containsKey(source.url)) enabled.put(source.url, source);
            }
            Map<String, TvRepository.VodItem> selected = new LinkedHashMap<>();
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                TvRepository.Source source = enabled.get(row.optString("sourceUrl", ""));
                String id = scalar(row, "sourceId"), title = scalar(row, "title"), year = scalar(row, "year");
                if (source == null || !id.matches("[^\\s\\p{Cntrl}]{1,128}")
                        || ArtworkRepository.normalizeTitle(title).isEmpty() || !validYear(year)) continue;
                String type = row.optString("type", "");
                if ("invalid".equals(ArtworkRepository.mediaType("movie", type))) continue;
                String key = source.url + "\n" + id;
                if (!selected.containsKey(key)) selected.put(key, new TvRepository.VodItem(source, id, title,
                        row.optString("cover", ""), type, year, row.optString("remarks", ""), "movie",
                        row.optInt("tmdbId", 0), row.optString("imdbId", ""), row.optString("doubanId", "")));
            }
            return Collections.unmodifiableList(new ArrayList<>(selected.values()));
        } catch (Exception invalidCatalog) {
            return Collections.emptyList();
        }
    }

    /** A source-local ID or inherited artwork ID cannot excuse a changed film title or year. */
    static boolean matches(TvRepository.VodItem expected, TvRepository.VodItem actual) {
        if (expected == null || actual == null || expected.source == null || actual.source == null
                || !expected.source.url.equals(actual.source.url) || !expected.id.equals(actual.id)) return false;
        String title = ArtworkRepository.normalizeTitle(expected.title);
        String year = expected.year.trim();
        if (title.isEmpty() || !title.equals(ArtworkRepository.normalizeTitle(actual.title))
                || !validYear(year) || !year.equals(actual.year.trim())) return false;
        if (expected.tmdbId > 0 && actual.tmdbId > 0 && expected.tmdbId != actual.tmdbId) return false;
        if (!expected.imdbId.isEmpty() && !actual.imdbId.isEmpty() && !expected.imdbId.equals(actual.imdbId)) return false;
        if (!expected.doubanId.isEmpty() && !actual.doubanId.isEmpty() && !expected.doubanId.equals(actual.doubanId)) return false;
        String wantedKind = ArtworkRepository.mediaType(expected.mediaType, expected.type);
        String actualKind = ArtworkRepository.mediaType(actual.mediaType, actual.type);
        return !"invalid".equals(wantedKind) && !"invalid".equals(actualKind)
                && (wantedKind.isEmpty() || actualKind.isEmpty() || wantedKind.equals(actualKind));
    }

    private static String scalar(JSONObject row, String name) {
        Object value = row.opt(name);
        return value instanceof String || value instanceof Number ? String.valueOf(value).trim() : "";
    }

    private static boolean validYear(String year) { return year.matches("(?:18|19|20|21)[0-9]{2}"); }
}
