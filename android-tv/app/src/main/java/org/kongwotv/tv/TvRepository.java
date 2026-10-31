package org.kongwotv.tv;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.UnknownHostException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import javax.net.ssl.SSLException;

/** 同步数据仓储；网络方法由 UI 后台线程调用，远程内容只作为数据解析。 */
public class TvRepository {
    private static final String PREFS = "kongwotv_repository";
    private static final String CHANNEL_CACHE = "live_channels_v1";
    private static final long SEARCH_MS = 12_000L, REQUEST_MS = 15_000L;
    private static final int CONNECT_MS = 5_000, READ_MS = 4_000, MAX_REDIRECTS = 5;
    private static final int MAX_PER_SOURCE = 60, MAX_DISCOVER = 72;
    private static final int CONFIG_LIMIT = 256 * 1024, JSON_LIMIT = 4 * 1024 * 1024;
    private static final int M3U_LIMIT = 8 * 1024 * 1024;
    private static final AtomicInteger THREAD_ID = new AtomicInteger();
    private static final Pattern ATTRIBUTE = Pattern.compile("(?:^|\\s)([a-zA-Z0-9_-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s,]+))");
    private static final Pattern CHARSET = Pattern.compile("(?:^|;)\\s*charset\\s*=\\s*[\"']?([^;\\s\"']+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern BREAK = Pattern.compile("(?i)<br\\s*/?>|</p\\s*>");
    private static final Pattern SCRIPT = Pattern.compile("(?is)<(?:script|style)\\b[^>]*>.*?</(?:script|style)\\s*>");
    private static final Pattern ENTITY = Pattern.compile("&#(x[0-9a-fA-F]+|[0-9]+);");
    private static final Pattern ADULT_CATEGORY = Pattern.compile("伦理|情色|色情|成人|福利|里番|无码|有码|三级|18禁|(?:^|[\\s/_-])(?:porn|hentai|xxx|av|r18|adult)(?:$|[\\s/_-])", Pattern.CASE_INSENSITIVE);
    private static final Pattern ADULT_ITEM = Pattern.compile("AV片|av女优|无码|有码|色情|成人视频|成人影片|成人影视|成人动漫|成人专区|成人直播|成人写真|18禁|18\\+|三级片|里番|\\b(?:porn|hentai)\\b", Pattern.CASE_INSENSITIVE);
    private final Context context;
    private final SharedPreferences preferences;
    private volatile Configuration configuration;
    private volatile List<Channel> bundledCache;

    public TvRepository(Context context) {
        if (context == null) throw new IllegalArgumentException("应用上下文不能为空");
        Context application = context.getApplicationContext();
        this.context = application == null ? context : application;
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public List<Source> getSources() { return configuration().vodSources; }

    public List<Source> getLiveSubscriptions() { return configuration().liveSubscriptions; }

    /** The curated manifest records FLV even when the gateway URL has no extension. */
    public static boolean isBundledFlv(Context context, String url) {
        try (InputStream input = context.getAssets().open("sources.json")) {
            JSONObject formats = new JSONObject(new String(readBytes(input, CONFIG_LIMIT, null, null), StandardCharsets.UTF_8))
                    .optJSONObject("liveFormats");
            return formats != null && "flv".equals(formats.optString(url));
        } catch (IOException | JSONException error) {
            return false;
        }
    }

    public SearchResult search(String keyword) {
        String query = safe(keyword).trim();
        if (query.isEmpty()) return new SearchResult(Collections.emptyList(), Collections.singletonList("请输入搜索关键词"));
        return querySources("wd", query, false);
    }

    public SearchResult discover() { return querySources("pg", "1", true); }

    private SearchResult querySources(String parameter, String value, boolean discovery) {
        long deadline = deadlineAfter(SEARCH_MS);
        Configuration config = configuration();
        List<Source> sources = config.vodSources;
        if (sources.isEmpty()) return new SearchResult(Collections.emptyList(), Collections.singletonList(first(config.warning, "尚未配置点播源")));
        RequestScope scope = new RequestScope(deadline);
        ThreadFactory factory = task -> {
            Thread thread = new Thread(task, "Muli-source-" + THREAD_ID.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        ExecutorService executor = Executors.newFixedThreadPool(Math.min(3, sources.size()), factory);
        ExecutorCompletionService<SourceSearch> completion = new ExecutorCompletionService<>(executor);
        Map<Future<SourceSearch>, Integer> futures = new LinkedHashMap<>();
        SourceSearch[] results = new SourceSearch[sources.size()];
        boolean interrupted = false;
        try {
            for (int i = 0; i < sources.size(); i++) {
                final Source source = sources.get(i);
                Future<SourceSearch> future = completion.submit(() -> {
                    try {
                        String text = download(buildApiUrl(source.url, parameter, value), scope, JSON_LIMIT);
                        return new SourceSearch(parseSearchResponse(source, text), "");
                    } catch (IOException | RuntimeException error) {
                        return new SourceSearch(Collections.emptyList(), failureMessage(error));
                    }
                });
                futures.put(future, i);
            }
            for (int count = 0; count < sources.size(); count++) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) break;
                Future<SourceSearch> finished = completion.poll(remaining, TimeUnit.NANOSECONDS);
                if (finished == null) break;
                int index = futures.get(finished);
                try { results[index] = finished.get(); }
                catch (ExecutionException error) { results[index] = new SourceSearch(Collections.emptyList(), failureMessage(error.getCause())); }
                catch (CancellationException error) { results[index] = new SourceSearch(Collections.emptyList(), "来源请求已取消"); }
            }
        } catch (InterruptedException error) {
            interrupted = true;
            Thread.currentThread().interrupt();
        } finally {
            for (Future<SourceSearch> future : futures.keySet()) if (!future.isDone()) future.cancel(true);
            scope.cancel();
            executor.shutdownNow();
        }
        List<String> warnings = new ArrayList<>();
        if (!config.warning.isEmpty()) warnings.add(config.warning);
        List<List<VodItem>> batches = new ArrayList<>();
        for (int i = 0; i < sources.size(); i++) {
            SourceSearch result = results[i];
            if (result == null) {
                warnings.add(sources.get(i).name + "：" + (interrupted ? "来源请求已取消" : "来源请求超时（总期限 12 秒）"));
                batches.add(Collections.emptyList());
            } else {
                batches.add(result.items);
                if (!result.warning.isEmpty()) warnings.add(sources.get(i).name + "：" + result.warning);
            }
        }
        List<VodItem> items;
        if (discovery) items = mergeDiscovery(batches);
        else {
            items = new ArrayList<>();
            for (List<VodItem> batch : batches) items.addAll(batch);
            String query = normalizedTitle(value);
            Collections.sort(items, (left, right) -> Integer.compare(relevance(left.title, query), relevance(right.title, query)));
        }
        return new SearchResult(filterSearchResults(items), warnings);
    }

    public VideoDetails detail(VodItem item) throws IOException {
        if (item == null || item.source == null || item.id.trim().isEmpty()) throw new IOException("影片信息不完整，无法获取详情");
        RequestScope scope = new RequestScope(deadlineAfter(REQUEST_MS));
        try {
            return parseDetailsResponse(item, download(buildApiUrl(item.source.url, "ids", item.id), scope, JSON_LIMIT));
        } catch (IOException | RuntimeException error) {
            throw new IOException("获取影片详情失败：" + failureMessage(error), error);
        } finally { scope.cancel(); }
    }

    static VideoDetails parseDetailsResponse(VodItem item, String text) throws IOException {
        JSONArray rows = jsonRows(text);
        JSONObject selected = null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            if (item.id.equals(field(row, "vod_id", "id"))) { selected = row; break; }
        }
        if (selected == null) throw new IOException("来源未返回所选影片的详情，请重试或更换来源");
        if (isAdult(selected)) throw new IOException("该影片属于已过滤的成人内容");
        List<Episode> episodes = parsePlayUrls(field(selected, "vod_play_url", "play_url"));
        if (episodes.isEmpty()) throw new IOException("该影片暂未提供可直接播放的 HTTP(S) 地址");
        VodItem complete = new VodItem(item.source, first(field(selected, "vod_id", "id"), item.id),
                first(plainText(field(selected, "vod_name", "name", "title")), item.title),
                first(resolveHttpUrl(item.source.url, field(selected, "vod_pic", "pic", "cover")), item.cover),
                first(plainText(field(selected, "type_name", "vod_class", "type")), item.type),
                first(field(selected, "vod_year", "year"), item.year),
                first(plainText(field(selected, "vod_remarks", "remarks", "note")), item.remarks),
                first(field(selected, "media_type", "mediaType"), item.mediaType),
                positiveId(first(field(selected, "tmdb_id", "tmdbId", "vod_tmdb_id"), String.valueOf(item.tmdbId))),
                first(field(selected, "imdb_id", "imdbId", "vod_imdb"), item.imdbId),
                first(field(selected, "douban_id", "doubanId", "vod_douban_id"), item.doubanId));
        String description = plainText(field(selected, "vod_content", "vod_blurb", "description", "content"));
        return new VideoDetails(complete, first(description, "暂无简介"), episodes);
    }

    public List<Channel> bundledChannels() {
        List<Channel> cached = bundledCache;
        if (cached == null) synchronized (this) {
            cached = bundledCache;
            if (cached == null) {
                try { cached = parseM3u(readAsset("channels.m3u", M3U_LIMIT)); }
                catch (IOException error) { cached = Collections.emptyList(); }
                bundledCache = cached;
            }
        }
        return cached;
    }

    /** 始终以已验证的内置频道顺序和名称为先；刷新失败时追加成功缓存。 */
    public List<Channel> refreshChannels() {
        // Curated-only bundles must not revive stale entries from an older remote feed.
        if (configuration().liveSubscriptions.isEmpty()) return bundledChannels();
        LinkedHashMap<String, Channel> channels = new LinkedHashMap<>();
        for (Channel channel : bundledChannels()) putFirst(channels, urlKey(channel.url), channel);
        boolean refreshed = false;
        RequestScope scope = new RequestScope(deadlineAfter(REQUEST_MS));
        try {
            for (Source subscription : configuration().liveSubscriptions) {
                if (scope.expired()) break;
                try {
                    List<Channel> downloaded = parseM3u(download(subscription.url, scope, M3U_LIMIT));
                    if (!downloaded.isEmpty()) refreshed = true;
                    for (Channel channel : downloaded) {
                        Channel grouped = channel.group.isEmpty() ? new Channel(channel.name, channel.url, subscription.name, channel.logo) : channel;
                        putFirst(channels, urlKey(grouped.url), grouped);
                    }
                } catch (IOException | RuntimeException ignored) { }
            }
        } finally { scope.cancel(); }
        if (refreshed) {
            List<Channel> result = immutable(new ArrayList<>(channels.values()));
            cacheChannels(result);
            return result;
        }
        for (Channel channel : cachedChannels()) putFirst(channels, urlKey(channel.url), channel);
        return immutable(new ArrayList<>(channels.values()));
    }

    public static List<Channel> parseM3u(String text) {
        LinkedHashMap<String, Channel> channels = new LinkedHashMap<>();
        String name = "", group = "", logo = "";
        for (String original : safe(text).split("\\r\\n|\\n|\\r")) {
            String line = stripBom(original.trim());
            if (line.isEmpty()) continue;
            if (line.regionMatches(true, 0, "#EXTINF:", 0, 8)) {
                int comma = metadataComma(line);
                String attributes = comma < 0 ? line.substring(8) : line.substring(8, comma);
                Map<String, String> values = new LinkedHashMap<>();
                Matcher matcher = ATTRIBUTE.matcher(attributes);
                while (matcher.find()) values.put(matcher.group(1).toLowerCase(Locale.ROOT), decodeEntities(first(matcher.group(2), matcher.group(3), matcher.group(4))));
                name = first(plainText(comma < 0 ? "" : line.substring(comma + 1)), plainText(values.get("tvg-name")));
                group = plainText(values.get("group-title"));
                logo = normalizedHttpUrl(values.get("tvg-logo"));
            } else if (line.regionMatches(true, 0, "#EXTGRP:", 0, 8)) {
                if (group.isEmpty()) group = plainText(line.substring(8));
            } else if (!line.startsWith("#")) {
                String url = normalizedHttpUrl(decodeEntities(line));
                if (!url.isEmpty()) putFirst(channels, urlKey(url), new Channel(first(name, nameFromUrl(url)), url, group, logo));
                name = ""; group = ""; logo = "";
            }
        }
        return immutable(new ArrayList<>(channels.values()));
    }

    public static List<Episode> parsePlayUrls(String playUrls) {
        List<Episode> fallback = Collections.emptyList();
        for (String group : safe(playUrls).split("\\$\\$\\$", -1)) {
            LinkedHashMap<String, Episode> episodes = new LinkedHashMap<>();
            boolean hasHls = false;
            int ordinal = 0;
            for (String raw : group.split("#", -1)) {
                String entry = raw.trim();
                if (entry.isEmpty()) continue;
                ordinal++;
                String name = "", url;
                if (isHttpUrl(entry)) url = normalizedHttpUrl(decodeEntities(entry));
                else {
                    int separator = entry.indexOf('$');
                    if (separator < 0) continue;
                    name = plainText(entry.substring(0, separator));
                    url = normalizedHttpUrl(decodeEntities(entry.substring(separator + 1)));
                }
                if (url.isEmpty()) continue;
                putFirst(episodes, urlKey(url), new Episode(first(name, "第" + ordinal + "集"), url));
                hasHls |= isHlsUrl(url);
            }
            List<Episode> parsed = immutable(new ArrayList<>(episodes.values()));
            if (hasHls) return parsed;
            if (fallback.isEmpty() && !parsed.isEmpty()) fallback = parsed;
        }
        return fallback;
    }

    public static String buildApiUrl(String baseUrl, String parameter, String value) {
        String base = safe(baseUrl).trim();
        if (!isHttpUrl(base)) throw new IllegalArgumentException("点播接口必须是有效的 HTTP(S) 地址");
        if (!"wd".equals(parameter) && !"ids".equals(parameter) && !"pg".equals(parameter)) throw new IllegalArgumentException("点播查询参数必须为 wd、ids 或 pg");
        int fragment = base.indexOf('#');
        if (fragment >= 0) base = base.substring(0, fragment);
        int question = base.indexOf('?');
        String path = question < 0 ? base : base.substring(0, question);
        List<String> query = new ArrayList<>();
        if (question >= 0 && question + 1 < base.length()) for (String part : base.substring(question + 1).split("&")) {
            if (part.isEmpty()) continue;
            int equals = part.indexOf('=');
            String key = equals < 0 ? part : part.substring(0, equals);
            try { key = URLDecoder.decode(key, "UTF-8"); }
            catch (IllegalArgumentException | java.io.UnsupportedEncodingException ignored) { }
            if (!"ac".equalsIgnoreCase(key) && !"wd".equalsIgnoreCase(key) && !"ids".equalsIgnoreCase(key) && !"pg".equalsIgnoreCase(key)) query.add(part);
        }
        query.add("ac=videolist");
        try { query.add(parameter + "=" + URLEncoder.encode(safe(value), "UTF-8")); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new AssertionError(impossible); }
        return path + "?" + join(query, "&");
    }

    static List<VodItem> parseSearchResponse(Source source, String text) throws IOException {
        JSONArray rows = jsonRows(text);
        LinkedHashMap<String, VodItem> items = new LinkedHashMap<>();
        for (int i = 0; i < rows.length() && items.size() < MAX_PER_SOURCE; i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || isAdult(row)) continue;
            String id = field(row, "vod_id", "id"), title = plainText(field(row, "vod_name", "name", "title"));
            if (id.isEmpty() || title.isEmpty() || title.contains("电影解说")) continue;
            VodItem item = new VodItem(source, id, title, resolveHttpUrl(source.url, field(row, "vod_pic", "pic", "cover")), plainText(field(row, "type_name", "vod_class", "type")), field(row, "vod_year", "year"), plainText(field(row, "vod_remarks", "remarks", "note")),
                    field(row, "media_type", "mediaType"), positiveId(field(row, "tmdb_id", "tmdbId", "vod_tmdb_id")),
                    field(row, "imdb_id", "imdbId", "vod_imdb"), field(row, "douban_id", "doubanId", "vod_douban_id"));
            putFirst(items, id, item);
        }
        return immutable(new ArrayList<>(items.values()));
    }

