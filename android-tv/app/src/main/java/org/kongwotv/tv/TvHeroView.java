package org.kongwotv.tv;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;

import static org.kongwotv.tv.TvUi.*;

/** Full-bleed, remote-operated home feature. Every title and image belongs to a real source item. */
final class TvHeroView extends FrameLayout {
    interface Actions {
        void play(TvRepository.VodItem item);
        void details(TvRepository.VodItem item);
        void explore();
    }

    private static final int INK = 0xFF0D1117;
    private final Activity activity;
    private final PosterLoader posters;
    private final ArtworkRepository artwork;
    private final TvRepository repository;
    private final ExecutorService io;
    private final Actions actions;
    private final List<TvRepository.VodItem> movies = new ArrayList<>();
    private final ImageView image;
    private final TextView title, metadata, synopsis;
    private final Button play;
    private final FrameLayout details, previous, next;
    private final LinearLayout copy, pagination;
    private int index, generation;
    private boolean attached;
    private Future<?> detailLoad;
    private ArtworkRepository.Ticket artworkTicket;

    TvHeroView(Activity activity, PosterLoader posters, ArtworkRepository artwork,
               TvRepository repository, ExecutorService io, List<TvRepository.VodItem> items, Actions actions) {
        super(activity);
        this.activity = activity;
        this.posters = posters;
        this.artwork = artwork;
        this.repository = repository;
        this.io = io;
        this.actions = actions;
        selectMovies(items);
        setBackgroundColor(INK);
        setTag("home:hero");
        // CENTER_CROP can draw outside ImageView bounds; the full-bleed feature still owns a fixed viewport.
        setClipChildren(true);
        setClipToPadding(true);

        image = new ImageView(activity);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        addView(image, new LayoutParams(-1, -1));

        View leftShade = new View(activity);
        leftShade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{INK, 0xF00D1117, 0xB80D1117, 0x480D1117, 0x080D1117}));
        addView(leftShade, new LayoutParams(-1, -1));
        View edgeShade = new View(activity);
        edgeShade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xA60D1117, 0x080D1117, 0x000D1117, 0x400D1117, INK}));
        addView(edgeShade, new LayoutParams(-1, -1));

        copy = vertical(activity);
        title = heading(activity, "", 26);
        title.setTextColor(0xFFF9FBFE);
        title.setLetterSpacing(-.025f);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        copy.addView(title, new LinearLayout.LayoutParams(-1, -2));
        metadata = text(activity, "", 12, 0xFFF2F3F6);
        metadata.setSingleLine(true);
        metadata.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams metadataParams = new LinearLayout.LayoutParams(-1, -2);
        metadataParams.topMargin = dp(activity, 10);
        copy.addView(metadata, metadataParams);
        synopsis = text(activity, "", 12, 0xFFBFC4CD);
        synopsis.setMaxLines(2);
        synopsis.setEllipsize(TextUtils.TruncateAt.END);
        synopsis.setLineSpacing(dp(activity, 4), 1f);
        LinearLayout.LayoutParams synopsisParams = new LinearLayout.LayoutParams(-1, -2);
        synopsisParams.topMargin = dp(activity, 13);
        copy.addView(synopsis, synopsisParams);

        LinearLayout actionRow = new LinearLayout(activity);
        actionRow.setGravity(Gravity.CENTER_VERTICAL);
        unclipped(actionRow);
        play = button(activity, "立即播放", view -> {
            TvRepository.VodItem movie = selected();
            if (movie == null) actions.explore();
            else actions.play(movie);
        });
        play.setTag("hero:play");
        play.setTextSize(13);
        play.setTextColor(0xFF0D1117);
        play.setBackground(pill(true));
        play.setPadding(dp(activity, 18), 0, dp(activity, 18), 0);
        MobileIcons playIcon = new MobileIcons(activity, MobileIcons.Kind.PLAY, 0xFF0D1117, 18);
        playIcon.setBounds(0, 0, dp(activity, 18), dp(activity, 18));
        play.setCompoundDrawables(playIcon, null, null, null);
        play.setCompoundDrawablePadding(dp(activity, 9));
        actionRow.addView(play, new LinearLayout.LayoutParams(dp(activity, 164), dp(activity, 38)));
        details = iconButton(MobileIcons.Kind.FILM, "查看影片详情", "hero:details", false,
                () -> { if (selected() != null) actions.details(selected()); });
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(dp(activity, 38), dp(activity, 38));
        detailParams.leftMargin = dp(activity, 10);
        actionRow.addView(details, detailParams);
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(-2, -2);
        actionsParams.topMargin = dp(activity, 18);
        copy.addView(actionRow, actionsParams);
        int availableWidth = activity.getResources().getConfiguration().screenWidthDp;
        LayoutParams copyParams = new LayoutParams(dp(activity, Math.min(480, Math.max(320, availableWidth * .48f))),
                -2, Gravity.START | Gravity.BOTTOM);
        copyParams.setMargins(dp(activity, 40), dp(activity, 94), dp(activity, 80), dp(activity, 53));
        addView(copy, copyParams);

        previous = iconButton(MobileIcons.Kind.CHEVRON, "上一部推荐", "hero:previous", true, () -> change(-1));
        next = iconButton(MobileIcons.Kind.CHEVRON, "下一部推荐", "hero:next", false, () -> change(1));
        LayoutParams previousParams = new LayoutParams(dp(activity, 36), dp(activity, 46), Gravity.START | Gravity.TOP);
        previousParams.leftMargin = dp(activity, 20);
        addView(previous, previousParams);
        LayoutParams nextParams = new LayoutParams(dp(activity, 36), dp(activity, 46), Gravity.END | Gravity.TOP);
        nextParams.rightMargin = dp(activity, 25);
        addView(next, nextParams);

        pagination = new LinearLayout(activity);
        pagination.setGravity(Gravity.CENTER);
        pagination.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        LayoutParams paginationParams = new LayoutParams(-2, dp(activity, 12), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        paginationParams.bottomMargin = dp(activity, 13);
        addView(pagination, paginationParams);
        for (int i = 0; i < movies.size(); i++) {
            View marker = new View(activity);
            marker.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            LinearLayout.LayoutParams markerParams = new LinearLayout.LayoutParams(dp(activity, 18), dp(activity, 3));
            markerParams.setMargins(dp(activity, 2), 0, dp(activity, 2), 0);
            pagination.addView(marker, markerParams);
        }
        previous.setVisibility(movies.size() > 1 ? View.VISIBLE : View.GONE);
        next.setVisibility(movies.size() > 1 ? View.VISIBLE : View.GONE);
        play.setNextFocusRightId(details.getId());
        details.setNextFocusLeftId(play.getId());
        if (movies.size() > 1) {
            play.setNextFocusLeftId(previous.getId());
            previous.setNextFocusRightId(play.getId());
            details.setNextFocusRightId(next.getId());
            next.setNextFocusLeftId(details.getId());
        }
        bindText();
    }

    private void selectMovies(List<TvRepository.VodItem> items) {
        if (items == null) return;
        Set<String> selected = new HashSet<>();
        for (int pass = 0; pass < 3; pass++) {
            for (TvRepository.VodItem item : items) {
                if (item == null || item.title.isEmpty()) continue;
                String classification = (item.title + " " + item.type).toLowerCase(Locale.ROOT);
                if (classification.contains("预告") || classification.contains("解说")
                        || classification.contains("短剧") || classification.contains("trailer")) continue;
                boolean withCover = !item.cover.isEmpty();
                boolean movie = "电影".equals(PlaybackState.browseCategory(item));
                if (pass == 0 && (!withCover || !movie)) continue;
                if (pass == 1 && !withCover) continue;
                String key = PlaybackState.normalize(item.title) + "|" + item.year;
                if (selected.add(key)) movies.add(item);
                if (movies.size() == 5) return;
            }
        }
    }

    private FrameLayout iconButton(MobileIcons.Kind kind, String description, String tag, boolean reverse, Runnable action) {
        FrameLayout target = new FrameLayout(activity);
        target.setTag(tag);
        target.setContentDescription(description);
        target.setBackground(pill(false));
        focusable(target, 1.08f);
        target.setOnClickListener(view -> action.run());
        ImageView icon = new ImageView(activity);
        icon.setDuplicateParentStateEnabled(true);
        icon.setImageDrawable(new MobileIcons(activity, kind, new ColorStateList(new int[][]{
                {android.R.attr.state_focused}, {android.R.attr.state_pressed}, {}
        }, new int[]{INK, INK, 0xFFF9FBFE}), 19));
        if (reverse) icon.setRotation(180f);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        target.addView(icon, new LayoutParams(dp(activity, 19), dp(activity, 19), Gravity.CENTER));
        return target;
    }

    private StateListDrawable pill(boolean primary) {
        StateListDrawable state = new StateListDrawable();
        state.addState(new int[]{android.R.attr.state_focused}, rounded(activity, Color.WHITE, 40, 0xFFFFFFFF, 1));
        state.addState(new int[]{android.R.attr.state_pressed}, rounded(activity, 0xFFE0E4EB, 40, 0, 0));
        state.addState(new int[]{}, rounded(activity, primary ? Color.WHITE : 0x664D5562, 40, primary ? 0 : 0x40FFFFFF, .7f));
        return state;
    }

    private TvRepository.VodItem selected() { return movies.isEmpty() ? null : movies.get(index); }

    TvRepository.VodItem selectedMovie() { return selected(); }

    void restoreSelection(TvRepository.VodItem selected) {
        if (selected == null) return;
        for (int i = 0; i < movies.size(); i++) {
            TvRepository.VodItem item = movies.get(i);
            if (item.source.url.equals(selected.source.url) && item.id.equals(selected.id)) {
                index = i;
                bindText();
                if (attached) loadCurrent();
                return;
            }
        }
    }

    private void change(int direction) {
        if (movies.size() < 2) return;
        index = (index + direction + movies.size()) % movies.size();
        bindText();
        loadCurrent();
    }

    private void bindText() {
        TvRepository.VodItem movie = selected();
        title.setText(movie == null ? "好故事，值得大屏看。" : movie.title);
        metadata.setText(movie == null ? "电影 · 剧集 · 电视直播" : join(movie.year, movie.type, movie.remarks));
        synopsis.setText(movie == null ? "发现电影与剧集，开启你的观影时光。" : "内容来源 · " + movie.source.name);
        play.setText(movie == null ? "探索影视" : "立即播放");
        play.setContentDescription(movie == null ? "探索影视" : "立即播放 " + movie.title);
        details.setVisibility(movie == null ? View.GONE : View.VISIBLE);
        for (int i = 0; i < pagination.getChildCount(); i++) {
            pagination.getChildAt(i).setBackground(rounded(activity, i == index ? Color.WHITE : 0x66FFFFFF, 2, 0, 0));
        }
        pagination.setContentDescription(movie == null ? "暂无推荐影片" : "推荐影片 " + (index + 1) + " / " + movies.size() + "，" + movie.title);
    }

    private void loadCurrent() {
        cancelRequests();
        final int token = generation;
        final TvRepository.VodItem movie = selected();
        if (!attached || movie == null) return;
        image.setImageDrawable(null);
        posters.loadBackdrop(movie.cover, image);
        requestArtwork(movie, token);
        try {
            detailLoad = io.submit(() -> {
                try {
                    TvRepository.VideoDetails detail = repository.detail(movie);
                    if (Thread.currentThread().isInterrupted()) return;
                    post(() -> {
                        if (!current(token)) return;
                        if (movie.tmdbId > 0 && !TvFeaturedCatalog.matches(movie, detail.item)) {
                            if (artworkTicket != null) { artworkTicket.cancel(); artworkTicket = null; }
                            posters.loadBackdrop(movie.cover, image);
                            synopsis.setText("影片信息已更新，请从搜索确认");
                            return;
                        }
                        metadata.setText(join(detail.item.year, detail.item.type, detail.item.remarks));
                        String description = detail.description.replace('\u3000', ' ').trim();
                        if (!description.isEmpty() && !"暂无简介".equals(description)) synopsis.setText(description);
                        requestArtwork(detail.item, token);
                    });
                } catch (Exception ignored) {
                    // Keep the real source metadata and poster when a provider is unavailable.
                }
            });
        } catch (RejectedExecutionException ignored) {
            // The host may already be leaving; never replace existing content with an error overlay.
        }
    }

    private void requestArtwork(TvRepository.VodItem movie, int token) {
        if (artworkTicket != null) artworkTicket.cancel();
        artworkTicket = artwork.request(movie, activity.getResources().getDisplayMetrics().widthPixels, backdrop -> {
            if (!current(token) || backdrop == null) return;
            if (movie.tmdbId == 157336 || movie.tmdbId == 27205 || movie.tmdbId == 842675)
                posters.loadBundledBackdrop("home-featured/" + movie.tmdbId + ".jpg", backdrop.url(), movie.cover, image);
            else posters.loadBackdrop(backdrop.url(), movie.cover, image);
        });
    }

    private boolean current(int token) { return attached && generation == token && !activity.isFinishing(); }

    @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        super.onLayout(changed, left, top, right, bottom);
        // Long two-line titles must not share the same horizontal band as the previous/next controls.
        int arrowHeight = previous.getMeasuredHeight();
        int aboveCopy = copy.getTop() - dp(activity, 12) - arrowHeight;
        int arrowTop = Math.max(dp(activity, 90), Math.min(Math.round(getHeight() * .4f) - arrowHeight / 2, aboveCopy));
        previous.layout(previous.getLeft(), arrowTop, previous.getRight(), arrowTop + arrowHeight);
        next.layout(next.getLeft(), arrowTop, next.getRight(), arrowTop + next.getMeasuredHeight());
    }

    private void cancelRequests() {
        generation++;
        if (detailLoad != null) { detailLoad.cancel(true); detailLoad = null; }
        if (artworkTicket != null) { artworkTicket.cancel(); artworkTicket = null; }
        posters.cancel(image);
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        attached = true;
        loadCurrent();
    }

    @Override protected void onDetachedFromWindow() {
        attached = false;
        cancelRequests();
        image.setImageDrawable(null);
        super.onDetachedFromWindow();
    }

    private static String join(String... values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) if (value != null && !value.trim().isEmpty()) {
            if (result.length() > 0) result.append(" · ");
            result.append(value.trim());
        }
        return result.toString();
    }
}
