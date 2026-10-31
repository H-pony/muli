package org.kongwotv.tv;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Locale;

/** Pure rules shared by browsing, source handoff and playback persistence. */
final class PlaybackState {
    private PlaybackState() {}

    static String contentKey(TvRepository.VodItem item) {
        return digest("vod-item|" + item.source.url + "\n" + item.id);
    }

    static String discoveryKey(TvRepository.VodItem item) {
        return normalize(item.title) + "\n" + item.year + "\n" + mediaKind(item);
    }

    static String browseCategory(TvRepository.VodItem item) {
        String type = item.type;
        if (type.contains("综艺")) return "综艺";
        if (type.contains("动漫") || type.contains("动画")) return "动漫";
        if (type.contains("纪录") || type.contains("记录")) return "纪录片";
        if (type.contains("片") || type.contains("电影") || item.mediaType.equals("movie")) return "电影";
        if (type.contains("剧") || type.contains("连续") || item.mediaType.equals("tv")) return "剧集";
        return "电影";
    }

    static int selectedIndex(List<String> urls, String savedUrl, int savedIndex) {
        int byUrl = urls.indexOf(savedUrl);
        if (byUrl >= 0) return byUrl;
        return savedIndex >= 0 && savedIndex < urls.size() ? savedIndex : 0;
    }

    static long savedPosition(long previous, long sample, long duration, boolean ready, boolean ended) {
        if (!ready && !ended) return Math.max(0L, previous);
        if (ended || (duration > 0 && sample >= duration - 1_500L)) return 0L;
        return Math.max(0L, sample);
    }

    static boolean sameContent(TvRepository.VodItem first, TvRepository.VodItem second) {
        if (first == null || second == null) return false;
        if (!first.year.isEmpty() && !second.year.isEmpty() && !first.year.equals(second.year)) return false;
        String firstKind = mediaKind(first), secondKind = mediaKind(second);
        if (!firstKind.isEmpty() && !secondKind.isEmpty() && !firstKind.equals(secondKind)) return false;
        boolean matchedId = false;
        if (first.tmdbId > 0 && second.tmdbId > 0) {
            if (first.tmdbId != second.tmdbId) return false;
            matchedId = true;
        }
        if (!first.imdbId.isEmpty() && !second.imdbId.isEmpty()) {
            if (!first.imdbId.equals(second.imdbId)) return false;
            matchedId = true;
        }
        if (!first.doubanId.isEmpty() && !second.doubanId.isEmpty()) {
            if (!first.doubanId.equals(second.doubanId)) return false;
            matchedId = true;
        }
        if (matchedId) return true;
        if (contentKey(first).equals(contentKey(second))) return true;
        // A title alone cannot distinguish remakes. Unknown years require manual selection.
        return !first.year.isEmpty() && first.year.equals(second.year)
                && normalize(first.title).equals(normalize(second.title));
    }

    static int matchingEpisode(List<TvRepository.Episode> episodes, String previousName, int previousCount) {
        String key = episodeKey(previousName);
        int matched = -1;
        for (int i = 0; i < episodes.size(); i++) {
            if (!key.isEmpty() && key.equals(episodeKey(episodes.get(i).name))) {
                if (matched >= 0) return -1;
                matched = i;
            }
        }
        if (matched >= 0) return matched;
        return previousCount == 1 && episodes.size() == 1 ? 0 : -1;
    }

    static String episodeKey(String value) {
        String normalized = normalize(value);
        if (normalized.matches("(?:第|ep)?0*[0-9]+(?:集|话|期|回)?")) {
            String digits = normalized.replaceAll("[^0-9]", "").replaceFirst("^0+(?!$)", "");
            return "episode:" + digits;
        }
        return normalized;
    }

    private static String mediaKind(TvRepository.VodItem item) {
        if (item.mediaType.equals("movie") || item.mediaType.equals("tv")) return item.mediaType;
        if (item.type.contains("片") || item.type.contains("电影")) return "movie";
        if (item.type.contains("剧") || item.type.contains("连续") || item.type.contains("综艺")) return "tv";
        return "";
    }

    static String normalize(String value) {
        return value == null ? "" : value.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }

    static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