    /** Match the common search contract, including results restored from an older discovery cache. */
    public static List<VodItem> filterSearchResults(List<VodItem> items) {
        if (items == null || items.isEmpty()) return Collections.emptyList();
        List<VodItem> visible = new ArrayList<>();
        for (VodItem item : items) {
            if (item != null && !item.title.contains("电影解说")) visible.add(item);
        }
        return immutable(visible);
    }

    static List<VodItem> mergeDiscovery(List<List<VodItem>> batches) {
        List<VodItem> merged = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (int row = 0; row < MAX_PER_SOURCE && merged.size() < MAX_DISCOVER; row++) {
            for (List<VodItem> batch : batches) {
                if (row >= batch.size()) continue;
                VodItem item = batch.get(row);
                if (item == null || item.title.contains("电影解说")) continue;
                String key = urlKey(item.source.url) + "\n" + PlaybackState.discoveryKey(item);
                if (seen.add(key)) {
                    merged.add(item);
                    if (merged.size() == MAX_DISCOVER) break;
                }
            }
        }
        return merged;
    }

    private Configuration configuration() {
        Configuration value = configuration;
        if (value == null) synchronized (this) {
            value = configuration;
            if (value == null) {
                try {
                    JSONObject root = new JSONObject(stripBom(readAsset("sources.json", CONFIG_LIMIT)));
                    value = new Configuration(configuredSources(root.optJSONArray("vodSources")), configuredSources(root.optJSONArray("liveSubscriptions")), "");
                } catch (IOException | JSONException error) {
                    value = new Configuration(Collections.emptyList(), Collections.emptyList(), "无法读取内置来源配置，请重新安装应用");
                }
                configuration = value;
            }
        }
        return value;
    }

