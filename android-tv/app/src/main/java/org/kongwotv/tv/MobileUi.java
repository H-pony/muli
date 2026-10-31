package org.kongwotv.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
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
import android.widget.TextView;

import org.json.JSONArray;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

import static org.kongwotv.tv.TvUi.*;

/** Native phone/tablet presentation of the web cinema, discovery and catalogue styles. */
final class MobileUi {
    interface Actions {
        void home();
        void browse(String keyword);
        void live();
        void history();
        void settings();
        void details(TvRepository.VodItem item);
        void playChannels(List<TvRepository.Channel> channels, int index);
        void liveFilter(String group);
        void liveQuery(String value);
        void refreshLive();
        void clearHistory();
    }
    interface EpisodeAction { void play(int index); }
    private interface ChoiceAction { void select(String value); }

    private static final int FAINT = 0xFF929299;
    private static final int CHIP = 0xFF232327;
    private static final int LINE = 0xFF333338;
    private static final int MOBILE_SURFACE = 0xFF111114;
    private static final String ALL = "全部", ALL_YEARS = "全部年份", ALL_SOURCES = "全部来源";
    private static final String[] KINDS = {ALL, "电影", "剧集", "综艺", "动漫", "纪录片"};
    private final Activity activity;
    private final PosterLoader posters;
    private final ArtworkRepository artworkRepository;
    private final Actions actions;
    private final SharedPreferences homePreferences;
    private final LinearLayout content;
    private final ArrayList<Button> navigation = new ArrayList<>();
    private Button searchTool;
    private LinearLayout body, resultHost, filters, kindHost;
    private ScrollView scroll;
    private TextView status, resultCount;
    private EditText query;
    private List<TvRepository.VodItem> movieData = new ArrayList<>();
    private String browseKind = ALL, browseYear = ALL_YEARS, browseSource = ALL_SOURCES;
    private String browseOrder = "近期更新", keyword = "";
    private int page;
    private int movieLimit = 120;
    private boolean searchFocusRequested;

    MobileUi(Activity activity, PosterLoader posters, ArtworkRepository artworkRepository, Actions actions) {
        this.activity = activity;
        this.posters = posters;
        this.artworkRepository = artworkRepository;
        this.actions = actions;
        homePreferences = activity.getSharedPreferences("kongwotv_home", Context.MODE_PRIVATE);
        content = vertical(activity);
    }

    LinearLayout content() { return content; }
    EditText query() { return query; }
    TextView status() { return status; }
    private int px(float value) { return dp(activity, value); }
    private int widthDp() { return activity.getResources().getConfiguration().screenWidthDp; }
    private boolean narrow() { return widthDp() < 600; }
    private int gutter() { return narrow() ? 20 : widthDp() < 840 ? 30 : 44; }

    View frame() {
        Window window = activity.getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.setStatusBarColor(BACKGROUND);
        window.setNavigationBarColor(BACKGROUND);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        if (Build.VERSION.SDK_INT >= 29) window.setNavigationBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
        LinearLayout root = vertical(activity);
        root.setClipChildren(true);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout header = new LinearLayout(activity);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(px(gutter()), px(5), px(gutter()), px(7));
        header.setBackgroundColor(BACKGROUND);
        TextView brand = heading(activity, "幕里", 22);
        brand.setLetterSpacing(-.04f);
        brand.setContentDescription("幕里，返回首页");
        touch(brand);
        brand.setOnClickListener(view -> actions.home());
        header.addView(brand, new LinearLayout.LayoutParams(0, px(44), 1));
        searchTool = iconButton(activity, MobileIcons.Kind.SEARCH, "搜索影片", view -> {
            searchFocusRequested = true;
            browseKind = ALL;
            actions.browse("");
        });
        header.addView(searchTool, new LinearLayout.LayoutParams(px(44), px(44)));
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout dock = vertical(activity);
        dock.setBackgroundColor(MOBILE_SURFACE);
        View divider = new View(activity);
        divider.setBackgroundColor(0x18FFFFFF);
        dock.addView(divider, new LinearLayout.LayoutParams(-1, px(1)));
        LinearLayout tabs = new LinearLayout(activity);
        tabs.setGravity(Gravity.CENTER);
        tabs.setPadding(px(narrow() ? 8 : gutter()), px(7), px(narrow() ? 8 : gutter()), px(5));
        String[] labels = {"首页", "搜索", "直播", "资料库", "设置"};
        int[] targets = {0, 2, 1, 3, 4};
        MobileIcons.Kind[] icons = {MobileIcons.Kind.HOME, MobileIcons.Kind.SEARCH,
                MobileIcons.Kind.LIVE, MobileIcons.Kind.HISTORY, MobileIcons.Kind.SETTINGS};
        for (int index = 0; index < labels.length; index++) {
            final int target = targets[index];
            Button tab = button(activity, labels[index], null, false, false, view -> {
                searchFocusRequested = false;
                if (target == 0) actions.home();
                else if (target == 1) actions.live();
                else if (target == 3) actions.history();
                else if (target == 4) actions.settings();
                else {
                    browseKind = ALL;
                    resetFilters();
                    actions.browse("");
                }
            });
            ColorStateList colors = new ColorStateList(new int[][]{{android.R.attr.state_selected}, {}},
                    new int[]{TEXT, FAINT});
            tab.setTextColor(colors);
            tab.setTextSize(10);
            tab.setPadding(0, px(4), 0, px(3));
            tab.setBackground(touchBackground(activity, Color.TRANSPARENT, 12, false));
            Drawable icon = new MobileIcons(activity, icons[index], colors, 21);
            icon.setBounds(0, 0, px(21), px(21));
            tab.setCompoundDrawablesRelative(null, icon, null, null);
            tab.setCompoundDrawablePadding(px(5));
            tab.setContentDescription(labels[index] + "页面");
            tab.setTag("navigation:" + target);
            navigation.add(tab);
            int tabHeight = Math.max(55, Math.round(43 + 12 * activity.getResources().getConfiguration().fontScale));
            tabs.addView(tab, new LinearLayout.LayoutParams(0, px(tabHeight), 1));
        }
        dock.addView(tabs, new LinearLayout.LayoutParams(-1, -2));
        root.addView(dock, new LinearLayout.LayoutParams(-1, -2));
        root.post(root::requestApplyInsets);
        return root;
    }

    void selectPage(int target) {
        page = target;
        updateNavigation();
        query = null;
        status = null;
        resultHost = null;
        filters = null;
        kindHost = null;
    }

    private void updateNavigation() {
        int[] targets = {0, 2, 1, 3, 4};
        for (int index = 0; index < navigation.size(); index++) {
            Button tab = navigation.get(index);
            tab.setSelected(page == targets[index]);
            tab.setContentDescription(tab.getText() + "页面" + (tab.isSelected() ? "，已选中" : ""));
        }
        if (searchTool != null) searchTool.setSelected(page == 2 && !keyword.isEmpty());
    }

    void attachPage(LinearLayout body, ScrollView scroll) {
        this.body = body;
        this.scroll = scroll;
        body.setPadding(px(gutter()), px(12), px(gutter()), px(40));
        body.setFocusableInTouchMode(true);
        scroll.setPadding(0, 0, 0, 0);
    }

