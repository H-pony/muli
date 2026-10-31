package org.kongwotv.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Optional, bounded metadata lookup. Source posters and playback never depend on this repository. */
public final class ArtworkRepository implements AutoCloseable {
    static final String API = "https://api.themoviedb.org/3";
    static final long SUCCESS_MS = TimeUnit.HOURS.toMillis(24), FAILURE_MS = TimeUnit.MINUTES.toMillis(10);
    private static final int JSON_LIMIT = 512 * 1024, CACHE_LIMIT = 96;
    private final Object lock = new Object();
    private final Store store;
    private final Transport transport;
    private final Clock clock;
    private final Executor executor, callbacks;
    private final ThreadPoolExecutor ownedExecutor;
    private final Map<String, List<Ticket>> pending = new LinkedHashMap<>();
    private final LinkedHashMap<String, CacheEntry> cache = new LinkedHashMap<>();
    private final List<CatalogItem> catalog;
    private volatile boolean closed;

    interface Clock { long now(); }
    interface Transport { JSONObject get(String endpoint, String credential, long deadline) throws IOException; }
    interface Store {
        boolean enabled();
        String credential();
        void settings(boolean enabled, String credential);
        String cache();
        void cache(String json);
    }
    public interface Callback { void complete(Backdrop backdrop); }
    public static final class Ticket {
        private volatile boolean cancelled;
        public void cancel() { cancelled = true; }
        private final Callback callback;
        Ticket(Callback callback) { this.callback = callback; }
    }