    private static List<Source> configuredSources(JSONArray rows) {
        LinkedHashMap<String, Source> sources = new LinkedHashMap<>();
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String url = normalizedHttpUrl(field(row, "url"));
            if (!url.isEmpty()) putFirst(sources, urlKey(url), new Source(first(field(row, "name"), nameFromUrl(url)), url));
        }
        return immutable(new ArrayList<>(sources.values()));
    }

    private String readAsset(String name, int limit) throws IOException {
        try (InputStream input = context.getAssets().open(name)) { return new String(readBytes(input, limit, null, null), StandardCharsets.UTF_8); }
    }

    private static String download(String address, RequestScope scope, int limit) throws IOException {
        String current = normalizedHttpUrl(address);
        if (current.isEmpty()) throw new IOException("网络地址必须使用 HTTP 或 HTTPS");
        for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
            scope.check();
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            scope.register(connection);
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(scope.timeout(CONNECT_MS));
                connection.setReadTimeout(scope.timeout(READ_MS));
                connection.setRequestMethod("GET");
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Muli/2.16.12");
                connection.setRequestProperty("Accept", "application/json, application/x-mpegURL, text/plain, */*");
                connection.setRequestProperty("Accept-Encoding", "gzip");
                int status = connection.getResponseCode();
                scope.check();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    if (redirect == MAX_REDIRECTS) throw new IOException("服务器重定向次数过多");
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new IOException("服务器重定向缺少目标地址");
                    current = normalizedHttpUrl(new URL(new URL(current), location.trim()).toString());
                    if (current.isEmpty()) throw new IOException("服务器重定向到了非 HTTP(S) 地址");
                    continue;
                }
                if (status < 200 || status >= 300) throw new IOException("服务器返回 HTTP " + status);
                try (InputStream raw = connection.getInputStream(); InputStream input = "gzip".equalsIgnoreCase(connection.getContentEncoding()) ? new GZIPInputStream(raw) : raw) {
                    byte[] bytes = readBytes(input, limit, scope, connection);
                    scope.check();
                    return stripBom(new String(bytes, responseCharset(connection.getContentType())));
                }
            } finally { scope.unregister(connection); connection.disconnect(); }
        }
        throw new IOException("服务器重定向次数过多");
    }

    private static byte[] readBytes(InputStream input, int limit, RequestScope scope, HttpURLConnection connection) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(8192, limit));
        byte[] buffer = new byte[8192];
        int total = 0;
        while (true) {
            if (scope != null) { scope.check(); if (connection != null) connection.setReadTimeout(scope.timeout(READ_MS)); }
            int count = input.read(buffer);
            if (count < 0) break;
            total += count;
            if (total > limit) throw new IOException("响应内容过大，已停止读取");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static Charset responseCharset(String contentType) {
        if (contentType != null) {
            Matcher matcher = CHARSET.matcher(contentType);
            if (matcher.find()) try { return Charset.forName(matcher.group(1)); }
            catch (IllegalArgumentException ignored) { }
        }
        return StandardCharsets.UTF_8;
    }

    private static JSONArray jsonRows(String text) throws IOException {
        try {
            JSONTokener tokener = new JSONTokener(stripBom(safe(text).trim()));
            Object root = tokener.nextValue();
            if (tokener.nextClean() != 0) throw new IOException("接口返回的 JSON 含有多余内容");
            if (!(root instanceof JSONObject) && !(root instanceof JSONArray)) throw new IOException("接口返回的 JSON 结构不受支持");
            return rowsFrom(root, 0);
        } catch (JSONException error) { throw new IOException("接口返回的不是有效 JSON", error); }
    }

    private static JSONArray rowsFrom(Object node, int depth) {
        if (node instanceof JSONArray) return (JSONArray) node;
        if (!(node instanceof JSONObject) || depth > 4) return new JSONArray();
        JSONObject object = (JSONObject) node;
        Object list = object.opt("list"), data = object.opt("data");
        if (list instanceof JSONArray || list instanceof JSONObject) return rowsFrom(list, depth + 1);
        if (data instanceof JSONArray || data instanceof JSONObject) return rowsFrom(data, depth + 1);
        if (object.has("vod_id") || (object.has("id") && object.has("vod_name"))) return new JSONArray().put(object);
        return new JSONArray();
    }

    private static boolean isAdult(JSONObject row) {
        String categories = field(row, "type_name") + " " + field(row, "type_name_1") + " " + field(row, "type_name_2") + " " + field(row, "vod_class") + " " + field(row, "type");
        return ADULT_CATEGORY.matcher(plainText(categories)).find() || ADULT_ITEM.matcher(plainText(field(row, "vod_name", "name", "title") + " " + field(row, "vod_remarks", "remarks"))).find();
    }

    private static int positiveId(String text) {
        try { return text.matches("[1-9][0-9]{0,8}") ? Integer.parseInt(text) : 0; }
        catch (NumberFormatException ignored) { return 0; }
    }

    private static String field(JSONObject object, String... names) {
        for (String name : names) {
            Object value = object.opt(name);
            if (value != null && value != JSONObject.NULL && !(value instanceof JSONArray) && !(value instanceof JSONObject)) {
                String text = String.valueOf(value).trim();
                if (!text.isEmpty()) return text;
            }
        }
        return "";
    }

    private List<Channel> cachedChannels() {
        try {
            String text = preferences.getString(CHANNEL_CACHE, "");
            if (text == null || text.isEmpty() || text.length() > M3U_LIMIT) return Collections.emptyList();
            JSONArray rows = new JSONArray(text);
            LinkedHashMap<String, Channel> channels = new LinkedHashMap<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String url = normalizedHttpUrl(field(row, "url"));
                if (!url.isEmpty()) putFirst(channels, urlKey(url), new Channel(first(field(row, "name"), nameFromUrl(url)), url, field(row, "group"), normalizedHttpUrl(field(row, "logo"))));
            }
            return immutable(new ArrayList<>(channels.values()));
        } catch (JSONException | RuntimeException ignored) { return Collections.emptyList(); }
    }

    private void cacheChannels(List<Channel> channels) {
        try {
            JSONArray rows = new JSONArray();
            for (Channel channel : channels) rows.put(new JSONObject().put("name", channel.name).put("url", channel.url).put("group", channel.group).put("logo", channel.logo));
            String text = rows.toString();
            if (text.length() <= M3U_LIMIT) preferences.edit().putString(CHANNEL_CACHE, text).putLong("live_channels_updated_at", System.currentTimeMillis()).apply();
        } catch (JSONException | RuntimeException ignored) { }
    }

    private static int metadataComma(String text) {
        char quote = 0;
        boolean escaped = false;
        for (int i = 8; i < text.length(); i++) {
            char c = text.charAt(i);
            if (escaped) escaped = false;
            else if (c == '\\' && quote != 0) escaped = true;
            else if (quote != 0) { if (c == quote) quote = 0; }
            else if (c == '"' || c == '\'') quote = c;
            else if (c == ',') return i;
        }
        return -1;
    }

    private static boolean isHttpUrl(String text) {
        if (text == null || text.trim().isEmpty()) return false;
        try {
            URI uri = new URI(text.trim());
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) && uri.getHost() != null && !uri.getHost().isEmpty() && uri.getPort() >= -1 && uri.getPort() <= 65535;
        } catch (URISyntaxException error) { return false; }
    }

    private static String normalizedHttpUrl(String text) {
        String value = safe(text).trim();
        if (value.startsWith("//")) value = "https:" + value;
        return isHttpUrl(value) ? value : "";
    }

    private static String resolveHttpUrl(String base, String reference) {
        String value = decodeEntities(safe(reference).trim());
        if (value.isEmpty()) return "";
        try { return normalizedHttpUrl(new URI(base).resolve(value).toString()); }
        catch (IllegalArgumentException | URISyntaxException error) { return ""; }
    }

    private static String urlKey(String url) {
        try {
            URI uri = new URI(url);
            String scheme = safe(uri.getScheme()).toLowerCase(Locale.ROOT), host = safe(uri.getHost()).toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if (("http".equals(scheme) && port == 80) || ("https".equals(scheme) && port == 443)) port = -1;
            return scheme + "://" + safe(uri.getRawUserInfo()) + "@" + host + ":" + port + first(uri.getRawPath(), "/") + "?" + safe(uri.getRawQuery());
        } catch (URISyntaxException error) { return url; }
    }

    private static String nameFromUrl(String url) {
        try {
            URI uri = new URI(url);
            String path = safe(uri.getPath());
            int slash = path.lastIndexOf('/');
            return first(slash >= 0 ? path.substring(slash + 1) : path, uri.getHost(), "未命名频道");
        } catch (URISyntaxException error) { return "未命名频道"; }
    }

    private static boolean isHlsUrl(String url) {
        try { return safe(new URI(url).getPath()).toLowerCase(Locale.ROOT).endsWith(".m3u8"); }
        catch (URISyntaxException error) { return false; }
    }

    private static String normalizedTitle(String title) { return safe(title).replaceAll("[\\s\\u3000]+", "").toLowerCase(Locale.ROOT); }
    private static int relevance(String title, String query) {
        String normalized = normalizedTitle(title);
        if (normalized.equals(query)) return 0;
        if (normalized.startsWith(query)) return 1;
        return normalized.contains(query) ? 2 : 3;
    }

    private static String plainText(String value) {
        String text = SCRIPT.matcher(safe(value)).replaceAll("");
        text = BREAK.matcher(text).replaceAll("\n");
        return decodeEntities(TAG.matcher(text).replaceAll("")).replace('\u00a0', ' ').trim();
    }

    private static String decodeEntities(String value) {
        String text = safe(value).replace("&nbsp;", " ").replace("&quot;", "\"").replace("&apos;", "'").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&");
        Matcher matcher = ENTITY.matcher(text);
        StringBuffer decoded = new StringBuffer();
        while (matcher.find()) {
            String replacement = matcher.group();
            try {
                String digits = matcher.group(1);
                int code = digits.startsWith("x") ? Integer.parseInt(digits.substring(1), 16) : Integer.parseInt(digits);
                if (Character.isValidCodePoint(code) && !(code >= 0xD800 && code <= 0xDFFF)) replacement = new String(Character.toChars(code));
            } catch (IllegalArgumentException ignored) { }
            matcher.appendReplacement(decoded, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(decoded);
        return decoded.toString();
    }

    private static String failureMessage(Throwable error) {
        if (error instanceof SocketTimeoutException) return "网络请求超时";
        if (error instanceof InterruptedIOException || error instanceof InterruptedException) return "请求已取消或超时";
        if (error instanceof UnknownHostException) return "无法解析服务器地址";
        if (error instanceof ConnectException) return "无法连接服务器";
        if (error instanceof SSLException) return "服务器证书或安全连接校验失败";
        if (error instanceof SecurityException) return "应用无法访问网络";
        String message = error == null ? "" : safe(error.getMessage());
        for (int i = 0; i < message.length(); i++) if (message.charAt(i) >= '\u3400' && message.charAt(i) <= '\u9fff') return message;
        return "网络请求或数据解析失败";
    }

    private static long deadlineAfter(long ms) { return System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ms); }
    private static String stripBom(String text) { return text != null && text.startsWith("\uFEFF") ? text.substring(1) : safe(text); }
    private static String safe(String text) { return text == null ? "" : text; }
    private static String first(String... values) { for (String value : values) if (value != null && !value.isEmpty()) return value; return ""; }
    private static String join(List<String> values, String separator) {
        StringBuilder output = new StringBuilder();
        for (String value : values) { if (output.length() > 0) output.append(separator); output.append(value); }
        return output.toString();
    }
    private static <K, V> void putFirst(Map<K, V> map, K key, V value) { if (!map.containsKey(key)) map.put(key, value); }
    private static <T> List<T> immutable(List<T> values) { return values == null || values.isEmpty() ? Collections.emptyList() : Collections.unmodifiableList(new ArrayList<>(values)); }

    private static final class RequestScope {
        final long deadline;
        final Set<HttpURLConnection> connections = Collections.newSetFromMap(new ConcurrentHashMap<>());
        volatile boolean cancelled;
        RequestScope(long deadline) { this.deadline = deadline; }
        boolean expired() { return cancelled || Thread.currentThread().isInterrupted() || System.nanoTime() >= deadline; }
        void check() throws InterruptedIOException { if (expired()) throw new InterruptedIOException("请求已取消或超时"); }
        int timeout(int maximum) throws InterruptedIOException {
            check();
            return (int) Math.max(1L, Math.min(maximum, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())));
        }
        void register(HttpURLConnection connection) throws InterruptedIOException {
            connections.add(connection);
            if (expired()) { connections.remove(connection); connection.disconnect(); check(); }
        }
        void unregister(HttpURLConnection connection) { connections.remove(connection); }
        void cancel() { cancelled = true; for (HttpURLConnection connection : connections) connection.disconnect(); connections.clear(); }
    }

    private static final class Configuration {
        final List<Source> vodSources, liveSubscriptions;
        final String warning;
        Configuration(List<Source> vodSources, List<Source> liveSubscriptions, String warning) { this.vodSources = vodSources; this.liveSubscriptions = liveSubscriptions; this.warning = warning; }
    }
    private static final class SourceSearch {
        final List<VodItem> items;
        final String warning;
        SourceSearch(List<VodItem> items, String warning) { this.items = items; this.warning = warning; }
    }
    public static class Source {
        public final String name, url;
        public Source(String name, String url) { this.name = safe(name); this.url = safe(url); }
    }
    public static class VodItem {
        public final Source source;
        public final String id, title, cover, type, year, remarks;
        public final String mediaType, imdbId, doubanId;
        public final int tmdbId;
        public VodItem(Source source, String id, String title, String cover, String type, String year, String remarks) {
            this(source, id, title, cover, type, year, remarks, "", 0, "", "");
        }
        public VodItem(Source source, String id, String title, String cover, String type, String year, String remarks,
                       String mediaType, int tmdbId, String imdbId, String doubanId) {
            this.source = source; this.id = safe(id); this.title = safe(title); this.cover = safe(cover); this.type = safe(type); this.year = safe(year); this.remarks = safe(remarks);
            this.mediaType = safe(mediaType); this.tmdbId = Math.max(0, tmdbId);
            this.imdbId = ArtworkRepository.validImdb(imdbId); this.doubanId = ArtworkRepository.validId(doubanId);
        }
        static VodItem fromHistory(JSONObject row) throws JSONException {
            return new VodItem(new Source(row.getString("sourceName"), row.getString("sourceUrl")),
                    row.getString("id"), row.getString("title"), row.optString("cover"), row.optString("type"),
                    row.optString("year"), row.optString("remarks"), row.optString("mediaType"),
                    row.optInt("tmdbId"), row.optString("imdbId"), row.optString("doubanId"));
        }
        JSONObject toHistory() throws JSONException {
            return new JSONObject().put("sourceName", source.name).put("sourceUrl", source.url)
                    .put("id", id).put("title", title).put("cover", cover).put("type", type).put("year", year)
                    .put("remarks", remarks).put("mediaType", mediaType).put("tmdbId", tmdbId)
                    .put("imdbId", imdbId).put("doubanId", doubanId);
        }
    }
    public static class Episode {
        public final String name, url;
        public Episode(String name, String url) { this.name = safe(name); this.url = safe(url); }
    }
    public static class VideoDetails {
        public final VodItem item;
        public final String description;
        public final List<Episode> episodes;
        public volatile Backdrop backdrop;
        public VideoDetails(VodItem item, String description, List<Episode> episodes) { this.item = item; this.description = safe(description); this.episodes = immutable(episodes); }
    }
    public static class SearchResult {
        public final List<VodItem> items;
        public final List<String> warnings;
        public SearchResult(List<VodItem> items, List<String> warnings) { this.items = immutable(items); this.warnings = immutable(warnings); }
    }
    public static class Channel {
        public final String name, url, group, logo;
        public Channel(String name, String url, String group, String logo) { this.name = safe(name); this.url = safe(url); this.group = safe(group); this.logo = safe(logo); }
    }
}