    void saveState(Bundle state) {
        state.putString("mobile_keyword", keyword);
        state.putString("mobile_kind", browseKind);
        state.putString("mobile_year", browseYear);
        state.putString("mobile_source", browseSource);
        state.putString("mobile_order", browseOrder);
    }

    void restoreState(Bundle state) {
        keyword = state.getString("mobile_keyword", "");
        browseKind = state.getString("mobile_kind", ALL);
        browseYear = state.getString("mobile_year", ALL_YEARS);
        browseSource = state.getString("mobile_source", ALL_SOURCES);
        browseOrder = state.getString("mobile_order", "近期更新");
    }

    void renderHome(List<TvRepository.VodItem> movies, List<TvRepository.VodItem> history,
                    List<TvRepository.Channel> channels, boolean loading) {
        int oldY = scroll.getScrollY();
        String typed = query == null ? "" : query.getText().toString();
        boolean typing = query != null && query.hasFocus();
        body.removeAllViews();
        int screenHeight = activity.getResources().getConfiguration().screenHeightDp;
        int heroHeight = narrow() ? Math.max(390, Math.min(560, Math.round(screenHeight * .72f)))
                : Math.max(330, Math.min(470, Math.round(screenHeight * .62f)));
        TvRepository.VodItem featured = movies.isEmpty() ? null : movies.get(0);
        for (TvRepository.VodItem item : movies) if (!item.cover.isEmpty()) { featured = item; break; }
        LinearLayout.LayoutParams heroParams = new LinearLayout.LayoutParams(-1, px(heroHeight));
        heroParams.setMargins(-px(gutter()), -px(12), -px(gutter()), 0);
        body.addView(hero(featured), heroParams);
        LinearLayout.LayoutParams dock = new LinearLayout.LayoutParams(-1, px(48));
        dock.setMargins(0, px(24), 0, px(4));
        body.addView(searchField("搜索影片、剧集…", typed, value -> actions.browse(value), null), dock);
        if (!history.isEmpty()) addPosterShelf("继续观看", "接着上次的故事", history, true);
        if (!movies.isEmpty()) {
            addPosterShelf("为你推荐", "发现下一部好故事", movies.subList(0, Math.min(14, movies.size())), false);
        } else if (loading) {
            addShelfHeading("为你推荐", "正在载入精选内容…", () -> actions.browse(""));
            LinearLayout row = shelfRow();
            for (int i = 0; i < 5; i++) {
                View skeleton = skeleton();
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(px(posterWidth()), px(posterWidth() * 1.4f));
                params.rightMargin = px(12);
                row.addView(skeleton, params);
            }
        } else {
            empty(body, "暂时还没有载入影片", "试试搜索片名，或先打开电视直播。", "搜索影视", () -> actions.browse(""));
        }
        addLiveRibbon();
        if (!channels.isEmpty()) {
            addShelfHeading("正在直播", "打开电视，遇见此刻", actions::live);
            LinearLayout row = shelfRow();
            for (int i = 0; i < Math.min(10, channels.size()); i++) {
                final int selected = i;
                View channel = channelTile(channels.get(i), i + 1, () -> actions.playChannels(channels, selected));
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(px(narrow() ? 168 : 198), px(128));
                params.rightMargin = px(12);
                row.addView(channel, params);
            }
        }
        ArrayList<TvRepository.VodItem> films = new ArrayList<>(), series = new ArrayList<>();
        for (TvRepository.VodItem item : movies) {
            if (kindOf(item).equals("剧集")) series.add(item);
            else if (kindOf(item).equals("电影")) films.add(item);
        }
        if (films.size() > 2) addPosterShelf("电影之夜", "给自己留一段好时光", films.subList(0, Math.min(16, films.size())), false);
        if (series.size() > 2) addPosterShelf("追剧时光", "总有一个故事，让你想看下一集", series.subList(0, Math.min(16, series.size())), false);
        TextView footer = text(activity, "每一次打开，都有新的故事。", 11, FAINT);
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(0, px(38), 0, px(14));
        body.addView(footer);
        if (typing && query != null) {
            query.requestFocus();
            query.setSelection(query.length());
        }
        final ScrollView current = scroll;
        current.post(() -> { if (scroll == current && page == 0) current.scrollTo(0, oldY); });
    }

    private View hero(TvRepository.VodItem featured) {
        FrameLayout hero = new FrameLayout(activity);
        hero.setBackgroundColor(MOBILE_SURFACE);
        hero.setClipToOutline(true);
        if (featured != null && !featured.cover.isEmpty()) {
            ImageView art = new ImageView(activity);
            art.setScaleType(ImageView.ScaleType.CENTER_CROP);
            FrameLayout.LayoutParams image = new FrameLayout.LayoutParams(narrow() ? -1 : px(widthDp() * .78f), -1, Gravity.END);
            hero.addView(art, image);
            posters.loadBackdrop(featured.cover, art);
        }
        View shade = new View(activity);
        shade.setBackground(new GradientDrawable(narrow() ? GradientDrawable.Orientation.BOTTOM_TOP : GradientDrawable.Orientation.LEFT_RIGHT,
                narrow() ? new int[]{BACKGROUND, 0xF208090B, 0x8508090B, 0x0808090B, 0x0808090B}
                        : new int[]{BACKGROUND, 0xF208090B, 0xA008090B, 0x1808090B, 0x0808090B}));
        hero.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout copy = vertical(activity);
        TextView eyebrow = text(activity, "幕里  ·  " + (featured == null ? "你的观影时光" : "为你精选"), narrow() ? 9 : 11, 0xFFE0E0E5);
        eyebrow.setLetterSpacing(.14f);
        copy.addView(eyebrow);
        TextView headline = heading(activity, featured == null ? "好故事，\n随时都能看。" : featured.title, narrow() ? 39 : 48);
        headline.setLetterSpacing(-.045f);
        headline.setMaxLines(2);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        headline.setLineSpacing(0, 1.08f);
        add(copy, headline, -1, -2, 14);
        String meta = featured == null ? "电影、剧集与电视直播，尽在眼前。" : join(featured.year, featured.type, featured.remarks);
        TextView metadata = text(activity, meta, 11, 0xFFBFBFC6);
        metadata.setMaxLines(2);
        metadata.setEllipsize(TextUtils.TruncateAt.END);
        add(copy, metadata, -1, -2, 12);
        TextView description = text(activity, featured == null ? "搜索你想看的影片，或打开电视直播。"
                : "内容来源 · " + featured.source.name, 12, 0xFFB1B1B8);
        description.setLineSpacing(px(3), 1f);
        description.setMaxLines(2);
        description.setEllipsize(TextUtils.TruncateAt.END);
        add(copy, description, -1, -2, 11);
        LinearLayout buttons = new LinearLayout(activity);
        Button play = button(activity, featured == null ? "探索影视" : "播放", MobileIcons.Kind.PLAY, true, false,
                view -> { if (featured == null) actions.browse(""); else actions.details(featured); });
        play.setTag("hero:play");
        buttons.addView(play, new LinearLayout.LayoutParams(0, px(44), 1.12f));
        Button live = button(activity, "电视直播", MobileIcons.Kind.SCREEN, false, false, view -> actions.live());
        LinearLayout.LayoutParams liveParams = new LinearLayout.LayoutParams(0, px(44), 1);
        liveParams.leftMargin = px(9);
        buttons.addView(live, liveParams);
        add(copy, buttons, -1, -2, 20);
        int copyWidth = narrow() ? -1 : Math.min(px(510), px((widthDp() - gutter() * 2) * .64f));
        FrameLayout.LayoutParams copyParams = new FrameLayout.LayoutParams(copyWidth, -2, Gravity.BOTTOM | Gravity.START);
        int inset = gutter();
        copyParams.setMargins(px(inset), px(30), px(inset), px(34));
        hero.addView(copy, copyParams);
        return hero;
    }