    public ArtworkRepository(Context context) {
        Context app = context.getApplicationContext();
        Context application = app == null ? context : app;
        SharedPreferences prefs = application.getSharedPreferences("kongwotv_artwork", Context.MODE_PRIVATE);
        store = new Store() {
            public boolean enabled() { return prefs.getBoolean("enabled", true); }
            public String credential() { return prefs.getString("credential", ""); }
            public void settings(boolean enabled, String credential) {
                prefs.edit().putBoolean("enabled", enabled).putString("credential", credential).apply();
            }
            public String cache() { return prefs.getString("metadata_cache_v1", ""); }
            public void cache(String json) { prefs.edit().putString("metadata_cache_v1", json).apply(); }
        };
        transport = new ApiTransport();
        clock = System::currentTimeMillis;
        ownedExecutor = new ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(24));
        executor = ownedExecutor;
        Handler main = new Handler(Looper.getMainLooper());
        callbacks = command -> main.post(command);
        String bundled = "";
        try (InputStream input = application.getAssets().open("artwork-catalog.json")) {
            bundled = new String(readLimited(input, JSON_LIMIT, Long.MAX_VALUE), StandardCharsets.UTF_8);
        } catch (IOException ignored) { }
        catalog = parseCatalog(bundled);
        restoreCache();
    }

    /** Dependency boundary used by deterministic JVM tests; no real credentials or network needed. */
    ArtworkRepository(String catalog, Store store, Transport transport, Clock clock, Executor executor, Executor callbacks) {
        this.catalog = parseCatalog(catalog);
        this.store = store;
        this.transport = transport;
        this.clock = clock;
        this.executor = executor;
        this.callbacks = callbacks;
        ownedExecutor = null;
        restoreCache();
    }

    public boolean isEnabled() { return store.enabled(); }
    public boolean hasCredential() { return !cleanCredential(store.credential()).isEmpty(); }

    /** A blank replacement preserves the stored credential; clearing is an explicit separate action. */
    public void saveSettings(boolean enabled, String replacement, boolean clear) {
        String credential = clear ? "" : cleanCredential(replacement);
        if (!clear && credential.isEmpty()) credential = cleanCredential(store.credential());
        store.settings(enabled, credential);
    }

    public Ticket request(TvRepository.VodItem item, int desiredWidth, Callback callback) {
        Ticket ticket = new Ticket(callback);
        Query query = Query.from(item);
        String credential = cleanCredential(store.credential());
        if (closed || !store.enabled() || !query.valid) {
            deliver(ticket, null);
            return ticket;
        }
        int width = Math.max(1280, Math.min(3840, desiredWidth));
        // Only a digest enters cache keys; a changed credential cannot reuse an earlier failure.
        String key = digest(query.key() + "\n" + width + "\n" + digest(credential));
        synchronized (lock) {
            if (closed) return ticket;
            CacheEntry hit = cache.get(key);
            if (hit != null && hit.expires > clock.now()) {
                deliver(ticket, hit.backdrop);
                return ticket;
            }
            List<Ticket> existing = pending.get(key);
            if (existing != null) {
                existing.add(ticket);
                return ticket;
            }
            ArrayList<Ticket> waiting = new ArrayList<>();
            waiting.add(ticket);
            pending.put(key, waiting);
        }
        try {
            executor.execute(() -> {
                Backdrop result = null;
                try {
                    result = matchCatalog(catalog, query);
                    if (result == null && !credential.isEmpty() && query.canSearch()
                            && !knownIdentityConflict(catalog, query)) result = remote(query, width, credential);
                } catch (IOException | RuntimeException ignored) {
                    // Never log request URLs, headers, response bodies or credentials.
                }
                List<Ticket> waiting;
                synchronized (lock) {
                    waiting = pending.remove(key);
                    if (closed) return;
                    cache.put(key, new CacheEntry(result, clock.now() + (result == null ? FAILURE_MS : SUCCESS_MS)));
                    trimAndSave();
                }
                if (waiting != null) for (Ticket listener : waiting) deliver(listener, result);
            });
        } catch (RuntimeException ignored) {
            List<Ticket> waiting;
            synchronized (lock) { waiting = pending.remove(key); }
            if (waiting != null) for (Ticket listener : waiting) deliver(listener, null);
        }
        return ticket;
    }

    private void deliver(Ticket ticket, Backdrop result) {
        callbacks.execute(() -> {
            if (!closed && !ticket.cancelled) ticket.callback.complete(result);
        });
    }

    private Backdrop remote(Query query, int desiredWidth, String credential) throws IOException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
        String kind = query.mediaType.isEmpty() ? "multi" : query.mediaType;
        String endpoint = "/search/" + kind + "?query=" + encode(query.title)
                + "&language=zh-CN&include_adult=false&page=1";
        if ("movie".equals(kind)) endpoint += "&year=" + query.year;
        else if ("tv".equals(kind)) endpoint += "&first_air_date_year=" + query.year;
        Candidate candidate = selectCandidate(transport.get(endpoint, credential, deadline), query);
        if (candidate == null) return null;
        if (!query.imdbId.isEmpty()) {
            JSONObject external = transport.get("/" + candidate.mediaType + "/" + candidate.id
                    + "/external_ids?language=zh-CN", credential, deadline);
            if (!query.imdbId.equals(external.optString("imdb_id"))) return null;
        }
        return selectBackdrop(transport.get("/" + candidate.mediaType + "/" + candidate.id
                + "/images?include_image_language=null,zh,en", credential, deadline), candidate, desiredWidth);
    }

    static List<CatalogItem> parseCatalog(String text) {
        ArrayList<CatalogItem> result = new ArrayList<>();
        try {
            JSONObject root = json(text);
            if (root.optInt("version") != 1) return result;
            JSONArray rows = root.optJSONArray("items");
            if (rows != null) for (int i = 0; i < Math.min(rows.length(), 1000); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null || !validYear(row.optString("year"))) continue;
                Backdrop backdrop = Backdrop.create(row.optString("mediaType"), row.optInt("tmdbId"),
                        row.optString("backdropPath"), row.optInt("width"), row.optInt("height"));
                JSONArray titles = row.optJSONArray("titles");
                ArrayList<String> names = new ArrayList<>();
                if (titles != null) for (int n = 0; n < titles.length(); n++) {
                    String name = normalizeTitle(titles.optString(n));
                    if (!name.isEmpty()) names.add(name);
                }
                if (backdrop != null && !names.isEmpty()) result.add(new CatalogItem(backdrop,
                        row.optString("year"), names, validImdb(row.optString("imdbId")), validId(row.optString("doubanId"))));
            }
        } catch (IOException | RuntimeException ignored) { }
        return Collections.unmodifiableList(result);
    }

    static Backdrop matchCatalog(List<CatalogItem> catalog, Query query) {
        if (!query.valid) return null;
        Backdrop matched = null;
        for (CatalogItem item : catalog) {
            Backdrop image = item.backdrop;
            if (!query.mediaType.isEmpty() && !query.mediaType.equals(image.mediaType)) continue;
            if (!query.year.isEmpty() && !query.year.equals(item.year)) continue;
            if (query.hasStableId()) {
                boolean matchedId = false;
                if (query.tmdbId > 0) {
                    if (query.tmdbId != image.tmdbId) continue;
                    matchedId = true;
                }
                if (!query.imdbId.isEmpty() && !item.imdbId.isEmpty()) {
                    if (!query.imdbId.equals(item.imdbId)) continue;
                    matchedId = true;
                }
                if (!query.doubanId.isEmpty() && !item.doubanId.isEmpty()) {
                    if (!query.doubanId.equals(item.doubanId)) continue;
                    matchedId = true;
                }
                if (!matchedId) continue;
            } else if (query.year.isEmpty() || !item.titles.contains(normalizeTitle(query.title))) continue;
            if (matched != null && (matched.tmdbId != image.tmdbId || !matched.mediaType.equals(image.mediaType))) return null;
            matched = image;
        }
        return matched;
    }

    private static boolean knownIdentityConflict(List<CatalogItem> catalog, Query query) {
        for (CatalogItem item : catalog) {
            Backdrop image = item.backdrop;
            boolean sameId = (query.tmdbId > 0 && query.tmdbId == image.tmdbId)
                    || (!query.imdbId.isEmpty() && query.imdbId.equals(item.imdbId))
                    || (!query.doubanId.isEmpty() && query.doubanId.equals(item.doubanId));
            if (!sameId) continue;
            if ((!query.year.isEmpty() && !query.year.equals(item.year))
                    || (!query.mediaType.isEmpty() && !query.mediaType.equals(image.mediaType))
                    || (query.tmdbId > 0 && query.tmdbId != image.tmdbId)
                    || (!query.imdbId.isEmpty() && !item.imdbId.isEmpty() && !query.imdbId.equals(item.imdbId))
                    || (!query.doubanId.isEmpty() && !item.doubanId.isEmpty() && !query.doubanId.equals(item.doubanId))) return true;
        }
        return false;
    }

    static Candidate selectCandidate(JSONObject root, Query query) {
        // Refuse incomplete search pages: a second exact candidate could be outside this bounded response.
        if (!query.canSearch() || root == null || root.optInt("total_pages", 1) > 1) return null;
        JSONArray rows = root.optJSONArray("results");
        Candidate match = null;
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || row.optBoolean("adult")) continue;
            String kind = row.optString("media_type", query.mediaType);
            if (!("movie".equals(kind) || "tv".equals(kind))
                    || (!query.mediaType.isEmpty() && !query.mediaType.equals(kind))) continue;
            boolean movie = "movie".equals(kind);
            String date = row.optString(movie ? "release_date" : "first_air_date");
            if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || !query.year.equals(date.substring(0, 4))) continue;
            String normalized = normalizeTitle(query.title);
            if (!normalized.equals(normalizeTitle(row.optString(movie ? "title" : "name")))
                    && !normalized.equals(normalizeTitle(row.optString(movie ? "original_title" : "original_name")))) continue;
            int id = row.optInt("id");
            if (id <= 0 || (query.tmdbId > 0 && query.tmdbId != id)) continue;
            if (match != null && (match.id != id || !match.mediaType.equals(kind))) return null;
            match = new Candidate(kind, id);
        }
        return match;
    }

    static Backdrop selectBackdrop(JSONObject root, Candidate candidate, int desiredWidth) {
        JSONArray rows = root == null ? null : root.optJSONArray("backdrops");
        Backdrop best = null;
        boolean bestTextless = false;
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            Backdrop image = Backdrop.create(candidate.mediaType, candidate.id, row.optString("file_path"),
                    row.optInt("width"), row.optInt("height"));
            if (image == null) continue;
            String language = row.isNull("iso_639_1") ? "" : row.optString("iso_639_1");
            if (!language.isEmpty() && !"zh".equals(language) && !"en".equals(language)) continue;
            boolean textless = row.has("iso_639_1") && row.isNull("iso_639_1");
            if (best == null || compare(image, textless, best, bestTextless, desiredWidth) > 0) {
                best = image;
                bestTextless = textless;
            }
        }
        return best;
    }

    private static int compare(Backdrop left, boolean textless, Backdrop right, boolean otherTextless, int desiredWidth) {
        if (textless != otherTextless) return textless ? 1 : -1;
        boolean hd = left.width >= 1920, otherHd = right.width >= 1920;
        if (hd != otherHd) return hd ? 1 : -1;
        int needed = Math.max(1920, Math.min(3840, desiredWidth));
        boolean enough = left.width >= needed, otherEnough = right.width >= needed;
        if (enough != otherEnough) return enough ? 1 : -1;
        // Among adequate originals prefer the smallest sufficient download; otherwise the largest available.
        return enough ? Integer.compare(right.width, left.width) : Integer.compare(left.width, right.width);
    }

    static String normalizeTitle(String title) {
        return Normalizer.normalize(safe(title), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
                .replaceAll("[\\p{P}\\p{Z}\\s]+", "");
    }

    static String mediaType(String explicit, String type) {
        String declared = safe(explicit).trim().toLowerCase(Locale.ROOT);
        if (!declared.isEmpty() && !"movie".equals(declared) && !"tv".equals(declared)) return "invalid";
        String value = safe(type).trim().toLowerCase(Locale.ROOT);
        String inferred = "";
        if (value.matches(".*(?:电视剧|剧集|连续剧|国产剧|港剧|台剧|日剧|韩剧|美剧|欧美剧|海外剧|泰剧|短剧|综艺|真人秀|动漫剧|动画剧|tv|series).*")) inferred = "tv";
        else if (value.contains("电影") || value.endsWith("片") || "movie".equals(value)) inferred = "movie";
        if (!declared.isEmpty() && !inferred.isEmpty() && !declared.equals(inferred)) return "invalid";
        return declared.isEmpty() ? inferred : declared;
    }

    static final class Query {
        final String title, year, mediaType, imdbId, doubanId;
        final int tmdbId;
        final boolean valid;
        private Query(TvRepository.VodItem item) {
            title = item.title.trim();
            year = item.year.trim();
            mediaType = mediaType(item.mediaType, item.type);
            tmdbId = item.tmdbId;
            imdbId = item.imdbId;
            doubanId = item.doubanId;
            valid = !"invalid".equals(mediaType) && (year.isEmpty() || validYear(year))
                    && (!normalizeTitle(title).isEmpty() || hasStableId())
                    && (hasStableId() || !year.isEmpty());
        }
        static Query from(TvRepository.VodItem item) {
            return new Query(item == null ? new TvRepository.VodItem(null, "", "", "", "", "", "") : item);
        }
        boolean hasStableId() { return tmdbId > 0 || !imdbId.isEmpty() || !doubanId.isEmpty(); }
        boolean canSearch() { return valid && validYear(year) && !normalizeTitle(title).isEmpty(); }
        String key() { return normalizeTitle(title) + "\n" + year + "\n" + mediaType + "\n" + tmdbId + "\n" + imdbId + "\n" + doubanId; }
    }

    static final class CatalogItem {
        final Backdrop backdrop;
        final String year, imdbId, doubanId;
        final List<String> titles;
        CatalogItem(Backdrop backdrop, String year, List<String> titles, String imdbId, String doubanId) {
            this.backdrop = backdrop; this.year = year; this.titles = titles; this.imdbId = imdbId; this.doubanId = doubanId;
        }
    }
    static final class Candidate {
        final String mediaType;
        final int id;
        Candidate(String mediaType, int id) { this.mediaType = mediaType; this.id = id; }
    }
    private static final class CacheEntry {
        final Backdrop backdrop;
        final long expires;
        CacheEntry(Backdrop backdrop, long expires) { this.backdrop = backdrop; this.expires = expires; }
    }

    private void restoreCache() {
        try {
            String text = store.cache();
            if (text == null || text.length() > JSON_LIMIT) return;
            JSONArray rows = new JSONArray(text);
            for (int i = 0; i < Math.min(rows.length(), CACHE_LIMIT); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String key = row.optString("key");
                long expiry = row.optLong("expires");
                Backdrop backdrop = Backdrop.fromJson(row.optJSONObject("backdrop"));
                if (key.matches("[0-9a-f]{64}") && expiry > clock.now()
                        && expiry <= clock.now() + (backdrop == null ? FAILURE_MS : SUCCESS_MS)) {
                    cache.put(key, new CacheEntry(backdrop, expiry));
                }
            }
        } catch (JSONException | RuntimeException ignored) { }
    }

    private void trimAndSave() {
        cache.entrySet().removeIf(entry -> entry.getValue().expires <= clock.now());
        while (cache.size() > CACHE_LIMIT) cache.remove(cache.keySet().iterator().next());
        try {
            JSONArray rows = new JSONArray();
            for (Map.Entry<String, CacheEntry> entry : cache.entrySet()) {
                CacheEntry value = entry.getValue();
                rows.put(new JSONObject().put("key", entry.getKey()).put("expires", value.expires)
                        .put("backdrop", value.backdrop == null ? JSONObject.NULL : value.backdrop.toJson()));
            }
            store.cache(rows.toString());
        } catch (JSONException | RuntimeException ignored) { }
    }

    @Override public void close() {
        synchronized (lock) {
            closed = true;
            for (List<Ticket> group : pending.values()) for (Ticket ticket : group) ticket.cancel();
            pending.clear();
        }
        if (ownedExecutor != null) ownedExecutor.shutdownNow();
        if (transport instanceof ApiTransport) ((ApiTransport) transport).close();
    }

    static String cleanCredential(String raw) {
        String credential = safe(raw).trim();
        if (credential.regionMatches(true, 0, "Bearer ", 0, 7)) credential = credential.substring(7).trim();
        return credential.length() <= 4096 && credential.matches("[A-Za-z0-9._~-]*") ? credential : "";
    }
    static boolean bearer(String credential) { return credential.contains("."); }
    static String apiUrl(String endpoint, String credential) throws IOException {
        if (!endpoint.matches("/(?:search/(?:movie|tv|multi)|(?:movie|tv)/[1-9][0-9]*/(?:images|external_ids))\\?.*")
                || cleanCredential(credential).isEmpty()) throw new IOException("Invalid metadata request");
        return API + endpoint + (bearer(credential) ? "" : "&api_key=" + encode(credential));
    }
    static String validImdb(String text) { return safe(text).matches("tt[0-9]{5,12}") ? text : ""; }
    static String validId(String text) { return safe(text).matches("[1-9][0-9]{0,11}") ? text : ""; }
    private static boolean validYear(String text) { return safe(text).matches("(?:18|19|20|21)[0-9]{2}"); }
    private static String safe(String text) { return text == null ? "" : text; }
    private static String encode(String text) {
        try { return URLEncoder.encode(text, "UTF-8"); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new AssertionError(impossible); }
    }
    private static String digest(String text) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
    private static JSONObject json(String text) throws IOException {
        try {
            JSONTokener parser = new JSONTokener(safe(text));
            Object value = parser.nextValue();
            if (!(value instanceof JSONObject) || parser.nextClean() != 0) throw new IOException("Invalid metadata response");
            return (JSONObject) value;
        } catch (JSONException error) { throw new IOException("Invalid metadata response"); }
    }
    private static byte[] readLimited(InputStream input, int limit, long deadline) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted() || System.nanoTime() >= deadline || output.size() + count > limit)
                throw new IOException("Metadata limit exceeded");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static final class ApiTransport implements Transport {
        private final List<HttpURLConnection> active = new ArrayList<>();
        private boolean closed;
        public JSONObject get(String endpoint, String credential, long deadline) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl(endpoint, credential)).openConnection();
            synchronized (active) {
                if (closed) { connection.disconnect(); throw new IOException("Closed"); }
                active.add(connection);
            }
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(timeout(deadline));
                connection.setReadTimeout(timeout(deadline));
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "Muli/2.16.12");
                if (bearer(credential)) connection.setRequestProperty("Authorization", "Bearer " + credential);
                if (connection.getResponseCode() != 200 || connection.getContentLength() > JSON_LIMIT)
                    throw new IOException("Metadata request failed");
                connection.setReadTimeout(timeout(deadline));
                try (InputStream input = connection.getInputStream()) {
                    return json(new String(readLimited(input, JSON_LIMIT, deadline), StandardCharsets.UTF_8));
                }
            } finally {
                synchronized (active) { active.remove(connection); }
                connection.disconnect();
            }
        }
        private static int timeout(long deadline) throws IOException {
            long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remaining <= 0 || Thread.currentThread().isInterrupted()) throw new IOException("Metadata timeout");
            return (int) Math.max(1, Math.min(2500, remaining));
        }
        void close() {
            synchronized (active) {
                closed = true;
                for (HttpURLConnection connection : active) connection.disconnect();
                active.clear();
            }
        }
    }
}
