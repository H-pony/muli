package org.kongwotv.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.kongwotv.tv.TvUi.*;

/** A television-first browsing surface with cinematic artwork and native D-pad focus. */
@androidx.media3.common.util.UnstableApi
public final class MainActivity extends Activity {
    private static final int PLAYER_REQUEST = 40;
    private static final int HOME = 0, LIVE = 1, MOVIES = 2, HISTORY = 3, SETTINGS = 4;
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final ArrayList<Button> navigation = new ArrayList<>();
    private TvRepository repository;
    private PosterLoader posters;
    private ArtworkRepository artworkRepository;
    private AlertDialog activeDetails;
    private MobileUi mobileUi;
    private SharedPreferences preferences;
    private LinearLayout content, cards;
    private ScrollView pageScroll;
    private FrameLayout tvHeader;
    private TextView status;
    private EditText query;
    private int page = HOME, generation = 0, detailRequest = 0;
    private int movieLimit = 120;
    private String lastSearch = "", liveFilter = "全部", liveQuery = "";
    private List<TvRepository.Channel> channels = new ArrayList<>();
    private List<TvRepository.VodItem> discoveries = new ArrayList<>();
    private List<TvRepository.VodItem> homeFeatured = new ArrayList<>();
    private Future<?> activeLoad;
    private Future<?> activeDetailLoad;
    private TvRepository.VodItem sourceSwitchItem;
    private String sourceSwitchEpisode = "";
    private int sourceSwitchCount;
    private long sourceSwitchPosition;
    private boolean destroyed;
    private boolean focusContentOnLoad;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (BuildConfig.IS_TV) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        repository = new TvRepository(this);
        posters = new PosterLoader(this);
        artworkRepository = new ArtworkRepository(this);
        preferences = getSharedPreferences("kongwotv_home", MODE_PRIVATE);
        if (BuildConfig.IS_TV) homeFeatured = readHomeFeatured();
        channels = repository.bundledChannels();
        discoveries = TvRepository.filterSearchResults(readMovieList("discovery_cache"));
        buildFrame();
        if (state != null) {
            if (mobileUi != null) mobileUi.restoreState(state);
            lastSearch = state.getString("search", "");
            liveFilter = state.getString("live_filter", "全部");
            liveQuery = state.getString("live_query", "");
            restoreSourceSwitch(state.getString("switch_item", ""), state.getString("switch_episode", ""),
                    state.getInt("switch_count", 0), state.getLong("switch_position", 0L));
            openPage(state.getInt("page", HOME));
        } else showHome();
        if (BuildConfig.IS_TV) navigation.get(page).requestFocus();
    }

    private boolean compact() {
        return !BuildConfig.IS_TV && getResources().getConfiguration().screenWidthDp < 600;
    }

    private void buildMobileFrame() {
        mobileUi = new MobileUi(this, posters, artworkRepository, new MobileUi.Actions() {
            @Override public void home() { showHome(); }
            @Override public void browse(String keyword) { showMovies(keyword); }
            @Override public void live() { showLive(); }
            @Override public void history() { showHistory(); }
            @Override public void settings() { showSettings(); }
            @Override public void details(TvRepository.VodItem item) { showDetails(item); }
            @Override public void playChannels(List<TvRepository.Channel> available, int index) { MainActivity.this.playChannels(available, index); }
            @Override public void liveFilter(String group) { liveFilter = group; showLive(); }
            @Override public void liveQuery(String value) { liveQuery = value; renderChannels(); }
            @Override public void refreshLive() {
                Toast.makeText(MainActivity.this, "正在刷新频道…", Toast.LENGTH_SHORT).show();
                showLive();
            }
            @Override public void clearHistory() { confirmClearHistory(); }
        });
        content = mobileUi.content();
        setContentView(mobileUi.frame());
    }

    private void buildFrame() {
        if (!BuildConfig.IS_TV) {
            buildMobileFrame();
            return;
        }
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0D1117);
        unclipped(root);

        content = vertical(this);
        FrameLayout.LayoutParams body = new FrameLayout.LayoutParams(-1, -1);
        root.addView(content, body);
        tvHeader = new FrameLayout(this);
        tvHeader.setTag("tv:header");
        tvHeader.setElevation(dp(this, 20));
        unclipped(tvHeader);
        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.kongwotv_mark);
        mark.setContentDescription("幕里");
        brand.addView(mark, new LinearLayout.LayoutParams(dp(this, 30), dp(this, 30)));
        TextView wordmark = heading(this, "幕里", 21);
        wordmark.setLetterSpacing(-.035f);
        LinearLayout.LayoutParams word = new LinearLayout.LayoutParams(-2, -2);
        word.leftMargin = dp(this, 9);
        brand.addView(wordmark, word);
        FrameLayout.LayoutParams brandParams = new FrameLayout.LayoutParams(-2, dp(this, 40), Gravity.TOP | Gravity.START);
        brandParams.setMargins(dp(this, 40), dp(this, 22), 0, 0);
        tvHeader.addView(brand, brandParams);

        LinearLayout tabs = new LinearLayout(this);
        tabs.setGravity(Gravity.CENTER_VERTICAL);
        unclipped(tabs);

        String[] labels = {"首页", "直播", "搜索", "资料库", "设置"};
        for (int index = 0; index < labels.length; index++) {
            final int target = index;
            Button tab = button(this, labels[index], view -> openPage(target));
            tab.setTextSize(15);
            tab.setSingleLine(true);
            tab.setEllipsize(TextUtils.TruncateAt.END);
            tab.setGravity(Gravity.CENTER);
            tab.setPadding(dp(this, 14), 0, dp(this, 14), 0);
            tab.setBackground(tabBackground());
            tab.setTag("navigation:" + index);
            tab.setContentDescription(labels[index] + "页面");
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(this, 80), dp(this, 36));
            params.setMargins(dp(this, 4), 0, dp(this, 4), 0);
            tabs.addView(tab, params);
            navigation.add(tab);
        }
        FrameLayout.LayoutParams tabsParams = new FrameLayout.LayoutParams(-2, dp(this, 40), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        tabsParams.topMargin = dp(this, 22);
        tvHeader.addView(tabs, tabsParams);
        TextClock clock = new TextClock(this);
        clock.setFormat24Hour("HH:mm");
        clock.setFormat12Hour("h:mm");
        clock.setTextSize(13);
        clock.setTextColor(0xFFD2D4D8);
        clock.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        clock.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        FrameLayout.LayoutParams clockParams = new FrameLayout.LayoutParams(dp(this, 68), dp(this, 40), Gravity.TOP | Gravity.END);
        clockParams.setMargins(0, dp(this, 22), dp(this, 40), 0);
        tvHeader.addView(clock, clockParams);
        root.addView(tvHeader, new FrameLayout.LayoutParams(-1, dp(this, 90), Gravity.TOP));
        for (int index = 0; index < navigation.size(); index++) {
            Button tab = navigation.get(index);
            tab.setNextFocusLeftId(navigation.get(Math.max(0, index - 1)).getId());
            tab.setNextFocusRightId(navigation.get(Math.min(navigation.size() - 1, index + 1)).getId());
            tab.setNextFocusUpId(tab.getId());
        }
        setContentView(root);
    }

    private android.graphics.drawable.StateListDrawable tabBackground() {
        android.graphics.drawable.StateListDrawable state = new android.graphics.drawable.StateListDrawable();
        state.addState(new int[]{android.R.attr.state_focused}, rounded(this, Color.WHITE, 24, Color.WHITE, 1));
        state.addState(new int[]{android.R.attr.state_selected}, rounded(this, 0xA63A3D44, 24, 0x35FFFFFF, .7f));
        state.addState(new int[]{}, rounded(this, Color.TRANSPARENT, 24, 0, 0));
        return state;
    }

    private void openPage(int target) {
        hideKeyboard();
        if (target == LIVE) showLive();
        else if (target == MOVIES) showMovies(lastSearch);
        else if (target == HISTORY) showHistory();
        else if (target == SETTINGS) showSettings();
        else showHome();
    }

    private int beginPage(int target) {
        View previousFocus = getCurrentFocus();
        focusContentOnLoad = previousFocus == null || !navigation.contains(previousFocus);
        generation++;
        detailRequest++;
        if (activeDetails != null) { activeDetails.dismiss(); activeDetails = null; }
        if (activeLoad != null) activeLoad.cancel(true);
        if (activeDetailLoad != null) activeDetailLoad.cancel(true);
        if (target != MOVIES) sourceSwitchItem = null;
        page = target;
        movieLimit = 120;
        if (mobileUi != null) mobileUi.selectPage(target);
        for (int index = 0; index < navigation.size(); index++) navigation.get(index).setSelected(index == target);
        content.removeAllViews();
        if (BuildConfig.IS_TV) {
            FrameLayout.LayoutParams body = (FrameLayout.LayoutParams) content.getLayoutParams();
            body.setMargins(target == HOME ? 0 : dp(this, 40), target == HOME ? 0 : dp(this, 92),
                    target == HOME ? 0 : dp(this, 40), 0);
            content.setLayoutParams(body);
            tvHeader.setBackground(target == HOME
                    ? new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                        new int[]{0xE60D1117, 0xA60D1117, 0x000D1117})
                    : new android.graphics.drawable.ColorDrawable(0xFF0D1117));
        }
        content.animate().cancel();
        content.setAlpha(0f);
        content.animate().alpha(1f).setDuration(220).start();
        query = null;
        cards = null;
        pageScroll = null;
        return generation;
    }

    private void focusPageEntry(View target) {
        linkNavigationToContent(target);
        if (BuildConfig.IS_TV && focusContentOnLoad && target != null) target.requestFocus();
        focusContentOnLoad = false;
    }

    private void linkNavigationToContent(View target) {
        if (!BuildConfig.IS_TV || target == null) return;
        if (target.getId() == View.NO_ID) target.setId(View.generateViewId());
        for (Button tab : navigation) tab.setNextFocusDownId(target.getId());
        target.setNextFocusUpId(navigation.get(page).getId());
    }

    private void title(String label, String detail) {
        TextView heading = heading(this, label, compact() ? 26 : 30);
        heading.setLetterSpacing(-.035f);
        heading.setPadding(dp(this, 5), dp(this, 4), 0, 0);
        content.addView(heading);
        status = text(this, detail, 12, MUTED);
        status.setPadding(dp(this, 5), dp(this, 7), 0, dp(this, 15));
        content.addView(status);
    }

    private Button addSearch(String hint, String value, Runnable search) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        unclipped(row);
        query = new EditText(this);
        final EditText input = query;
        input.setId(View.generateViewId());
        query.setSingleLine(true);
        query.setTextSize(15);
        query.setTextColor(TEXT);
        query.setHintTextColor(0xFF929299);
        query.setHint(hint);
        query.setText(value);
        query.setPadding(dp(this, 17), 0, dp(this, 17), 0);
        query.setBackground(cardBackground(this, 0xFF232327, 12));
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        query.setSelectAllOnFocus(true);
        Button searchButton = button(this, "搜索", null);
        searchButton.setTag("search:submit");
        input.setNextFocusRightId(searchButton.getId());
        searchButton.setNextFocusLeftId(input.getId());
        Runnable submit = () -> {
            hideKeyboard();
            input.clearFocus();
            searchButton.requestFocus();
            search.run();
            // A movie search replaces the editor; end the input session on the new layout too.
            hideKeyboard();
        };
        query.setOnEditorActionListener((view, action, event) -> {
            if (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) submit.run();
                return true;
            }
            if (action == EditorInfo.IME_ACTION_SEARCH || action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_GO) {
                submit.run(); return true;
            }
            return false;
        });
        row.addView(query, new LinearLayout.LayoutParams(0, dp(this, BuildConfig.IS_TV ? 42 : 48), 1));
        searchButton.setOnClickListener(view -> submit.run());
        LinearLayout.LayoutParams action = new LinearLayout.LayoutParams(dp(this, 75), dp(this, BuildConfig.IS_TV ? 42 : 48));
        action.leftMargin = dp(this, 12);
        row.addView(searchButton, action);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(dp(this, 5), 0, dp(this, 5), dp(this, 14));
        content.addView(row, params);
        return searchButton;
    }

    private void addCardsArea() {
        pageScroll = new ScrollView(this);
        pageScroll.setFillViewport(false);
        pageScroll.setVerticalScrollBarEnabled(false);
        pageScroll.setSmoothScrollingEnabled(true);
        pageScroll.setPadding(0, page == HOME && BuildConfig.IS_TV ? 0 : dp(this, 4), 0, dp(this, 30));
        pageScroll.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        unclipped(pageScroll);
        cards = vertical(this);
        pageScroll.addView(cards, new ScrollView.LayoutParams(-1, -2));
        content.addView(pageScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        if (mobileUi != null) mobileUi.attachPage(cards, pageScroll);
    }

    private void showHome() {
        final int token = beginPage(HOME);
        addCardsArea();
        renderHome(discoveries, discoveries.isEmpty());
        focusPageEntry(cards.findViewWithTag("hero:play"));
        activeLoad = io.submit(() -> {
            TvRepository.SearchResult result = repository.discover();
            runOnUiThread(() -> {
                if (destroyed) return;
                if (!result.items.isEmpty()) {
                    discoveries = uniqueMovies(result.items);
                    saveMovieList("discovery_cache", discoveries, 72);
                }
                if (generation == token && page == HOME) renderHome(discoveries, false);
            });
        });
    }

    private void renderHome(List<TvRepository.VodItem> movies, boolean loading) {
        if (page != HOME || cards == null) return;
        if (mobileUi != null) {
            mobileUi.renderHome(uniqueMovies(movies), historyItems(), channels, loading);
            query = mobileUi.query();
            return;
        }
        View focused = getCurrentFocus();
        String focusedTag = focused != null && focused.getTag() instanceof String ? (String) focused.getTag() : null;
        int scrollY = pageScroll.getScrollY();
        View previousHero = cards.findViewWithTag("home:hero");
        TvRepository.VodItem selectedFeature = previousHero instanceof TvHeroView
                ? ((TvHeroView) previousHero).selectedMovie() : null;
        cards.removeAllViews();
        List<TvRepository.VodItem> unique = uniqueMovies(movies);
        List<TvRepository.VodItem> featureItems = new ArrayList<>(homeFeatured);
        featureItems.addAll(unique);
        int heroHeight = Math.max(350, Math.round(getResources().getConfiguration().screenHeightDp * .75f));
        TvHeroView feature = new TvHeroView(this, posters, artworkRepository, repository, io, featureItems, new TvHeroView.Actions() {
            @Override public void play(TvRepository.VodItem item) { openFeatured(item, true); }
            @Override public void details(TvRepository.VodItem item) { openFeatured(item, false); }
            @Override public void explore() { showMovies(""); }
        });
        feature.restoreSelection(selectedFeature);
        cards.addView(feature, new LinearLayout.LayoutParams(-1, dp(this, heroHeight)));
        linkNavigationToContent(feature.findViewWithTag("hero:play"));
        List<TvRepository.VodItem> history = historyItems();
        if (!unique.isEmpty()) addMovieShelf("为你推荐", "发现下一部好故事", unique.subList(0, Math.min(14, unique.size())), false);
        else if (loading) addSkeletonShelf();
        else addEmptyMessage("暂时还没有载入影片", "你仍然可以观看电视直播，或前往影视页按片名搜索。", "搜索影视", () -> showMovies(""));
        if (!history.isEmpty()) addMovieShelf("继续观看", "接着上次的故事", history, true);
        if (!channels.isEmpty()) addChannelShelf();
        ArrayList<TvRepository.VodItem> films = new ArrayList<>(), series = new ArrayList<>();
        for (TvRepository.VodItem movie : unique) {
            if (PlaybackState.browseCategory(movie).equals("剧集")) series.add(movie);
            else if (PlaybackState.browseCategory(movie).equals("电影")) films.add(movie);
        }
        if (films.size() > 2) addMovieShelf("电影之夜", "给自己留一段好时光", films.subList(0, Math.min(18, films.size())), false);
        if (series.size() > 2) addMovieShelf("追剧时光", "总有一个故事，让你想看下一集", series.subList(0, Math.min(14, series.size())), true);
        TextView footer = text(this, "每一次打开，都有新的故事。", 12, 0xFF727279);
        footer.setPadding(dp(this, 40), dp(this, 25), 0, dp(this, 20));
        cards.addView(footer);
        if (focusedTag != null && !focusedTag.startsWith("navigation:")) {
            View restore = cards.findViewWithTag(focusedTag);
            if (restore != null) {
                restore.requestFocus();
                return;
            }
        }
        final ScrollView homeScroll = pageScroll;
        homeScroll.post(() -> { if (page == HOME && pageScroll == homeScroll) homeScroll.scrollTo(0, scrollY); });
    }

    private Button primaryButton(String label, View.OnClickListener listener) {
        Button action = button(this, label, listener);
        action.setBackground(focusBackground(this, Color.WHITE));
        action.setTextColor(0xFF17181D);
        return action;
    }

    private void shelfHeading(String label, String subtitle) {
        LinearLayout headingRow = new LinearLayout(this);
        headingRow.setGravity(Gravity.CENTER_VERTICAL);
        headingRow.setPadding(dp(this, 40), dp(this, 17), dp(this, 40), dp(this, 15));
        TextView labelView = heading(this, label, 23);
        labelView.setLetterSpacing(-.025f);
        headingRow.addView(labelView, new LinearLayout.LayoutParams(0, -2, 1));
        if (!compact()) {
            Button all = button(this, "查看全部", view -> {
                if (label.equals("继续观看")) showHistory();
                else if (label.equals("正在直播")) showLive();
                else showMovies("");
            });
            all.setTextSize(12);
            all.setSingleLine(true);
            all.setTag("shelf:all:" + label);
            all.setContentDescription("查看全部" + label);
            all.setBackground(tabBackground());
            all.setPadding(dp(this, 12), 0, dp(this, 12), 0);
            MobileIcons icon = new MobileIcons(this, MobileIcons.Kind.CHEVRON, all.getTextColors(), 14);
            icon.setBounds(0, 0, dp(this, 14), dp(this, 14));
            all.setCompoundDrawablesRelative(null, null, icon, null);
            all.setCompoundDrawablePadding(dp(this, 5));
            headingRow.addView(all, new LinearLayout.LayoutParams(dp(this, 96), dp(this, 32)));
        }
        cards.addView(headingRow);
    }

    private LinearLayout shelfRow() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setSmoothScrollingEnabled(true);
        scroll.setPadding(dp(this, 40), dp(this, 6), dp(this, 40), dp(this, 9));
        unclipped(scroll);
        LinearLayout row = new LinearLayout(this);
        unclipped(row);
        scroll.addView(row, new HorizontalScrollView.LayoutParams(-2, -2));
        cards.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
        return row;
    }

    private void addMovieShelf(String label, String subtitle, List<TvRepository.VodItem> movies, boolean landscape) {
        shelfHeading(label, subtitle);
        LinearLayout row = shelfRow();
        for (TvRepository.VodItem movie : movies) {
            View tile = movieTile(movie, landscape, false, label.equals("继续观看"));
            tile.setTag("shelf:" + label + "|" + movieTag(movie));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(this, landscape ? 238 : 138), dp(this, landscape ? 190 : 246));
            params.rightMargin = dp(this, 14);
            row.addView(tile, params);
        }
    }

    private View movieTile(TvRepository.VodItem movie, boolean landscape, boolean showSource) {
        return movieTile(movie, landscape, showSource, page == HISTORY);
    }

    private View movieTile(TvRepository.VodItem movie, boolean landscape, boolean showSource, boolean history) {
        WatchProgress progress = history ? watchProgress(this, movie) : null;
        LinearLayout tile = vertical(this);
        tile.setPadding(dp(this, 2), dp(this, 2), dp(this, 2), dp(this, 8));
        tile.setBackground(cardBackground(this, 0xFF111114, 12));
        tile.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        tile.setTag(movieTag(movie));
        tile.setContentDescription(movie.title + "，" + join(movie.year, movie.type, movie.source.name));
        focusable(tile, landscape ? 1.045f : 1.055f);
        tile.setOnClickListener(view -> showDetails(movie));
        FrameLayout art = new FrameLayout(this);
        art.setBackground(rounded(this, 0xFF232327, 10, 0, 0));
        art.setClipToOutline(true);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x00111114, 0x00111114, 0x8A111114}));
        art.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        if (!movie.remarks.isEmpty()) {
            TextView quality = text(this, movie.remarks, 11, Color.WHITE);
            quality.setSingleLine(true);
            quality.setMaxWidth(dp(this, landscape ? 140 : 110));
            quality.setEllipsize(TextUtils.TruncateAt.END);
            quality.setPadding(dp(this, 6), dp(this, 3), dp(this, 6), dp(this, 3));
            quality.setBackground(rounded(this, 0xA6111114, 5, 0, 0));
            FrameLayout.LayoutParams qualityParams = new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.BOTTOM);
            qualityParams.setMargins(dp(this, 7), 0, dp(this, 7), dp(this, 7));
            art.addView(quality, qualityParams);
        }
        if (history) {
            ImageView resume = new ImageView(this);
            resume.setImageDrawable(new MobileIcons(this, MobileIcons.Kind.PLAY, Color.WHITE, 21));
            resume.setPadding(dp(this, 10), dp(this, 10), dp(this, 10), dp(this, 10));
            resume.setBackground(rounded(this, 0x80000000, 24, 0x50FFFFFF, 1));
            art.addView(resume, new FrameLayout.LayoutParams(dp(this, 44), dp(this, 44), Gravity.CENTER));
            if (progress.fraction >= 0) {
                android.widget.ProgressBar track = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
                track.setMax(1000);
                track.setProgress(Math.round(progress.fraction * 1000));
                track.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
                track.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(0x55FFFFFF));
                FrameLayout.LayoutParams trackParams = new FrameLayout.LayoutParams(-1, dp(this, 3), Gravity.BOTTOM);
                trackParams.setMargins(dp(this, 10), 0, dp(this, 10), dp(this, 9));
                art.addView(track, trackParams);
            }
        }
        tile.addView(art, new LinearLayout.LayoutParams(-1, 0, 1));
        TextView name = heading(this, movie.title, 13);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(dp(this, 9), dp(this, 9), dp(this, 9), 0);
        tile.addView(name);
        TextView meta = text(this, history ? progress.label : join(movie.year, showSource ? movie.source.name : movie.type), 12, MUTED);
        meta.setSingleLine(true);
        meta.setEllipsize(TextUtils.TruncateAt.END);
        meta.setPadding(dp(this, 9), dp(this, 4), dp(this, 9), 0);
        tile.addView(meta);
        posters.loadWhenVisible(movie.cover, cover);
        return tile;
    }

    private void addSkeletonShelf() {
        shelfHeading("为你推荐", "正在载入精选内容…");
        LinearLayout row = shelfRow();
        for (int index = 0; index < 5; index++) {
            View placeholder = new View(this);
            placeholder.setBackground(rounded(this, 0xFF202024, 12, 0x0AFFFFFF, .5f));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(this, 219), dp(this, 158));
            params.rightMargin = dp(this, 14);
            row.addView(placeholder, params);
        }
    }

    private void addEmptyMessage(String headline, String description, String action, Runnable click) {
        LinearLayout block = vertical(this);
        block.setPadding(dp(this, 23), dp(this, 23), dp(this, 23), dp(this, 22));
        block.setBackground(rounded(this, 0xFF111114, 15, 0x14FFFFFF, .5f));
        block.addView(heading(this, headline, 18));
        TextView hint = text(this, description, 12, MUTED);
        hint.setPadding(0, dp(this, 9), 0, dp(this, 17));
        block.addView(hint);
        block.addView(button(this, action, view -> click.run()), new LinearLayout.LayoutParams(dp(this, 132), dp(this, 38)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(this, 22);
        cards.addView(block, params);
    }

    private void showMovies(String keyword) {
        final int token = beginPage(MOVIES);
        lastSearch = keyword == null ? "" : keyword.trim();
        if (sourceSwitchItem != null && !PlaybackState.normalize(lastSearch).equals(PlaybackState.normalize(sourceSwitchItem.title))) {
            sourceSwitchItem = null;
        }
        View searchEntry;
        if (mobileUi != null) {
            addCardsArea();
            mobileUi.beginMovies(lastSearch);
            query = mobileUi.query();
            status = mobileUi.status();
            searchEntry = query;
        } else {
            title(lastSearch.isEmpty() ? "发现好故事" : "搜索结果", "电影、剧集、纪录片，找到你想看的。 ");
            searchEntry = addSearch("搜索电影、电视剧或纪录片", lastSearch, () -> showMovies(query.getText().toString()));
            if (lastSearch.isEmpty()) {
                HorizontalScrollView suggestions = new HorizontalScrollView(this);
                suggestions.setHorizontalScrollBarEnabled(false);
                unclipped(suggestions);
                LinearLayout row = new LinearLayout(this);
                row.setPadding(dp(this, 5), dp(this, 2), 0, dp(this, 13));
                unclipped(row);
                for (String suggestion : new String[]{"科幻", "悬疑", "喜剧", "纪录片", "西游记"}) {
                    Button chip = button(this, suggestion, view -> showMovies(suggestion));
                    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(this, BuildConfig.IS_TV ? 32 : 48));
                    params.rightMargin = dp(this, 9);
                    row.addView(chip, params);
                }
                suggestions.addView(row);
                content.addView(suggestions);
            }
            addCardsArea();
        }
        if (lastSearch.isEmpty() && !discoveries.isEmpty()) renderMovies(discoveries);
        else status.setText("正在寻找好故事…");
        focusPageEntry(searchEntry);
        // Moving down from the header enters editing; submitting stays on the search action.
        linkNavigationToContent(query);
        if (BuildConfig.IS_TV && searchEntry != null) searchEntry.setNextFocusUpId(navigation.get(MOVIES).getId());
        final String requested = lastSearch;
        activeLoad = io.submit(() -> {
            TvRepository.SearchResult result = requested.isEmpty() ? repository.discover() : repository.search(requested);
            runOnUiThread(() -> {
                if (destroyed || generation != token) return;
                List<TvRepository.VodItem> items = result.items;
                if (requested.isEmpty()) {
                    if (!items.isEmpty()) {
                        discoveries = uniqueMovies(items);
                        saveMovieList("discovery_cache", discoveries, 72);
                    }
                    items = discoveries;
                }
                status.setText(items.isEmpty()
                        ? (result.warnings.isEmpty() ? "没有找到相关影片，换个片名试试。" : "暂时无法载入影片，请稍后重试。")
                        : (requested.isEmpty() ? "近期更新" : "“" + requested + "”") + "  ·  " + items.size() + " 部内容"
                        + (result.warnings.isEmpty() ? "" : "  ·  部分来源暂不可用"));
                renderMovies(items);
            });
        });
    }

    private void renderMovies(List<TvRepository.VodItem> movies) {
        if (cards == null) return;
        if (mobileUi != null) {
            mobileUi.renderMovies(movies, page == HISTORY);
            return;
        }
        View focused = getCurrentFocus();
        String tag = focused != null && focused.getTag() instanceof String ? (String) focused.getTag() : null;
        cards.removeAllViews();
        int count = Math.min(movieLimit, movies.size());
        int screenDp = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
        int columns = BuildConfig.IS_TV ? Math.max(3, Math.min(6, (screenDp - 80) / 145)) : Math.max(2, Math.min(6, screenDp / 170));
        int side = BuildConfig.IS_TV ? 80 : 24;
        int height = Math.min(340, Math.max(220, Math.round(((screenDp - side) / (float) columns - 13) * 1.43f + 52)));
        for (int start = 0; start < count; start += columns) {
            LinearLayout row = new LinearLayout(this);
            unclipped(row);
            for (int column = 0; column < columns; column++) {
                int index = start + column;
                View tile = index < count ? movieTile(movies.get(index), false, page == MOVIES && !lastSearch.isEmpty()) : new View(this);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(this, height), 1);
                params.setMargins(dp(this, 6), dp(this, 6), dp(this, 6), dp(this, 10));
                row.addView(tile, params);
            }
            cards.addView(row);
        }
        if (count == 0) addEmptyMessage("换个关键词，再找找。", "试试完整片名，也可以返回首页浏览推荐内容。", "回到首页", this::showHome);
        if (count < movies.size()) {
            Button more = button(this, "加载更多 · 还有 " + (movies.size() - count) + " 部", view -> {
                movieLimit += 60;
                renderMovies(movies);
                View next = cards.findViewWithTag(movieTag(movies.get(count)));
                if (next != null) next.requestFocus();
            });
            cards.addView(more, new LinearLayout.LayoutParams(-1, dp(this, 48)));
        }
        if (tag != null && tag.startsWith("movie:")) {
            View restore = cards.findViewWithTag(tag);
            if (restore != null) restore.requestFocus();
        }
    }

    private void openFeatured(TvRepository.VodItem movie, boolean playImmediately) {
        if (activeDetailLoad != null) activeDetailLoad.cancel(true);
        Toast.makeText(this, playImmediately ? "正在准备播放…" : "正在读取影片详情…", Toast.LENGTH_SHORT).show();
        final int token = generation;
        final int request = ++detailRequest;
        activeDetailLoad = io.submit(() -> {
            try {
                TvRepository.VideoDetails detail = repository.detail(movie);
                runOnUiThread(() -> {
                    if (destroyed || generation != token || detailRequest != request) return;
                    if (homeFeatured.contains(movie) && !TvFeaturedCatalog.matches(movie, detail.item)) {
                        Toast.makeText(this, "影片信息已更新，请从搜索确认影片", Toast.LENGTH_LONG).show();
                        return;
                    }
                    if (playImmediately && !detail.episodes.isEmpty()) playMovie(detail, -1);
                    else detailDialog(detail);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (!destroyed && generation == token && detailRequest == request)
                        Toast.makeText(this, "暂时无法播放，请查看详情或切换来源", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void showDetails(TvRepository.VodItem movie) {
        if (activeDetails != null) { activeDetails.dismiss(); activeDetails = null; }
        if (activeDetailLoad != null) activeDetailLoad.cancel(true);
        Toast.makeText(this, "正在读取影片详情…", Toast.LENGTH_SHORT).show();
        final int token = generation;
        final int request = ++detailRequest;
        activeDetailLoad = io.submit(() -> {
            try {
                TvRepository.VideoDetails detail = repository.detail(movie);
                runOnUiThread(() -> {
                    if (!destroyed && generation == token && detailRequest == request) {
                        migratePlaybackSelection(detail);
                        detailDialog(detail);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (destroyed || generation != token || detailRequest != request) return;
                    AlertDialog dialog = new AlertDialog.Builder(this).setTitle("这个来源暂时无法播放")
                            .setMessage("搜索同一片名，选择其他来源继续观看。")
                            .setPositiveButton("搜索其他来源", (window, which) -> showMovies(movie.title))
                            .setNeutralButton("重试", (window, which) -> showDetails(movie))
                            .setNegativeButton("返回", null).create();
                    TvUi.showDialog(dialog, 540);
                });
            }
        });
    }

    private void mobileDetailDialog(TvRepository.VideoDetails detail) {
        activeDetails = mobileUi.showDetails(detail, detailSelectedIndex(detail), detailPlayLabel(detail),
                detailContinuityHint(detail), detailRequiresChoice(detail), index -> playMovie(detail, index));
    }

    private void detailDialog(TvRepository.VideoDetails detail) {
        if (!BuildConfig.IS_TV) {
            mobileDetailDialog(detail);
            return;
        }
        FrameLayout surface = new FrameLayout(this) {
            @Override protected void onMeasure(int widthSpec, int heightSpec) {
                View body = findViewWithTag("dialog:content");
                if (body == null) { super.onMeasure(widthSpec, heightSpec); return; }
                measureChildWithMargins(body, widthSpec, 0, heightSpec, 0);
                int height = View.resolveSize(body.getMeasuredHeight() + getPaddingTop() + getPaddingBottom(), heightSpec);
                super.onMeasure(widthSpec, View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
            }
        };
        surface.setBackground(rounded(this, 0xFF111114, 23, 0x24FFFFFF, 1));
        surface.setClipToOutline(true);
        ImageView artwork = new ImageView(this);
        artwork.setScaleType(ImageView.ScaleType.CENTER_CROP);
        artwork.setAlpha(.78f);
        surface.addView(artwork, new FrameLayout.LayoutParams(-1, -1));
        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xEE111114, 0xCD111114, 0x68111114}));
        surface.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout body = vertical(this);
        body.setTag("dialog:content");
        body.setPadding(dp(this, 27), dp(this, 27), dp(this, 27), dp(this, 23));
        LinearLayout overview = new LinearLayout(this);
        unclipped(overview);
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setBackground(rounded(this, SURFACE, 9, 0x20FFFFFF, 1));
        poster.setClipToOutline(true);
        overview.addView(poster, new LinearLayout.LayoutParams(dp(this, 115), dp(this, 170)));
        posters.load(detail.item.cover, poster);
        LinearLayout information = vertical(this);
        information.setPadding(dp(this, 25), dp(this, 2), dp(this, 22), 0);
        TextView name = heading(this, detail.item.title, 34);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setLetterSpacing(-.035f);
        information.addView(name);
        TextView metadata = text(this, join(detail.item.year, detail.item.type, detail.item.remarks) + "  ·  " + detail.episodes.size() + " 集", 11, 0xFFD0D0D8);
        metadata.setSingleLine(true);
        metadata.setEllipsize(TextUtils.TruncateAt.END);
        metadata.setPadding(0, dp(this, 8), 0, 0);
        information.addView(metadata);
        TextView description = text(this, detail.description.isEmpty() ? "好故事，即将开始。" : detail.description, 12, MUTED);
        description.setMaxLines(3);
        description.setEllipsize(TextUtils.TruncateAt.END);
        description.setLineSpacing(dp(this, 2), 1);
        description.setPadding(0, dp(this, 10), 0, dp(this, 14));
        information.addView(description);
        LinearLayout actions = new LinearLayout(this);
        unclipped(actions);
        final AlertDialog[] holder = new AlertDialog[1];
        final View[] firstEpisode = new View[1];
        Button play = primaryButton(detailPlayLabel(detail), view -> {
            if (detailRequiresChoice(detail) && firstEpisode[0] != null) firstEpisode[0].requestFocus();
            else { holder[0].dismiss(); playMovie(detail, -1); }
        });
        play.setSingleLine(true);
        play.setEllipsize(TextUtils.TruncateAt.END);
        actions.addView(play, new LinearLayout.LayoutParams(dp(this, 155), dp(this, 38)));
        Button alternative = button(this, "其他来源", view -> { holder[0].dismiss(); showMovies(detail.item.title); });
        LinearLayout.LayoutParams alternativeParams = new LinearLayout.LayoutParams(dp(this, 112), dp(this, 38));
        alternativeParams.leftMargin = dp(this, 11);
        actions.addView(alternative, alternativeParams);
        information.addView(actions);
        overview.addView(information, new LinearLayout.LayoutParams(0, -2, 1));
        body.addView(overview);
        String continuityHint = detailContinuityHint(detail);
        if (!continuityHint.isEmpty()) {
            TextView hint = text(this, continuityHint, 12, MUTED);
            hint.setPadding(0, dp(this, 12), 0, 0);
            body.addView(hint);
        }
        TextView episodesTitle = heading(this, "选择剧集", 17);
        episodesTitle.setPadding(0, dp(this, 20), 0, dp(this, 10));
        body.addView(episodesTitle);
        ScrollView scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setPadding(dp(this, 3), dp(this, 3), dp(this, 3), dp(this, 6));
        unclipped(scroll);
        LinearLayout episodes = vertical(this);
        for (int start = 0; start < detail.episodes.size(); start += 5) {
            LinearLayout row = new LinearLayout(this);
            unclipped(row);
            for (int column = 0; column < 5; column++) {
                final int index = start + column;
                View item;
                if (index < detail.episodes.size()) {
                    Button episode = button(this, detail.episodes.get(index).name, view -> { holder[0].dismiss(); playMovie(detail, index); });
                    episode.setSingleLine(true);
                    episode.setEllipsize(TextUtils.TruncateAt.END);
                    episode.setTextSize(12);
                    episode.setSelected(index == detailSelectedIndex(detail));
                    episode.setContentDescription(detail.episodes.get(index).name + (episode.isSelected() ? "，上次观看" : ""));
                    if (index == 0) firstEpisode[0] = episode;
                    item = episode;
                } else item = new View(this);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(this, 37), 1);
                params.setMargins(dp(this, 4), dp(this, 4), dp(this, 4), dp(this, 4));
                row.addView(item, params);
            }
            episodes.addView(row);
        }
        scroll.addView(episodes);
        int episodeHeight = Math.min(130, Math.max(49, ((detail.episodes.size() + 4) / 5) * 45 + 8));
        body.addView(scroll, new LinearLayout.LayoutParams(-1, dp(this, episodeHeight)));
        TextView source = text(this, "当前来源：" + detail.item.source.name, 10, 0xFF898991);
        source.setPadding(dp(this, 3), dp(this, 10), 0, 0);
        body.addView(source);
        surface.addView(body, new FrameLayout.LayoutParams(-1, -2));
        Button close = button(this, "×", view -> holder[0].dismiss());
        close.setTextSize(23);
        close.setPadding(0, 0, 0, 0);
        close.setContentDescription("关闭影片详情");
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(this, 30), dp(this, 30), Gravity.END | Gravity.TOP);
        closeParams.setMargins(0, dp(this, 12), dp(this, 12), 0);
        surface.addView(close, closeParams);
        holder[0] = new AlertDialog.Builder(this).setView(surface).create();
        TvUi.showDialog(holder[0], 850);
        activeDetails = holder[0];
        DetailArtwork.bind(artworkRepository, posters, detail, artwork, holder[0]);
        play.requestFocus();
    }

    private void playMovie(TvRepository.VideoDetails detail, int index) {
        int handoffIndex = sourceSwitchIndex(detail);
        if (index < 0 && detailRequiresChoice(detail)) {
            Toast.makeText(this, "请核对影片并选择对应剧集继续", Toast.LENGTH_LONG).show();
            detailDialog(detail);
            return;
        }
        boolean transfer = handoffIndex >= 0 && (index < 0 || index == handoffIndex);
        if (transfer) index = handoffIndex;
        remember(detail.item);
        ArrayList<String> names = new ArrayList<>(), urls = new ArrayList<>();
        for (TvRepository.Episode episode : detail.episodes) { names.add(episode.name); urls.add(episode.url); }
        Intent intent = playerIntent(detail.item.title, names, urls, index, false);
        intent.putExtra("searchTitle", detail.item.title);
        intent.putExtra("contentKey", PlaybackState.contentKey(detail.item));
        try { intent.putExtra("contentItem", detail.item.toHistory().toString()); } catch (Exception ignored) { }
        if (transfer) intent.putExtra("resumePosition", sourceSwitchPosition);
        sourceSwitchItem = null;
        startActivityForResult(intent, PLAYER_REQUEST);
    }

    private int sourceSwitchIndex(TvRepository.VideoDetails detail) {
        return PlaybackState.sameContent(sourceSwitchItem, detail.item)
                ? PlaybackState.matchingEpisode(detail.episodes, sourceSwitchEpisode, sourceSwitchCount) : -1;
    }

    private int detailSelectedIndex(TvRepository.VideoDetails detail) {
        int handoff = sourceSwitchIndex(detail);
        return handoff >= 0 ? handoff : watchProgress(this, detail.item).index;
    }

    private String detailPlayLabel(TvRepository.VideoDetails detail) {
        int handoff = sourceSwitchIndex(detail);
        if (handoff >= 0) return "继续 " + detail.episodes.get(handoff).name;
        if (detailRequiresChoice(detail)) return "选择剧集";
        WatchProgress progress = watchProgress(this, detail.item);
        return progress.index >= 0 ? "继续观看" : "开始播放";
    }

    private boolean detailRequiresChoice(TvRepository.VideoDetails detail) {
        return sourceSwitchItem != null && sourceSwitchIndex(detail) < 0;
    }

    private String detailContinuityHint(TvRepository.VideoDetails detail) {
        if (sourceSwitchItem == null) return "";
        int index = sourceSwitchIndex(detail);
        if (index >= 0) return "已对齐上次观看的 " + detail.episodes.get(index).name
                + (sourceSwitchPosition > 0 ? "，将从 " + sourceSwitchPosition / 60_000 + " 分 " + sourceSwitchPosition / 1_000 % 60 + " 秒继续。" : "。 ");
        return "无法自动对齐原影片与剧集，请核对片名、年份并选择对应剧集；原来源进度已保留。";
    }

    private void migratePlaybackSelection(TvRepository.VideoDetails detail) {
        SharedPreferences playback = getSharedPreferences("kongwotv_playback", MODE_PRIVATE);
        String key = PlaybackState.contentKey(detail.item);
        if (playback.contains("selected_url_" + key)) return;
        String legacy = PlaybackState.digest("vod|" + detail.item.title);
        String url = playback.getString("selected_url_" + legacy, "");
        for (int index = 0; index < detail.episodes.size(); index++) {
            TvRepository.Episode episode = detail.episodes.get(index);
            if (episode.url.equals(url)) {
                playback.edit().putString("selected_url_" + key, url).putInt("selected_index_" + key, index)
                        .putString("selected_name_" + key, episode.name).apply();
                return;
            }
        }
    }

    private void restoreSourceSwitch(String item, String episode, int count, long position) {
        sourceSwitchItem = null;
        try { if (item != null && !item.isEmpty()) sourceSwitchItem = TvRepository.VodItem.fromHistory(new JSONObject(item)); }
        catch (Exception ignored) { }
        sourceSwitchEpisode = episode == null ? "" : episode;
        sourceSwitchCount = Math.max(0, count);
        sourceSwitchPosition = Math.max(0L, position);
    }

    private Intent playerIntent(String title, ArrayList<String> names, ArrayList<String> urls, int index, boolean live) {
        return new Intent(this, PlaybackActivity.class).putStringArrayListExtra("names", names)
                .putStringArrayListExtra("urls", urls).putExtra("title", title).putExtra("index", index).putExtra("live", live);
    }

    private void showLive() {
        final int token = beginPage(LIVE);
        if (mobileUi != null) {
            addCardsArea();
            mobileUi.beginLive(liveQuery, liveFilter);
            query = mobileUi.query();
            status = mobileUi.status();
        } else {
            title("电视直播", "此刻，正在发生。");
            addSearch("查找频道，例如 CCTV、卫视", liveQuery, () -> { liveQuery = query.getText().toString(); renderChannels(); });
            query.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                public void onTextChanged(CharSequence s, int start, int before, int count) { liveQuery = s.toString(); renderChannels(); }
                public void afterTextChanged(Editable value) {}
            });
            LinearLayout groups = new LinearLayout(this);
            groups.setPadding(dp(this, 5), dp(this, 2), 0, dp(this, 12));
            unclipped(groups);
            for (String group : new String[]{"全部", "央视", "卫视", "地方"}) {
                Button chip = button(this, group, view -> {
                    liveFilter = group;
                    for (int i = 0; i < groups.getChildCount(); i++) {
                        View child = groups.getChildAt(i);
                        child.setSelected(child.getTag().equals(group));
                    }
                    renderChannels();
                });
                chip.setTag(group);
                chip.setSelected(group.equals(liveFilter));
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(this, BuildConfig.IS_TV ? 31 : 48), 1);
                params.rightMargin = dp(this, 9);
                groups.addView(chip, params);
            }
            content.addView(groups);
            addCardsArea();
        }
        renderChannels();
        focusPageEntry(cards);
        activeLoad = io.submit(() -> {
            List<TvRepository.Channel> fresh = repository.refreshChannels();
            runOnUiThread(() -> {
                if (destroyed || generation != token || fresh.isEmpty()) return;
                channels = fresh;
                renderChannels();
            });
        });
    }

    private void renderChannels() {
        if (page != LIVE || cards == null) return;
        View focused = getCurrentFocus();
        String focusedTag = focused != null && focused.getTag() instanceof String ? (String) focused.getTag() : null;
        ArrayList<TvRepository.Channel> visible = new ArrayList<>();
        String filter = liveQuery.trim().toLowerCase(Locale.ROOT);
        for (TvRepository.Channel channel : channels) {
            String name = channelName(channel.name);
            String type = liveCategory(channel);
            if ((!liveFilter.equals("全部") && !liveFilter.equals(type)) || (!filter.isEmpty() && !(name + channel.name).toLowerCase(Locale.ROOT).contains(filter))) continue;
            visible.add(channel);
        }
        status.setText(visible.size() + " 个频道  ·  随时切换，随心观看");
        if (mobileUi != null) {
            mobileUi.renderChannels(visible);
            return;
        }
        cards.removeAllViews();
        int columns = BuildConfig.IS_TV ? 4 : Math.max(2, Math.min(5, getResources().getConfiguration().screenWidthDp / 180));
        for (int start = 0; start < visible.size(); start += columns) {
            LinearLayout row = new LinearLayout(this);
            unclipped(row);
            for (int column = 0; column < columns; column++) {
                final int index = start + column;
                View tile = index < visible.size() ? channelTile(visible.get(index), index + 1, () -> playChannels(visible, index)) : new View(this);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(this, 101), 1);
                params.setMargins(dp(this, 6), dp(this, 6), dp(this, 6), dp(this, 10));
                row.addView(tile, params);
            }
            cards.addView(row);
        }
        if (focusedTag != null && focusedTag.startsWith("channel:")) {
            View restore = cards.findViewWithTag(focusedTag);
            if (restore != null) restore.requestFocus();
        }
        if (visible.isEmpty()) addEmptyMessage("没有匹配的频道", "选择“全部”，或尝试其他频道名称。", "显示全部", () -> { liveQuery = ""; liveFilter = "全部"; showLive(); });
    }

    private View channelTile(TvRepository.Channel channel, int number, Runnable action) {
        String category = liveCategory(channel);
        int color = SURFACE;
        LinearLayout tile = vertical(this);
        tile.setPadding(dp(this, 15), dp(this, 12), dp(this, 15), dp(this, 12));
        tile.setBackground(cardBackground(this, color, 13));
        tile.setTag("channel:" + channel.url);
        tile.setContentDescription(channelName(channel.name) + "，" + category + "频道，确认播放");
        tile.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        focusable(tile, 1.055f);
        tile.setOnClickListener(view -> action.run());
        LinearLayout line = new LinearLayout(this);
        line.setGravity(Gravity.CENTER_VERTICAL);
        TextView index = text(this, String.format(Locale.ROOT, "%02d", number), 10, 0xFF97979F);
        line.addView(index, new LinearLayout.LayoutParams(0, -2, 1));
        TextView live = text(this, "●  LIVE", 9, LIVE_GREEN);
        live.setLetterSpacing(.1f);
        line.addView(live);
        tile.addView(line);
        TextView name = heading(this, channelName(channel.name), 17);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(0, dp(this, 10), 0, dp(this, 6));
        tile.addView(name);
        tile.addView(text(this, category + "频道", 10, MUTED));
        return tile;
    }

    private void addChannelShelf() {
        shelfHeading("正在直播", "打开电视，遇见此刻");
        LinearLayout row = shelfRow();
        int count = Math.min(10, channels.size());
        for (int index = 0; index < count; index++) {
            final int selected = index;
            View tile = channelTile(channels.get(index), index + 1, () -> playChannels(channels, selected));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(this, 187), dp(this, 104));
            params.rightMargin = dp(this, 13);
            row.addView(tile, params);
        }
    }

    private void playChannels(List<TvRepository.Channel> available, int index) {
        ArrayList<String> names = new ArrayList<>(), urls = new ArrayList<>();
        for (TvRepository.Channel channel : available) { names.add(channelName(channel.name)); urls.add(channel.url); }
        startActivityForResult(playerIntent("电视直播", names, urls, index, true), PLAYER_REQUEST);
    }

    private void showHistory() {
        beginPage(HISTORY);
        if (mobileUi != null) {
            addCardsArea();
            mobileUi.beginHistory();
            status = mobileUi.status();
        } else {
            title("你的资料库", "看过的故事，都在这里。");
            addCardsArea();
        }
        List<TvRepository.VodItem> history = historyItems();
        if (mobileUi != null) {
            status.setText(history.size() + " 部观看记录  ·  选择影片继续观看");
            renderMovies(history);
        } else if (history.isEmpty()) addEmptyMessage("好故事，从第一次播放开始。", "观看过的影片会保存在这里，随时回来继续。", "探索影视", () -> showMovies(""));
        else {
            status.setText(history.size() + " 部观看记录  ·  选择影片继续观看");
            renderMovies(history);
        }
        focusPageEntry(cards);
    }

    private List<TvRepository.VodItem> historyItems() { return readMovieList("history"); }

    private List<TvRepository.VodItem> readHomeFeatured() {
        try (InputStream input = getAssets().open("home-featured.json");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 64 * 1024) return new ArrayList<>();
                output.write(buffer, 0, count);
            }
            return TvFeaturedCatalog.parse(new String(output.toByteArray(), StandardCharsets.UTF_8), repository.getSources());
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private List<TvRepository.VodItem> readMovieList(String key) {
        ArrayList<TvRepository.VodItem> result = new ArrayList<>();
        try {
            JSONArray values = new JSONArray(preferences.getString(key, "[]"));
            for (int index = 0; index < values.length(); index++) {
                JSONObject item = values.optJSONObject(index);
                if (item == null) continue;
                result.add(TvRepository.VodItem.fromHistory(item));
            }
        } catch (Exception ignored) { }
        return result;
    }

    private void saveMovieList(String key, List<TvRepository.VodItem> items, int limit) {
        try {
            JSONArray output = new JSONArray();
            for (int index = 0; index < Math.min(limit, items.size()); index++) {
                TvRepository.VodItem item = items.get(index);
                output.put(item.toHistory());
            }
            preferences.edit().putString(key, output.toString()).apply();
        } catch (Exception ignored) { }
    }

    private void remember(TvRepository.VodItem movie) {
        ArrayList<TvRepository.VodItem> values = new ArrayList<>();
        values.add(movie);
        for (TvRepository.VodItem old : historyItems()) {
            if (!(old.id.equals(movie.id) && old.source.url.equals(movie.source.url)) && values.size() < 60) values.add(old);
        }
        saveMovieList("history", values, 60);
    }

    private void showSettings() {
        beginPage(SETTINGS);
        if (mobileUi != null) {
            addCardsArea();
            mobileUi.renderSettings(repository.getSources(), repository.getLiveSubscriptions());
            return;
        }
        title("设置", "让每一段观影时光，都恰到好处。");
        addCardsArea();
        LinearLayout sources = settingsCard("内容来源", "已经为你准备好，打开就能看。");
        for (TvRepository.Source source : repository.getSources()) sources.addView(settingLabel("●  " + source.name, "电影与电视剧"));
        for (TvRepository.Source source : repository.getLiveSubscriptions()) sources.addView(settingLabel("●  " + source.name, "电视直播目录"));
        LinearLayout playback = settingsCard("观看与资料库", "播放进度和观看记录保存在这台设备上。");
        Button refresh = button(this, "刷新直播频道", view -> { Toast.makeText(this, "正在刷新频道…", Toast.LENGTH_SHORT).show(); showLive(); });
        playback.addView(refresh, new LinearLayout.LayoutParams(dp(this, 210), dp(this, BuildConfig.IS_TV ? 39 : 48)));
        Button clear = button(this, "清空观看记录", view -> confirmClearHistory());
        LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(dp(this, 210), dp(this, BuildConfig.IS_TV ? 39 : 48));
        clearParams.topMargin = dp(this, 11);
        playback.addView(clear, clearParams);
        LinearLayout artwork = settingsCard("高清图片 / TMDB", "独立横图用于影片详情，海报保留原来源。凭据为可选项。");
        artwork.addView(ArtworkSettings.content(this, artworkRepository));
        LinearLayout remote = settingsCard(BuildConfig.IS_TV ? "为遥控器而设计" : "为触摸屏而设计", BuildConfig.IS_TV ? "方向键移动  ·  确认键选择  ·  返回键回到首页" : "轻触导航与封面，滑动浏览更多内容。");
        TextView keys = text(this, BuildConfig.IS_TV ? "点播播放时，左右键快进 / 快退，菜单键选集。\n直播播放时，上下键换台，菜单键打开频道列表。" : "竖屏或横屏浏览，播放时自动切换横屏。\n轻触画面显示控制，拖动进度条跳转，点击选集 / 频道列表切换。", 12, MUTED);
        keys.setLineSpacing(dp(this, 5), 1);
        remote.addView(keys);
        TextView about = text(this, "幕里  ·  " + BuildConfig.VERSION_NAME, 11, 0xFF818189);
        about.setPadding(dp(this, 8), dp(this, 20), 0, dp(this, 20));
        cards.addView(about);
        focusPageEntry(cards);
    }

    private void confirmClearHistory() {
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("清空观看记录？")
                .setMessage("将移除这台设备上的观看记录、已选集数和播放进度。播放偏好会保留。")
                .setPositiveButton("清空", (window, which) -> {
                    preferences.edit().remove("history").apply();
                    SharedPreferences playback = getSharedPreferences("kongwotv_playback", MODE_PRIVATE);
                    SharedPreferences.Editor editor = playback.edit();
                    for (String key : playback.getAll().keySet()) {
                        if (key.startsWith("selected_") || key.startsWith("position_") || key.startsWith("duration_")) editor.remove(key);
                    }
                    editor.apply();
                    sourceSwitchItem = null;
                    if (page == HISTORY) showHistory();
                    else if (page == HOME) renderHome(discoveries, false);
                    Toast.makeText(this, "观看记录已清空", Toast.LENGTH_SHORT).show();
                }).setNegativeButton("取消", null).create();
        TvUi.showDialog(dialog, 510);
    }

    private LinearLayout settingsCard(String title, String description) {
        LinearLayout block = vertical(this);
        block.setPadding(dp(this, 22), dp(this, 20), dp(this, 22), dp(this, 21));
        block.setBackground(rounded(this, 0xFF111114, 15, 0x18FFFFFF, .6f));
        block.addView(heading(this, title, 19));
        TextView subtitle = text(this, description, 12, MUTED);
        subtitle.setPadding(0, dp(this, 8), 0, dp(this, 18));
        block.addView(subtitle);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(dp(this, 5), dp(this, 4), dp(this, 5), dp(this, 12));
        cards.addView(block, params);
        return block;
    }

    private View settingLabel(String name, String detail) {
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, 0, 0, dp(this, 12));
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = text(this, name, 12, 0xFFE1E1E7);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(text(this, detail, 11, 0xFF888891));
        return row;
    }

    private static List<TvRepository.VodItem> uniqueMovies(List<TvRepository.VodItem> items) {
        ArrayList<TvRepository.VodItem> result = new ArrayList<>();
        LinkedHashSet<String> titles = new LinkedHashSet<>();
        for (TvRepository.VodItem item : items) {
            String key = PlaybackState.discoveryKey(item);
            if (titles.add(key)) result.add(item);
        }
        return result;
    }

    private static String movieTag(TvRepository.VodItem movie) { return "movie:" + movie.source.url + "#" + movie.id; }

    private static String liveCategory(TvRepository.Channel channel) {
        String value = (channel.name + " " + channel.group).toUpperCase(Locale.ROOT);
        if (value.contains("CCTV") || value.contains("CGTN") || value.contains("央视")) return "央视";
        if (value.contains("SATELLITE") || value.contains("卫视")) return "卫视";
        return "地方";
    }

    private static String channelName(String name) {
        String[][] aliases = {{"Beijing Satellite TV", "北京卫视"}, {"Anhui TV", "安徽卫视"}, {"Guangdong Satellite TV", "广东卫视"},
                {"Dragon TV International", "东方卫视国际"}, {"Hunan TV", "湖南卫视"}, {"Jiangsu TV", "江苏卫视"}, {"Zhejiang TV", "浙江卫视"},
                {"Henan TV", "河南卫视"}, {"Hebei TV", "河北卫视"}, {"Dongguan Comprehensive News Channel", "东莞新闻综合"},
                {"Guangzhou TV", "广州综合"}, {"China Weather Channel", "中国气象频道"}};
        for (String[] alias : aliases) if (name.startsWith(alias[0])) return alias[1];
        return name.replace(" [Not 24/7]", "").replace(" [Geo-blocked]", "").replaceAll("(?i)\\s*\\(\\d+[pi]\\)", "");
    }

    private static String join(String... parts) {
        StringBuilder result = new StringBuilder();
        for (String part : parts) if (part != null && !part.trim().isEmpty()) {
            if (result.length() > 0) result.append(" · ");
            result.append(part.trim());
        }
        return result.toString();
    }

    private void hideKeyboard() {
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(getWindow().getDecorView().getWindowToken(), 0);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PLAYER_REQUEST && resultCode == RESULT_OK && data != null && data.hasExtra("retry_search")) {
            String requested = data.getStringExtra("retry_search");
            restoreSourceSwitch(data.getStringExtra("retry_item"), data.getStringExtra("retry_episode"),
                    data.getIntExtra("retry_count", 0), data.getLongExtra("retry_position", 0L));
            if (data.getBooleanExtra("retry_live", false)) showLive();
            else showMovies(requested);
        } else if (requestCode == PLAYER_REQUEST) {
            if (page == HOME) renderHome(discoveries, false);
            else if (page == HISTORY) showHistory();
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (mobileUi != null) mobileUi.saveState(state);
        state.putInt("page", page);
        state.putString("search", lastSearch);
        state.putString("live_filter", liveFilter);
        state.putString("live_query", liveQuery);
        if (sourceSwitchItem != null) {
            try { state.putString("switch_item", sourceSwitchItem.toHistory().toString()); } catch (Exception ignored) { }
            state.putString("switch_episode", sourceSwitchEpisode);
            state.putInt("switch_count", sourceSwitchCount);
            state.putLong("switch_position", sourceSwitchPosition);
        }
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        if (page == LIVE && (!liveQuery.isEmpty() || !liveFilter.equals("全部"))) {
            liveQuery = "";
            liveFilter = "全部";
            showLive();
            if (BuildConfig.IS_TV) navigation.get(LIVE).requestFocus();
        } else if (page != HOME) {
            showHome();
            if (BuildConfig.IS_TV) navigation.get(HOME).requestFocus();
        } else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        io.shutdownNow();
        if (activeDetails != null) activeDetails.dismiss();
        artworkRepository.close();
        posters.close();
        super.onDestroy();
    }
}