    void beginMovies(String requested) {
        if (!keyword.equals(requested)) resetFilters();
        keyword = requested;
        if (!keyword.isEmpty()) {
            browseKind = ALL;
            recordSearch(keyword);
        }
        updateNavigation();
        pageHeading("发现 · DISCOVER", keyword.isEmpty() ? (browseKind.equals(ALL) ? "发现好故事" : browseKind)
                : "搜索结果", keyword.isEmpty() ? "从热门新作到值得重看的经典，找到你的下一部。" : "寻找“" + keyword + "”的故事与播放来源。");
        add(body, searchField("搜索电影、剧集或纪录片", keyword, actions::browse, null), -1, 48, 19);
        if (keyword.isEmpty()) addRecentSearches();
        kindHost = vertical(activity);
        add(body, kindHost, -1, -2, 14);
        filters = new LinearLayout(activity);
        add(body, filters, -1, 44, 13);
        TextView scope = text(activity, "按当前已载入内容筛选", 10, FAINT);
        scope.setPadding(0, px(10), 0, px(3));
        body.addView(scope);
        status = text(activity, "正在寻找好故事…", 11, MUTED);
        status.setLineSpacing(px(3), 1f);
        status.setPadding(0, px(10), 0, px(15));
        body.addView(status);
        LinearLayout resultHeading = new LinearLayout(activity);
        resultHeading.setGravity(Gravity.CENTER_VERTICAL);
        resultHeading.addView(heading(activity, keyword.isEmpty() ? "近期更新" : "相关影片", 19), new LinearLayout.LayoutParams(0, -2, 1));
        resultCount = text(activity, "", 11, FAINT);
        resultHeading.addView(resultCount);
        body.addView(resultHeading);
        resultHost = vertical(activity);
        add(body, resultHost, -1, -2, 15);
        movieData = new ArrayList<>();
        rebuildFilters();
        showGridSkeleton();
        if (searchFocusRequested) {
            searchFocusRequested = false;
            query.post(() -> {
                if (page != 2 || query == null) return;
                query.requestFocus();
                InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.showSoftInput(query, InputMethodManager.SHOW_IMPLICIT);
            });
        }
    }

