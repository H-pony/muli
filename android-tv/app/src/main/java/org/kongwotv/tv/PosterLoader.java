package org.kongwotv.tv;

import android.app.ActivityManager;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.LruCache;
import android.view.View;
import android.view.ViewTreeObserver;
import android.widget.ImageView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class PosterLoader {
    private static final long DOWNLOAD_TIMEOUT_MS = 15_000;
    private final Object stateLock = new Object();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(3, 3, 0L,
            TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(48));
    private final Set<HttpURLConnection> connections = new HashSet<>();
    private final Set<VisibilityRequest> waitingForVisibility = new HashSet<>();
    private boolean visibilityRetryPosted;
    private final LruCache<String, Bitmap> posterCache;
    private final LruCache<String, Bitmap> backdropCache;
    private final long heapBytes = Runtime.getRuntime().maxMemory();
    private final boolean lowRam;
    private final Object backdropDecodeLock = new Object();
    private final AssetManager bundledAssets;
    private volatile boolean closed;

    PosterLoader(Context context) {
        Context application = context.getApplicationContext();
        bundledAssets = (application == null ? context : application).getAssets();
        ActivityManager memory = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        lowRam = memory != null && (memory.isLowRamDevice() || memory.getMemoryClass() < 128);
        posterCache = bitmapCache((int) Math.min(12L * 1024 * 1024, Math.max(2L * 1024 * 1024, heapBytes / 32)));
        backdropCache = bitmapCache((int) Math.min(lowRam ? 6L * 1024 * 1024 : 40L * 1024 * 1024,
                Math.max(4L * 1024 * 1024, heapBytes / 8)));
    }

    private static LruCache<String, Bitmap> bitmapCache(int bytes) {
        return new LruCache<String, Bitmap>(bytes) {
            @Override protected int sizeOf(String key, Bitmap value) { return Math.max(1, value.getByteCount()); }
        };
    }

    private enum ImageKind {
        POSTER(3 * 1024 * 1024), BACKDROP(6 * 1024 * 1024);
        final int maxBytes;
        ImageKind(int maxBytes) { this.maxBytes = maxBytes; }
    }

    private static final class Request {
        final String url, key;
        final ImageKind kind;
        final ImageDecodePolicy policy;
        final ImageFallback fallback;
        final WeakReference<ImageView> target;
        volatile boolean cancelled;
        VisibilityRequest visibility;

        Request(String url, ImageKind kind, ImageView target, ImageDecodePolicy policy, ImageFallback fallback) {
            this.url = url; this.kind = kind; this.policy = policy; this.fallback = fallback;
            this.key = kind.name() + ":" + policy.maxWidth + "x" + policy.maxHeight + ":" + policy.maxPixels + ":" + url;
            this.target = new WeakReference<>(target);
        }
    }

    private final class VisibilityRequest implements View.OnAttachStateChangeListener,
            ViewTreeObserver.OnScrollChangedListener, ViewTreeObserver.OnGlobalLayoutListener,
            ViewTreeObserver.OnPreDrawListener {
        final Request request;
        final Rect visibleRect = new Rect();
        ViewTreeObserver observer;
        boolean disposed;

        VisibilityRequest(Request request) { this.request = request; }

        void attach() {
            ImageView target = request.target.get();
            if (disposed || target == null) { dispose(); return; }
            target.addOnAttachStateChangeListener(this);
            if (target.isAttachedToWindow()) {
                observe(target);
                attempt();
            }
        }

        void observe(View target) {
            removeObserver();
            observer = target.getViewTreeObserver();
            if (!observer.isAlive()) return;
            observer.addOnScrollChangedListener(this);
            observer.addOnGlobalLayoutListener(this);
            observer.addOnPreDrawListener(this);
        }

        void attempt() {
            ImageView target = request.target.get();
            if (disposed) return;
            if (closed || request.cancelled || target == null || target.getTag() != request) {
                dispose();
                return;
            }
            if (target.isAttachedToWindow() && target.isShown()
                    && target.getGlobalVisibleRect(visibleRect) && !visibleRect.isEmpty()
                    && submit(request)) dispose();
        }

        void removeObserver() {
            if (observer != null && observer.isAlive()) {
                observer.removeOnScrollChangedListener(this);
                observer.removeOnGlobalLayoutListener(this);
                observer.removeOnPreDrawListener(this);
            }
            observer = null;
        }

        void dispose() {
            if (disposed) return;
            disposed = true;
            removeObserver();
            ImageView target = request.target.get();
            if (target != null) target.removeOnAttachStateChangeListener(this);
            synchronized (stateLock) {
                waitingForVisibility.remove(this);
                if (request.visibility == this) request.visibility = null;
            }
        }

        @Override public void onViewAttachedToWindow(View view) { observe(view); attempt(); }
        @Override public void onViewDetachedFromWindow(View view) {
            request.cancelled = true;
            dispose();
        }
        @Override public void onScrollChanged() { attempt(); }
        @Override public void onGlobalLayout() { attempt(); }
        @Override public boolean onPreDraw() {
            // 首帧检查一次，之后由滚动、布局和下载完成事件触发，不循环请求帧。
            if (observer != null && observer.isAlive()) observer.removeOnPreDrawListener(this);
            attempt();
            return true;
        }
    }

    void load(String url, ImageView target) {
        load(url, target, ImageKind.POSTER);
    }

    void loadWhenVisible(String url, ImageView target) {
        Request request = prepare(url, target, ImageKind.POSTER);
        if (request != null) watchVisibility(request);
    }

    void loadBackdrop(String url, ImageView target) {
        loadBackdrop(url, "", target);
    }

    void loadBackdrop(String url, String fallbackUrl, ImageView target) {
        ImageFallback fallback = new ImageFallback(url, fallbackUrl);
        Request request = prepare(fallback.initial(), target, ImageKind.BACKDROP, fallback, true);
        if (request != null && !submit(request)) watchVisibility(request);
    }

    /** Only the fixed, verified home artwork folder can be read through this image pipeline. */
    void loadBundledBackdrop(String assetPath, String networkPrimaryUrl, String fallbackSourceUrl, ImageView target) {
        if (assetPath == null || !assetPath.matches("home-featured/[0-9]+\\.jpg")) {
            loadBackdrop(networkPrimaryUrl, fallbackSourceUrl, target);
            return;
        }
        ImageFallback fallback = new ImageFallback(networkPrimaryUrl, fallbackSourceUrl);
        Request request = prepare("asset://" + assetPath, target, ImageKind.BACKDROP, fallback, true);
        if (request != null && !submit(request)) watchVisibility(request);
    }

    void cancel(ImageView target) {
        Object previous = target.getTag();
        if (previous instanceof Request) {
            Request old = (Request) previous;
            old.cancelled = true;
            if (old.visibility != null) old.visibility.dispose();
        }
        target.setTag(null);
    }

    private Request prepare(String url, ImageView target, ImageKind kind) {
        return prepare(url, target, kind, new ImageFallback(url, ""), false);
    }

    private Request prepare(String url, ImageView target, ImageKind kind, ImageFallback fallback, boolean preserve) {
        cancel(target);
        if (!preserve) target.setImageDrawable(null);
        String imageUrl = kind == ImageKind.BACKDROP && url != null
                && url.matches("asset://home-featured/[0-9]+\\.jpg") ? url : ImageFallback.http(url);
        if (closed || imageUrl.isEmpty()) return null;
        int displayEdge = Math.max(target.getResources().getDisplayMetrics().widthPixels,
                target.getResources().getDisplayMetrics().heightPixels);
        int viewEdge = Math.max(target.getWidth(), target.getHeight());
        ImageDecodePolicy policy = kind == ImageKind.POSTER ? ImageDecodePolicy.poster()
                : ImageDecodePolicy.backdrop(viewEdge > 0 ? viewEdge : displayEdge, heapBytes, lowRam);
        Request request = new Request(imageUrl, kind, target, policy, fallback);
        target.setTag(request);
        return request;
    }

    private void load(String url, ImageView target, ImageKind kind) {
        Request request = prepare(url, target, kind);
        if (request != null && !submit(request)) watchVisibility(request);
    }

    private LruCache<String, Bitmap> cache(Request request) {
        return request.kind == ImageKind.POSTER ? posterCache : backdropCache;
    }

    private void watchVisibility(Request request) {
        VisibilityRequest waiting = new VisibilityRequest(request);
        synchronized (stateLock) {
            if (closed || request.cancelled) return;
            request.visibility = waiting;
            waitingForVisibility.add(waiting);
        }
        waiting.attach();
    }

    private boolean submit(Request request) {
        synchronized (stateLock) {
            ImageView target = request.target.get();
            if (stopped(request) || target == null || target.getTag() != request) return true;
            Bitmap cached = cache(request).get(request.key);
            if (cached != null) {
                target.setImageBitmap(cached);
                return true;
            }
            try {
                workers.execute(() -> {
                    try { fetch(request); }
                    finally { retryVisibleRequests(); }
                });
                return true;
            } catch (RejectedExecutionException ignored) {
                // 保留可见性监听，工作线程释放容量后重试，不永久丢弃可见卡片。
                return false;
            }
        }
    }

    private void retryVisibleRequests() {
        synchronized (stateLock) {
            if (closed || visibilityRetryPosted || waitingForVisibility.isEmpty()) return;
            visibilityRetryPosted = true;
            main.post(() -> {
                Set<VisibilityRequest> waiting;
                synchronized (stateLock) {
                    visibilityRetryPosted = false;
                    if (closed) return;
                    waiting = new HashSet<>(waitingForVisibility);
                }
                for (VisibilityRequest request : waiting) request.attempt();
            });
        }
    }

    private boolean stopped(Request request) {
        return closed || request.cancelled || Thread.currentThread().isInterrupted()
                || request.target.get() == null;
    }

    private void fetch(Request request) {
        if (stopped(request)) return;
        HttpURLConnection connection = null;
        boolean success = false;
        try {
            long deadline = SystemClock.elapsedRealtime() + DOWNLOAD_TIMEOUT_MS;
            InputStream source;
            if (request.url.matches("asset://home-featured/[0-9]+\\.jpg")) {
                source = bundledAssets.open(request.url.substring("asset://".length()), AssetManager.ACCESS_STREAMING);
            } else {
                connection = (HttpURLConnection) new URL(request.url).openConnection();
                synchronized (stateLock) {
                    if (stopped(request)) return;
                    connections.add(connection);
                }
                connection.setConnectTimeout(4500);
                connection.setReadTimeout(5000);
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 Muli/2.16.12");
                connection.setInstanceFollowRedirects(true);
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return;
                int contentLength = connection.getContentLength();
                if (contentLength > request.kind.maxBytes || stopped(request)) return;
                source = connection.getInputStream();
            }
            byte[] encoded;
            try (InputStream input = source;
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (stopped(request) || SystemClock.elapsedRealtime() >= deadline
                            || output.size() + count > request.kind.maxBytes) return;
                    output.write(buffer, 0, count);
                }
                if (stopped(request) || SystemClock.elapsedRealtime() >= deadline) return;
                encoded = output.toByteArray();
            }
            Bitmap image;
            if (request.kind == ImageKind.BACKDROP) {
                // Bound simultaneous large bitmap allocations; list posters retain their own workers/cache.
                synchronized (backdropDecodeLock) {
                    if (stopped(request)) return;
                    image = decode(encoded, request.policy);
                }
            } else image = decode(encoded, request.policy);
            if (image == null || stopped(request)) return;
            synchronized (stateLock) {
                if (stopped(request)) return;
                cache(request).put(request.key, image);
                success = true;
                main.post(() -> {
                    synchronized (stateLock) {
                        ImageView target = request.target.get();
                        if (!closed && !request.cancelled && target != null
                                && target.getTag() == request) target.setImageBitmap(image);
                    }
                });
            }
        } catch (Exception | OutOfMemoryError ignored) {
            // A bounded decode can still fail under system pressure; retry this film's original cover.
        } finally {
            if (connection != null) {
                synchronized (stateLock) { connections.remove(connection); }
                connection.disconnect();
            }
            if (!success && !stopped(request)) failed(request);
        }
    }

    private void failed(Request request) {
        main.post(() -> {
            ImageView target = request.target.get();
            if (closed || request.cancelled || target == null || target.getTag() != request) return;
            String fallback = request.fallback.onFailure();
            if (fallback.isEmpty()) return;
            Request retry = prepare(fallback, target, request.kind, new ImageFallback(fallback, ""), true);
            if (retry != null && !submit(retry)) watchVisibility(retry);
        });
    }

    private Bitmap decode(byte[] encoded, ImageDecodePolicy policy) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        ImageDecodePolicy.Plan plan = policy.plan(bounds.outWidth, bounds.outHeight);
        if (plan == null) return null;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = plan.sample;
        options.inPreferredConfig = policy.lowMemory ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888;
        // Decoder density scaling produces the bounded output directly, including 4096 -> 3840,
        // instead of first allocating an unrestricted source bitmap and then a second large bitmap.
        options.inScaled = plan.sampledWidth > plan.width;
        options.inDensity = plan.sampledWidth;
        options.inTargetDensity = plan.width;
        Bitmap image = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (image == null) return null;
        if (image.getWidth() <= policy.maxWidth && image.getHeight() <= policy.maxHeight
                && (long) image.getWidth() * image.getHeight() <= policy.maxPixels) return image;
        // Rounding and device decoder differences get a final bounded adjustment.
        ImageDecodePolicy.Plan finalSize = policy.plan(image.getWidth(), image.getHeight());
        if (finalSize == null) { image.recycle(); return null; }
        Bitmap scaled = Bitmap.createScaledBitmap(image, finalSize.width, finalSize.height, true);
        if (scaled != image) image.recycle();
        return scaled;
    }

    void close() {
        Set<HttpURLConnection> active;
        Set<VisibilityRequest> waiting;
        synchronized (stateLock) {
            if (closed) return;
            closed = true;
            workers.shutdownNow();
            main.removeCallbacksAndMessages(null);
            visibilityRetryPosted = false;
            posterCache.evictAll();
            backdropCache.evictAll();
            active = new HashSet<>(connections);
            connections.clear();
            waiting = new HashSet<>(waitingForVisibility);
            waitingForVisibility.clear();
        }
        for (VisibilityRequest request : waiting) {
            request.request.cancelled = true;
            request.dispose();
        }
        for (HttpURLConnection connection : active) connection.disconnect();
    }
}