    private void addRecentSearches() {
        ArrayList<String> recent = recentSearches();
        if (recent.isEmpty()) return;
        HorizontalScrollView recentScroll = horizontalScroll();
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = text(activity, "最近搜索", 10, FAINT);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-2, -2);
        labelParams.rightMargin = px(12);
        row.addView(label, labelParams);
        for (String term : recent) {
            Button chip = button(activity, term, null, false, true, view -> actions.browse(term));
            chip.setTextSize(11);
            chip.setMaxWidth(px(150));
            chip.setSingleLine(true);
            chip.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, px(40));
            params.rightMargin = px(7);
            row.addView(chip, params);
        }
        recentScroll.addView(row);
        add(body, recentScroll, -1, -2, 12);
    }

    private ArrayList<String> recentSearches() {
        ArrayList<String> values = new ArrayList<>();
        try {
            JSONArray rows = new JSONArray(homePreferences.getString("mobile_recent_searches", "[]"));
            for (int i = 0; i < Math.min(6, rows.length()); i++) {
                String term = rows.optString(i).trim();
                if (!term.isEmpty()) values.add(term);
            }
        } catch (Exception ignored) { }
        return values;
    }

    private void recordSearch(String term) {
        if (term.isEmpty()) return;
        ArrayList<String> values = recentSearches();
        values.remove(term);
        values.add(0, term);
        JSONArray output = new JSONArray();
        for (int i = 0; i < Math.min(6, values.size()); i++) output.put(values.get(i));
        homePreferences.edit().putString("mobile_recent_searches", output.toString()).apply();
    }

    private void resetFilters() {
        browseYear = ALL_YEARS;
        browseSource = ALL_SOURCES;
        browseOrder = "近期更新";
    }

    private void rebuildFilters() {
        if (kindHost == null || filters == null) return;
        movieLimit = 120;
        kindHost.removeAllViews();
        HorizontalScrollView types = horizontalScroll();
        LinearLayout row = new LinearLayout(activity);
        for (String kind : KINDS) {
            Button chip = button(activity, kind, null, false, true, view -> {
                browseKind = kind;
                updateNavigation();
                rebuildFilters();
                renderFilteredMovies(false);
            });
            chip.setSelected(kind.equals(browseKind));
            chip.setTextSize(12);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, px(42));
            params.rightMargin = px(7);
            row.addView(chip, params);
        }
        types.addView(row);
        kindHost.addView(types);
        filters.removeAllViews();
        String[] labels = {browseYear, browseSource, browseOrder};
        for (int i = 0; i < labels.length; i++) {
            final int filter = i;
            Button field = button(activity, labels[i], null, false, false, view -> chooseFilter(filter));
            field.setTextSize(11);
            field.setSingleLine(true);
            field.setEllipsize(TextUtils.TruncateAt.END);
            field.setPadding(px(9), 0, px(9), 0);
            field.setContentDescription(new String[]{"筛选年份：", "筛选来源：", "排序："}[i] + labels[i]);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -1, 1);
            if (i > 0) params.leftMargin = px(8);
            filters.addView(field, params);
        }
        if (!browseYear.equals(ALL_YEARS) || !browseSource.equals(ALL_SOURCES) || !browseOrder.equals("近期更新")) {
            Button reset = iconButton(activity, MobileIcons.Kind.RESET, "重置筛选", view -> {
                resetFilters(); rebuildFilters(); renderFilteredMovies(false);
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(px(44), -1);
            params.leftMargin = px(7);
            filters.addView(reset, params);
        }
    }

    private void chooseFilter(int field) {
        ArrayList<String> values = new ArrayList<>();
        String selected;
        if (field == 0) {
            values.add(ALL_YEARS);
            LinkedHashSet<String> years = new LinkedHashSet<>();
            for (TvRepository.VodItem item : movieData) if (!item.year.isEmpty()) years.add(item.year);
            ArrayList<String> sorted = new ArrayList<>(years);
            Collections.sort(sorted, Collections.reverseOrder());
            values.addAll(sorted);
            selected = browseYear;
        } else if (field == 1) {
            values.add(ALL_SOURCES);
            LinkedHashSet<String> sources = new LinkedHashSet<>();
            for (TvRepository.VodItem item : movieData) sources.add(item.source.name);
            values.addAll(sources);
            selected = browseSource;
        } else {
            Collections.addAll(values, "近期更新", "年份优先", "片名排序");
            selected = browseOrder;
        }
        choose(new String[]{"选择年份", "选择内容来源", "排列方式"}[field], values, selected, value -> {
            if (field == 0) browseYear = value;
            else if (field == 1) browseSource = value;
            else browseOrder = value;
            rebuildFilters();
            renderFilteredMovies(false);
        });
    }

    void renderMovies(List<TvRepository.VodItem> movies, boolean history) {
        movieLimit = 120;
        movieData = new ArrayList<>(movies);
        if (!history) rebuildFilters();
        renderFilteredMovies(history);
    }

    private void renderFilteredMovies(boolean history) {
        if (resultHost == null) return;
        resultHost.removeAllViews();
        ArrayList<TvRepository.VodItem> visible = new ArrayList<>();
        for (TvRepository.VodItem item : movieData) {
            if (!history && ((!browseKind.equals(ALL) && !browseKind.equals(kindOf(item)))
                    || (!browseYear.equals(ALL_YEARS) && !browseYear.equals(item.year))
                    || (!browseSource.equals(ALL_SOURCES) && !browseSource.equals(item.source.name)))) continue;
            visible.add(item);
        }
        if (!history && browseOrder.equals("年份优先")) visible.sort(Comparator.comparing((TvRepository.VodItem item) -> item.year).reversed());
        if (!history && browseOrder.equals("片名排序")) visible.sort(Comparator.comparing(item -> item.title));
        int columns = gridColumns();
        int count = Math.min(movieLimit, visible.size());
        if (resultCount != null) resultCount.setText(count < visible.size() ? "已显示 " + count + " / " + visible.size() + " 部" : visible.size() + " 部内容");
        for (int start = 0; start < count; start += columns) {
            LinearLayout row = new LinearLayout(activity);
            for (int column = 0; column < columns; column++) {
                int index = start + column;
                View tile = index < count ? posterTile(visible.get(index), false, 0, history) : new View(activity);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
                if (column > 0) params.leftMargin = px(narrow() ? 13 : 18);
                row.addView(tile, params);
            }
            add(resultHost, row, -1, -2, start == 0 ? 0 : 22);
        }
        if (count < visible.size()) {
            Button more = button(activity, "加载更多 · 还有 " + (visible.size() - count) + " 部", null, false, true, view -> {
                movieLimit += 60;
                renderFilteredMovies(history);
            });
            add(resultHost, more, -1, 48, 22);
        }
        if (visible.isEmpty()) {
            boolean filtered = !history && (!browseKind.equals(ALL) || !browseYear.equals(ALL_YEARS) || !browseSource.equals(ALL_SOURCES));
            empty(resultHost, history ? "好故事，从第一次播放开始。" : filtered ? "当前筛选下没有影片" : "换个关键词，再找找。",
                    history ? "观看过的影片会保存在这里，随时回来继续。" : filtered ? "试试其他分类，或重置年份和来源。" : "试试完整片名，也可以回到首页发现更多。",
                    filtered ? "重置筛选" : "探索影视", () -> {
                        if (filtered) { browseKind = ALL; resetFilters(); rebuildFilters(); updateNavigation(); renderFilteredMovies(false); }
                        else actions.browse("");
                    });
        }
    }

    private int gridColumns() {
        int width = widthDp();
        return width < 480 ? 2 : width < 768 ? 3 : width < 1024 ? 4 : width < 1200 ? 5 : 6;
    }

    private void showGridSkeleton() {
        int columns = gridColumns();
        LinearLayout row = new LinearLayout(activity);
        for (int i = 0; i < columns; i++) {
            AspectFrame art = new AspectFrame(activity);
            art.setBackground(skeleton().getBackground());
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            if (i > 0) params.leftMargin = px(13);
            row.addView(art, params);
        }
        resultHost.addView(row);
    }

    void beginHistory() {
        pageHeading("你的观影时光 · LIBRARY", "你的资料库", "看过的故事，都在这里。轻触封面继续观看。");
        status = text(activity, "观看记录保存在这台设备上", 11, FAINT);
        status.setPadding(0, px(15), 0, px(15));
        body.addView(status);
        resultCount = null;
        resultHost = vertical(activity);
        body.addView(resultHost);
    }

    void beginLive(String value, String selected) {
        pageHeading("此刻，正在发生 · LIVE", "电视直播", "新闻、纪录片与地方频道，打开电视，遇见此刻。");
        add(body, searchField("查找频道，例如 CCTV、卫视", value,
                term -> actions.liveQuery(term), term -> actions.liveQuery(term)), -1, 48, 20);
        HorizontalScrollView groups = horizontalScroll();
        LinearLayout row = new LinearLayout(activity);
        for (String group : new String[]{ALL, "央视", "卫视", "地方"}) {
            Button chip = button(activity, group, group.equals(ALL) ? MobileIcons.Kind.LIVE : null, false, true,
                    view -> actions.liveFilter(group));
            chip.setSelected(group.equals(selected));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(px(narrow() ? 73 : 96), px(42));
            params.rightMargin = px(8);
            row.addView(chip, params);
        }
        groups.addView(row);
        add(body, groups, -1, -2, 17);
        status = text(activity, "正在载入频道…", 11, MUTED);
        status.setPadding(0, px(15), 0, px(15));
        body.addView(status);
        resultHost = vertical(activity);
        body.addView(resultHost);
    }

    void renderChannels(List<TvRepository.Channel> channels) {
        if (resultHost == null) return;
        resultHost.removeAllViews();
        int columns = widthDp() < 600 ? 2 : widthDp() < 900 ? 3 : widthDp() < 1200 ? 4 : 5;
        for (int start = 0; start < channels.size(); start += columns) {
            LinearLayout row = new LinearLayout(activity);
            for (int column = 0; column < columns; column++) {
                final int index = start + column;
                View tile = index < channels.size() ? channelTile(channels.get(index), index + 1,
                        () -> actions.playChannels(channels, index)) : new View(activity);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, px(130), 1);
                if (column > 0) params.leftMargin = px(12);
                row.addView(tile, params);
            }
            add(resultHost, row, -1, -2, start == 0 ? 0 : 13);
        }
        if (channels.isEmpty()) empty(resultHost, "没有匹配的频道", "选择“全部”，或尝试其他频道名称。", "显示全部", () -> {
            if (query != null) query.setText("");
            actions.liveFilter(ALL);
        });
    }

    private View channelTile(TvRepository.Channel channel, int number, Runnable action) {
        LinearLayout tile = vertical(activity);
        tile.setClipChildren(true);
        tile.setPadding(px(14), px(13), px(14), px(13));
        tile.setBackground(touchBackground(activity, 0xFF17171B, 14, false));
        touch(tile);
        tile.setContentDescription(channelName(channel.name) + "，" + liveCategory(channel) + "频道，播放直播");
        tile.setTag("channel:" + channel.url);
        tile.setOnClickListener(view -> action.run());
        LinearLayout top = new LinearLayout(activity);
        top.setGravity(Gravity.CENTER_VERTICAL);
        ImageView icon = new ImageView(activity);
        icon.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.SCREEN, 0xFFBFBFC6, 23));
        if (!channel.logo.isEmpty()) posters.loadWhenVisible(channel.logo, icon);
        top.addView(icon, new LinearLayout.LayoutParams(px(23), px(23)));
        TextView live = text(activity, "● LIVE", 8, LIVE_GREEN);
        live.setGravity(Gravity.END);
        live.setLetterSpacing(.09f);
        top.addView(live, new LinearLayout.LayoutParams(0, -2, 1));
        tile.addView(top);
        TextView name = heading(activity, channelName(channel.name), narrow() ? 15 : 17);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        add(tile, name, -1, -2, 15);
        TextView meta = text(activity, String.format(Locale.ROOT, "%02d", number) + "  ·  " + liveCategory(channel) + "频道", 10, FAINT);
        add(tile, meta, -1, -2, 8);
        return tile;
    }

    void renderSettings(List<TvRepository.Source> sources, List<TvRepository.Source> liveSources) {
        pageHeading("偏好与资料 · SETTINGS", "设置", "让每一段观影时光，都恰到好处。");
        LinearLayout library = settingsCard("观看与资料库", "播放进度和观看记录保存在这台设备上。");
        settingsRow(library, MobileIcons.Kind.HISTORY, "观看历史", "继续上次的故事", actions::history);
        settingsRow(library, MobileIcons.Kind.RESET, "刷新直播频道", "重新获取可用频道", actions::refreshLive);
        settingsRow(library, MobileIcons.Kind.CLOSE, "清空观看记录", "移除此设备的观看记录", actions::clearHistory);
        LinearLayout providers = settingsCard("内容来源", "内置点播与电视直播目录");
        for (TvRepository.Source source : sources) sourceRow(providers, source.name, "电影与电视剧");
        for (TvRepository.Source source : liveSources) sourceRow(providers, source.name, "电视直播目录");
        LinearLayout artwork = settingsCard("高清图片 / TMDB", "独立横图用于影片详情，海报保留原来源。凭据为可选项。");
        artwork.addView(ArtworkSettings.content(activity, artworkRepository));
        LinearLayout viewing = settingsCard("为触摸屏而设计", "手机与平板，都有舒适的观影空间。");
        TextView hint = text(activity, "轻触封面查看详情，左右滑动浏览片架。\n播放时轻触画面显示控制，拖动进度条跳转，点击选集或频道切换。", 12, MUTED);
        hint.setLineSpacing(px(6), 1f);
        viewing.addView(hint);
        TextView version = text(activity, "幕里  ·  " + BuildConfig.VERSION_NAME, 11, FAINT);
        version.setGravity(Gravity.CENTER);
        version.setPadding(0, px(28), 0, px(20));
        body.addView(version);
    }

    private LinearLayout settingsCard(String title, String detail) {
        LinearLayout card = vertical(activity);
        card.setPadding(px(19), px(20), px(19), px(18));
        card.setBackground(rounded(activity, MOBILE_SURFACE, 18, 0x18FFFFFF, 1));
        card.addView(heading(activity, title, 18));
        TextView description = text(activity, detail, 11, FAINT);
        description.setLineSpacing(px(4), 1f);
        description.setPadding(0, px(8), 0, px(17));
        card.addView(description);
        add(body, card, -1, -2, 17);
        return card;
    }

    private void settingsRow(LinearLayout parent, MobileIcons.Kind icon, String title, String subtitle, Runnable action) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(px(3), px(12), px(3), px(12));
        row.setBackground(touchBackground(activity, Color.TRANSPARENT, 10, false));
        touch(row);
        row.setOnClickListener(view -> action.run());
        ImageView mark = new ImageView(activity);
        mark.setImageDrawable(new MobileIcons(activity, icon, MUTED, 21));
        row.addView(mark, new LinearLayout.LayoutParams(px(23), px(23)));
        LinearLayout copy = vertical(activity);
        copy.addView(text(activity, title, 13, TEXT));
        TextView detail = text(activity, subtitle, 10, FAINT);
        detail.setPadding(0, px(5), 0, 0);
        copy.addView(detail);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(0, -2, 1);
        copyParams.setMargins(px(13), 0, px(10), 0);
        row.addView(copy, copyParams);
        ImageView arrow = new ImageView(activity);
        arrow.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.CHEVRON, FAINT, 16));
        row.addView(arrow, new LinearLayout.LayoutParams(px(16), px(16)));
        parent.addView(row, new LinearLayout.LayoutParams(-1, -2));
    }

    private void sourceRow(LinearLayout parent, String title, String detail) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, px(8), 0, px(8));
        TextView source = text(activity, title, 12, TEXT);
        source.setSingleLine(true);
        source.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(source, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(text(activity, detail, 10, FAINT));
        parent.addView(row);
    }

    private void pageHeading(String eyebrow, String title, String description) {
        TextView category = text(activity, eyebrow, 10, FAINT);
        category.setLetterSpacing(.06f);
        category.setPadding(0, px(10), 0, 0);
        body.addView(category);
        TextView name = heading(activity, title, narrow() ? 30 : 38);
        name.setLetterSpacing(-.04f);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        add(body, name, -1, -2, 10);
        TextView detail = text(activity, description, narrow() ? 12 : 13, MUTED);
        detail.setLineSpacing(px(4), 1f);
        add(body, detail, -1, -2, 11);
    }

    private interface SearchAction { void search(String value); }
    private View searchField(String hint, String value, SearchAction submit, SearchAction change) {
        LinearLayout field = new LinearLayout(activity);
        field.setGravity(Gravity.CENTER_VERTICAL);
        field.setPadding(px(13), px(4), px(5), px(4));
        field.setBackground(rounded(activity, 0xFF232327, 14, 0x18FFFFFF, .7f));
        ImageView icon = new ImageView(activity);
        icon.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.SEARCH, FAINT, 18));
        field.addView(icon, new LinearLayout.LayoutParams(px(18), px(18)));
        EditText input = new EditText(activity);
        query = input;
        input.setSingleLine(true);
        input.setTextSize(13);
        input.setTextColor(TEXT);
        input.setHintTextColor(FAINT);
        input.setHint(hint);
        input.setContentDescription(hint);
        input.setText(value);
        input.setPadding(px(11), 0, px(7), 0);
        input.setBackgroundColor(Color.TRANSPARENT);
        input.setSelectAllOnFocus(false);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(100)});
        input.setOnFocusChangeListener((view, focused) -> field.setBackground(rounded(activity,
                focused ? 0xFF29292E : 0xFF232327, 14, focused ? 0xBFF5F5F7 : 0x18FFFFFF, .7f)));
        Runnable search = () -> {
            InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(input.getWindowToken(), 0);
            submit.search(input.getText().toString().trim());
        };
        input.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_DOWN)) { search.run(); return true; }
            return false;
        });
        if (change != null) input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { change.search(s.toString()); }
            @Override public void afterTextChanged(Editable value) { }
        });
        field.addView(input, new LinearLayout.LayoutParams(0, -1, 1));
        Button submitButton = button(activity, "搜索", null, true, false, view -> search.run());
        submitButton.setTextSize(11);
        submitButton.setPadding(px(14), 0, px(14), 0);
        field.addView(submitButton, new LinearLayout.LayoutParams(-2, -1));
        return field;
    }

    private void addPosterShelf(String title, String subtitle, List<TvRepository.VodItem> movies, boolean history) {
        addShelfHeading(title, subtitle, history ? actions::history : () -> actions.browse(""));
        LinearLayout row = shelfRow();
        for (int i = 0; i < movies.size(); i++) {
            View tile = posterTile(movies.get(i), true, 0, history);
            tile.setTag("shelf:" + title + "|" + movies.get(i).source.url + "#" + movies.get(i).id);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(px(history ? posterWidth() * 1.9f : posterWidth()), -2);
            params.rightMargin = px(12);
            row.addView(tile, params);
        }
    }

    private float posterWidth() {
        float columns = widthDp() < 560 ? 2.65f : widthDp() < 800 ? 4.1f : widthDp() < 1050 ? 5.1f : 6.1f;
        return Math.max(104, (widthDp() - gutter() * 2 - (columns - 1) * 12) / columns);
    }

    private View posterTile(TvRepository.VodItem item, boolean overlay, int rank, boolean history) {
        LinearLayout tile = vertical(activity);
        tile.setClipChildren(true);
        tile.setBackground(touchBackground(activity, Color.TRANSPARENT, 14, false));
        touch(tile);
        tile.setTag("movie:" + item.source.url + "#" + item.id);
        tile.setContentDescription((history ? "继续观看 " : "") + item.title + "，" + join(item.year, item.type, item.source.name));
        tile.setOnClickListener(view -> actions.details(item));
        AspectFrame art = new AspectFrame(activity, history && overlay ? .62f : 1.4f);
        art.setClipToOutline(true);
        art.setBackground(rounded(activity, CHIP, 14, 0x14FFFFFF, .7f));
        ImageView placeholder = new ImageView(activity);
        placeholder.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.FILM, 0xFF73737B, 31));
        art.addView(placeholder, new FrameLayout.LayoutParams(px(31), px(31), Gravity.CENTER));
        ImageView image = new ImageView(activity);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.addView(image, new FrameLayout.LayoutParams(-1, -1));
        posters.loadWhenVisible(item.cover, image);
        View veil = new View(activity);
        veil.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x0A000000, 0x00000000, overlay ? 0xE6000000 : 0x70000000}));
        art.addView(veil, new FrameLayout.LayoutParams(-1, -1));
        if (rank > 0) {
            TextView ranking = text(activity, String.format(Locale.ROOT, "%02d", rank), 10, Color.WHITE);
            ranking.setGravity(Gravity.CENTER);
            ranking.setBackground(rounded(activity, 0x77000000, 6, 0x18FFFFFF, .5f));
            FrameLayout.LayoutParams badge = new FrameLayout.LayoutParams(px(23), px(22), Gravity.START | Gravity.TOP);
            badge.setMargins(px(8), px(8), 0, 0);
            art.addView(ranking, badge);
        }
        if (!item.remarks.isEmpty() && !history) {
            TextView note = text(activity, item.remarks, 9, 0xFFF4F2EC);
            note.setSingleLine(true);
            note.setEllipsize(TextUtils.TruncateAt.END);
            note.setMaxWidth(px(overlay ? Math.max(56, posterWidth() - 50) : 112));
            note.setPadding(px(5), px(4), px(5), px(4));
            note.setBackground(rounded(activity, 0x99000000, 6, 0, 0));
            FrameLayout.LayoutParams badge = new FrameLayout.LayoutParams(-2, -2, Gravity.END | (overlay ? Gravity.TOP : Gravity.BOTTOM));
            badge.setMargins(px(5), px(8), px(8), px(8));
            art.addView(note, badge);
        }
        if (overlay) {
            LinearLayout caption = vertical(activity);
            TextView title = heading(activity, item.title, history ? 14 : 12);
            title.setMaxLines(2);
            title.setEllipsize(TextUtils.TruncateAt.END);
            title.setLineSpacing(px(2), 1f);
            caption.addView(title);
            if (history) {
                WatchProgress progress = watchProgress(activity, item);
                TextView detail = text(activity, progress.label, 9, 0xB3FFFFFF);
                detail.setSingleLine(true);
                detail.setEllipsize(TextUtils.TruncateAt.END);
                add(caption, detail, -1, -2, 6);
                if (progress.fraction >= 0) add(caption, new ProgressTrack(activity, progress.fraction), -1, 2, 9);
                ImageView play = new ImageView(activity);
                play.setPadding(px(10), px(10), px(10), px(10));
                play.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.PLAY, Color.WHITE, 17));
                play.setBackground(rounded(activity, 0x66000000, 30, 0x66FFFFFF, 1));
                art.addView(play, new FrameLayout.LayoutParams(px(37), px(37), Gravity.CENTER));
            }
            FrameLayout.LayoutParams copy = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
            copy.setMargins(px(11), 0, px(11), px(12));
            art.addView(caption, copy);
        }
        tile.addView(art, new LinearLayout.LayoutParams(-1, -2));
        if (!overlay) {
            TextView title = heading(activity, item.title, 13);
            title.setMaxLines(2);
            title.setMinLines(2);
            title.setEllipsize(TextUtils.TruncateAt.END);
            title.setLineSpacing(px(3), 1f);
            title.setPadding(px(2), px(10), px(2), 0);
            tile.addView(title);
            TextView meta = text(activity, history ? watchProgress(activity, item).label
                    : join(item.year, !keyword.isEmpty() ? item.source.name : item.type), 10, FAINT);
            meta.setSingleLine(true);
            meta.setEllipsize(TextUtils.TruncateAt.END);
            meta.setPadding(px(2), px(5), px(2), px(3));
            tile.addView(meta);
        }
        return tile;
    }

    private void addShelfHeading(String title, String subtitle, Runnable more) {
        LinearLayout line = new LinearLayout(activity);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, px(32), 0, px(14));
        LinearLayout words = vertical(activity);
        TextView label = heading(activity, title, 22);
        label.setLetterSpacing(-.025f);
        words.addView(label);
        TextView detail = text(activity, subtitle, 10, FAINT);
        detail.setPadding(0, px(5), 0, 0);
        words.addView(detail);
        line.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        Button all = iconButton(activity, MobileIcons.Kind.CHEVRON, "查看全部" + title, view -> more.run());
        line.addView(all, new LinearLayout.LayoutParams(px(44), px(44)));
        body.addView(line);
    }

    private LinearLayout shelfRow() {
        HorizontalScrollView rail = horizontalScroll();
        rail.setPadding(0, 0, 0, px(5));
        rail.setClipToPadding(false);
        LinearLayout row = new LinearLayout(activity);
        rail.addView(row, new HorizontalScrollView.LayoutParams(-2, -2));
        body.addView(rail, new LinearLayout.LayoutParams(-1, -2));
        return row;
    }

    private void addLiveRibbon() {
        LinearLayout ribbon = new LinearLayout(activity);
        ribbon.setGravity(Gravity.CENTER_VERTICAL);
        ribbon.setPadding(px(16), px(19), px(13), px(19));
        ribbon.setBackground(touchBackground(activity, 0xFF17171B, 17, false));
        touch(ribbon);
        ribbon.setContentDescription("打开电视，遇见此刻。进入电视直播");
        ribbon.setOnClickListener(view -> actions.live());
        ImageView icon = new ImageView(activity);
        icon.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.SCREEN, TEXT, 23));
        icon.setPadding(px(10), px(10), px(10), px(10));
        icon.setBackground(rounded(activity, 0x0FFFFFFF, 13, 0, 0));
        ribbon.addView(icon, new LinearLayout.LayoutParams(px(44), px(44)));
        LinearLayout words = vertical(activity);
        words.addView(heading(activity, "打开电视，遇见此刻。", narrow() ? 15 : 18));
        TextView detail = text(activity, "新闻、纪录片与地方频道，随时切换。", 10, MUTED);
        detail.setLineSpacing(px(3), 1f);
        detail.setPadding(0, px(7), 0, 0);
        words.addView(detail);
        LinearLayout.LayoutParams copy = new LinearLayout.LayoutParams(0, -2, 1);
        copy.setMargins(px(13), 0, px(6), 0);
        ribbon.addView(words, copy);
        ImageView arrow = new ImageView(activity);
        arrow.setImageDrawable(new MobileIcons(activity, MobileIcons.Kind.CHEVRON, MUTED, 16));
        ribbon.addView(arrow, new LinearLayout.LayoutParams(px(16), px(16)));
        add(body, ribbon, -1, -2, 29);
    }

    AlertDialog showDetails(TvRepository.VideoDetails detail, int selectedIndex, String playLabel,
                            String continuityHint, boolean requiresChoice, EpisodeAction play) {
        final AlertDialog[] holder = new AlertDialog[1];
        FrameLayout surface = new FrameLayout(activity);
        surface.setClipToOutline(true);
        surface.setBackground(rounded(activity, 0xFF111114, 23, 0x26FFFFFF, .7f));
        ImageView backdrop = new ImageView(activity);
        backdrop.setAlpha(.72f);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        surface.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
        View shade = new View(activity);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x25111114, 0xD8111114, 0xFF111114}));
        surface.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        ScrollView details = new ScrollView(activity);
        details.setVerticalScrollBarEnabled(false);
        details.setFillViewport(false);
        LinearLayout panel = vertical(activity);
        panel.setPadding(px(22), px(63), px(22), px(27));
        LinearLayout overview = new LinearLayout(activity);
        ImageView poster = new ImageView(activity);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setClipToOutline(true);
        poster.setBackground(rounded(activity, 0xFF232327, 12, 0x22FFFFFF, .5f));
        int posterWidth = narrow() ? 92 : 142;
        overview.addView(poster, new LinearLayout.LayoutParams(px(posterWidth), px(posterWidth * 1.5f)));
        posters.load(detail.item.cover, poster);
        LinearLayout information = vertical(activity);
        TextView genre = text(activity, detail.item.type.isEmpty() ? "精选影视" : detail.item.type, 10, 0xFFD4D4DA);
        genre.setMaxLines(1);
        genre.setEllipsize(TextUtils.TruncateAt.END);
        genre.setPadding(px(10), px(6), px(10), px(6));
        genre.setBackground(rounded(activity, 0x26FFFFFF, 30, 0x0DFFFFFF, .5f));
        information.addView(genre, new LinearLayout.LayoutParams(-2, -2));
        TextView title = heading(activity, detail.item.title, narrow() ? 30 : 40);
        title.setMaxLines(3);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setLetterSpacing(-.04f);
        add(information, title, -1, -2, 11);
        TextView metadata = text(activity, join(detail.item.year, detail.item.remarks) + "  ·  " + detail.episodes.size() + " 集", 11, 0xFFC6C6CE);
        metadata.setLineSpacing(px(3), 1f);
        add(information, metadata, -1, -2, 9);
        LinearLayout.LayoutParams info = new LinearLayout.LayoutParams(0, -2, 1);
        info.leftMargin = px(18);
        overview.addView(information, info);
        panel.addView(overview);
        TextView description = text(activity, detail.description.isEmpty() ? "好故事，即将开始。" : detail.description, 13, 0xFFDEDEE4);
        description.setLineSpacing(px(6), 1f);
        description.setMaxLines(5);
        description.setEllipsize(TextUtils.TruncateAt.END);
        add(panel, description, -1, -2, 23);
        Button expand = button(activity, "展开简介", null, false, true, view -> {
            boolean expanded = description.getMaxLines() > 5;
            description.setMaxLines(expanded ? 5 : Integer.MAX_VALUE);
            ((Button) view).setText(expanded ? "展开简介" : "收起简介");
        });
        add(panel, expand, -2, 40, 8);
        if (!continuityHint.isEmpty()) {
            TextView hint = text(activity, continuityHint, 12, MUTED);
            hint.setLineSpacing(px(4), 1f);
            add(panel, hint, -1, -2, 16);
        }
        final View[] episodeAnchor = new View[1];
        Button start = button(activity, playLabel, MobileIcons.Kind.PLAY, true, true, view -> {
            if (requiresChoice && episodeAnchor[0] != null) details.smoothScrollTo(0, episodeAnchor[0].getTop());
            else { holder[0].dismiss(); play.play(-1); }
        });
        add(panel, start, -1, 48, 20);
        Button alternative = button(activity, "搜索其他来源", MobileIcons.Kind.SEARCH, false, true, view -> {
            holder[0].dismiss(); actions.browse(detail.item.title);
        });
        add(panel, alternative, -1, 44, 10);
        LinearLayout episodeHeading = new LinearLayout(activity);
        episodeAnchor[0] = episodeHeading;
        episodeHeading.setGravity(Gravity.CENTER_VERTICAL);
        episodeHeading.addView(heading(activity, "选择剧集", 19), new LinearLayout.LayoutParams(0, -2, 1));
        episodeHeading.addView(text(activity, detail.episodes.size() + " 集", 11, 0xFF9B9BA3));
        add(panel, episodeHeading, -1, -2, 27);
        TextView source = text(activity, "当前来源：" + detail.item.source.name, 11, 0xFF9B9BA3);
        source.setSingleLine(true);
        source.setEllipsize(TextUtils.TruncateAt.END);
        add(panel, source, -1, -2, 10);
        int columns = narrow() ? 3 : 6;
        for (int startIndex = 0; startIndex < detail.episodes.size(); startIndex += columns) {
            LinearLayout row = new LinearLayout(activity);
            for (int column = 0; column < columns; column++) {
                final int index = startIndex + column;
                View episode;
                if (index < detail.episodes.size()) {
                    Button item = button(activity, detail.episodes.get(index).name, null, false, false, view -> {
                        holder[0].dismiss(); play.play(index);
                    });
                    item.setSelected(index == selectedIndex);
                    item.setContentDescription(detail.episodes.get(index).name + (item.isSelected() ? "，上次观看" : ""));
                    item.setTextSize(12);
                    item.setSingleLine(true);
                    item.setEllipsize(TextUtils.TruncateAt.END);
                    item.setPadding(px(6), 0, px(6), 0);
                    episode = item;
                } else episode = new View(activity);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, px(44), 1);
                if (column > 0) params.leftMargin = px(8);
                row.addView(episode, params);
            }
            add(panel, row, -1, -2, startIndex == 0 ? 14 : 9);
        }
        details.addView(panel, new ScrollView.LayoutParams(-1, -2));
        surface.addView(details, new FrameLayout.LayoutParams(-1, -1));
        TextView brand = text(activity, "幕里  /  影片详情", 12, 0xBFFFFFFF);
        FrameLayout.LayoutParams brandParams = new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.TOP);
        brandParams.setMargins(px(22), px(23), 0, 0);
        surface.addView(brand, brandParams);
        Button close = iconButton(activity, MobileIcons.Kind.CLOSE, "关闭影片详情", view -> holder[0].dismiss());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(px(44), px(44), Gravity.END | Gravity.TOP);
        closeParams.setMargins(0, px(9), px(11), 0);
        surface.addView(close, closeParams);
        holder[0] = new AlertDialog.Builder(activity).setView(surface).create();
        TvUi.showDialog(holder[0], 940);
        Window window = holder[0].getWindow();
        if (window != null) {
            Rect available = new Rect();
            activity.getWindow().getDecorView().getWindowVisibleDisplayFrame(available);
            int height = available.height() > 0 ? available.height() : activity.getResources().getDisplayMetrics().heightPixels;
            int width = available.width() > 0 ? available.width() : activity.getResources().getDisplayMetrics().widthPixels;
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.setLayout(Math.min(px(940), width - px(16)), Math.min(px(860), height - px(20)));
            window.setGravity(narrow() ? Gravity.BOTTOM : Gravity.CENTER);
        }
        DetailArtwork.bind(artworkRepository, posters, detail, backdrop, holder[0]);
        return holder[0];
    }

    private void choose(String title, List<String> values, String selected, ChoiceAction action) {
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle(title)
                .setSingleChoiceItems(values.toArray(new String[0]), Math.max(0, values.indexOf(selected)), (window, which) -> {
                    window.dismiss(); action.select(values.get(which));
                }).setNegativeButton("取消", null).create();
        TvUi.showDialog(dialog, 460);
    }

    private void empty(LinearLayout host, String title, String description, String label, Runnable action) {
        LinearLayout box = vertical(activity);
        box.setPadding(px(20), px(24), px(20), px(22));
        box.setBackground(rounded(activity, MOBILE_SURFACE, 17, 0x18FFFFFF, .7f));
        TextView heading = heading(activity, title, 17);
        heading.setLineSpacing(px(4), 1f);
        box.addView(heading);
        TextView detail = text(activity, description, 12, MUTED);
        detail.setLineSpacing(px(4), 1f);
        add(box, detail, -1, -2, 10);
        add(box, button(activity, label, MobileIcons.Kind.SEARCH, false, true, view -> action.run()), -2, 44, 17);
        add(host, box, -1, -2, 19);
    }

    private View skeleton() {
        View view = new View(activity);
        view.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF19191D, 0xFF2B2B30, 0xFF19191D}));
        view.setBackground(rounded(activity, 0xFF222226, 14, 0x10FFFFFF, .7f));
        return view;
    }

    private HorizontalScrollView horizontalScroll() {
        HorizontalScrollView view = new HorizontalScrollView(activity);
        view.setHorizontalScrollBarEnabled(false);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        return view;
    }

    private void add(LinearLayout parent, View child, int width, int height, int marginTop) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width < 0 ? width : px(width), height < 0 ? height : px(height));
        params.topMargin = px(marginTop);
        parent.addView(child, params);
    }

    static Button button(Context context, String label, MobileIcons.Kind icon, boolean primary, boolean pill, View.OnClickListener click) {
        Button view = new Button(context);
        view.setAllCaps(false);
        view.setIncludeFontPadding(false);
        view.setMinHeight(0); view.setMinimumHeight(0);
        view.setMinWidth(0); view.setMinimumWidth(0);
        view.setText(label);
        view.setTextSize(12);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        ColorStateList color = new ColorStateList(new int[][]{{android.R.attr.state_selected}, {android.R.attr.state_focused}, {}},
                primary ? new int[]{0xFF15161B, 0xFF15161B, 0xFF15161B} : new int[]{0xFF15161B, TEXT, TEXT});
        view.setTextColor(color);
        view.setBackground(touchBackground(context, primary ? 0xFFF5F5F7 : CHIP, pill ? 50 : 12, true));
        if (icon != null) {
            Drawable mark = new MobileIcons(context, icon, color, 16);
            mark.setBounds(0, 0, dp(context, 16), dp(context, 16));
            view.setCompoundDrawablesRelative(mark, null, null, null);
            view.setCompoundDrawablePadding(dp(context, 7));
        }
        touch(view);
        view.setOnClickListener(click);
        return view;
    }

    static Button iconButton(Context context, MobileIcons.Kind icon, String label, View.OnClickListener click) {
        Button view = button(context, "", null, false, true, click);
        ColorStateList colors = new ColorStateList(new int[][]{{android.R.attr.state_selected}, {}}, new int[]{0xFF15161B, 0xFFE1E3EB});
        view.setBackground(new IconBackground(context, icon, colors));
        view.setPadding(0, 0, 0, 0);
        view.setContentDescription(label);
        if (Build.VERSION.SDK_INT >= 26) view.setTooltipText(label);
        return view;
    }

    static Drawable touchBackground(Context context, int base, float radius, boolean selection) {
        StateListDrawable state = new StateListDrawable();
        if (selection) state.addState(new int[]{android.R.attr.state_selected}, rounded(context, 0xFFF5F5F7, radius, 0, 0));
        state.addState(new int[]{android.R.attr.state_focused}, rounded(context, base, radius, 0xBFFFFFFF, 1.5f));
        state.addState(new int[]{}, rounded(context, base, radius, base == Color.TRANSPARENT ? 0 : 0x10FFFFFF, .7f));
        return new RippleDrawable(ColorStateList.valueOf(0x26FFFFFF), state, rounded(context, Color.WHITE, radius, 0, 0));
    }

    static void touch(View view) {
        view.setFocusable(true);
        view.setClickable(true);
        view.setStateListAnimator(null);
        if (view.getId() == View.NO_ID) view.setId(View.generateViewId());
    }

    private static final class IconBackground extends android.graphics.drawable.LayerDrawable {
        IconBackground(Context context, MobileIcons.Kind kind, ColorStateList colors) {
            super(new Drawable[]{touchBackground(context, 0xFF232327, 50, true), new MobileIcons(context, kind, colors, 20)});
            setLayerInset(1, dp(context, 12), dp(context, 12), dp(context, 12), dp(context, 12));
        }
    }

    private static final class AspectFrame extends FrameLayout {
        private final float ratio;
        AspectFrame(Context context) { this(context, 1.4f); }
        AspectFrame(Context context, float ratio) { super(context); this.ratio = ratio; }
        @Override protected void onMeasure(int widthSpec, int heightSpec) {
            int width = MeasureSpec.getSize(widthSpec);
            int height = Math.round(width * ratio);
            super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY));
        }
    }

    private static final class ProgressTrack extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float fraction;
        ProgressTrack(Context context, float fraction) { super(context); this.fraction = fraction; }
        @Override protected void onDraw(Canvas canvas) {
            paint.setColor(0x66FFFFFF);
            canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
            paint.setColor(Color.WHITE);
            canvas.drawRect(0, 0, getWidth() * fraction, getHeight(), paint);
        }
    }

    private static String kindOf(TvRepository.VodItem item) {
        return PlaybackState.browseCategory(item);
    }

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

    private static String join(String... values) {
        StringBuilder text = new StringBuilder();
        for (String value : values) if (value != null && !value.trim().isEmpty()) {
            if (text.length() > 0) text.append(" · ");
            text.append(value.trim());
        }
        return text.toString();
    }
}
