package org.kongwotv.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.TextView;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exercises the actual signed APK, with an original local MP4 fixture. */
@androidx.media3.common.util.UnstableApi
public final class SmokeInstrumentation extends Instrumentation {
    private final List<String> checks = new ArrayList<>();
    private final AtomicBoolean brandedAsciiUa = new AtomicBoolean();
    private String profile;
    private boolean artworkOnly;
    private boolean searchOnly;
    private boolean homeOnly;
    private boolean commentaryOnly;
    private String commentaryKeyword = "周星驰";

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        profile = arguments == null ? "device" : arguments.getString("profile", "device");
        artworkOnly = arguments != null && "true".equals(arguments.getString("artwork"));
        searchOnly = arguments != null && "true".equals(arguments.getString("search"));
        homeOnly = arguments != null && "true".equals(arguments.getString("home"));
        commentaryOnly = arguments != null && "true".equals(arguments.getString("commentary"));
        if (arguments != null && arguments.getString("keyword") != null)
            commentaryKeyword = arguments.getString("keyword").trim();
        start();
    }

    @Override public void onStart() {
        if (commentaryOnly) { verifyCommentarySearch(); return; }
        if (homeOnly) { verifyHome(); return; }
        if (searchOnly) { verifySearch(); return; }
        if (artworkOnly) { verifyArtwork(); return; }
        Bundle result = new Bundle();
        try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            byte[] fixture;
            try (InputStream input = getContext().getAssets().open("smoke.mp4"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[8192];
                int count;
                while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
                fixture = output.toByteArray();
            }
            Thread serving = new Thread(() -> serve(server, fixture), "Muli-smoke-media");
            serving.setDaemon(true);
            serving.start();
            MainActivity home = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            String expectedLabel = "幕里";
            check(expectedLabel.contentEquals(getTargetContext().getApplicationInfo().loadLabel(getTargetContext().getPackageManager())), "application_label");
            check(hasText(home.getWindow().getDecorView(), "幕里"), "visible_brand");
            screenshot("home");
            activateNavigation(home, 1);
            waitForIdleSync();
            check(hasText(home.getWindow().getDecorView(), "电视直播"), "live_navigation");
            screenshot("live");
            activateNavigation(home, 2);
            waitForIdleSync();
            check(hasText(home.getWindow().getDecorView(), BuildConfig.IS_TV ? "搜索电影、电视剧或纪录片" : "搜索电影、剧集或纪录片"), "search_input");
            screenshot("search");

            String url = "http://127.0.0.1:" + server.getLocalPort() + "/smoke.mp4";
            TvRepository.Source source = new TvRepository.Source("本地验证", "http://127.0.0.1");
            TvRepository.VodItem movie = new TvRepository.VodItem(source, "smoke", "触摸与遥控器验证", "", "测试影片", "2026", "HD");
            ArrayList<TvRepository.Episode> episodes = new ArrayList<>();
            for (int i = 0; i < 12; i++) episodes.add(new TvRepository.Episode("第" + (i + 1) + "集", url + "?episode=" + i));
            TvRepository.VideoDetails detail = new TvRepository.VideoDetails(movie, "使用本地生成的测试画面与声音验证选集、播放、暂停和恢复，不依赖外部片源。", episodes);
            onMain(() -> invoke(home, "detailDialog", new Class<?>[]{TvRepository.VideoDetails.class}, detail));
            waitForIdleSync();
            screenshot("details");
            android.view.accessibility.AccessibilityNodeInfo dialogRoot = getUiAutomation().getRootInActiveWindow();
            check(dialogRoot != null && !dialogRoot.findAccessibilityNodeInfosByText("选择剧集").isEmpty(), "responsive_details");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            waitForIdleSync();

            Intent playback = new Intent(getTargetContext(), PlaybackActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("title", "幕里 本地播放验证")
                    .putExtra("searchTitle", "smoke")
                    .putStringArrayListExtra("urls", new ArrayList<>(Arrays.asList(url + "?episode=1", url + "?episode=2")))
                    .putStringArrayListExtra("names", new ArrayList<>(Arrays.asList("第一集", "第二集")))
                    .putExtra("index", 0).putExtra("live", false);
            if (BuildConfig.IS_TV) check(getTargetContext().getSharedPreferences("kongwotv_playback", 0).edit()
                    .putFloat("tv_speed", 1f).putBoolean("tv_fill", false).commit(), "tv_default_rate_and_fit_baseline");
            PlaybackActivity playerActivity = (PlaybackActivity) startActivitySync(playback);
            long deadline = android.os.SystemClock.elapsedRealtime() + 20000;
            AtomicBoolean playing = new AtomicBoolean();
            while (!playing.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
                onMain(() -> {
                    ExoPlayer player = (ExoPlayer) field(playerActivity, "player");
                    playing.set(player != null && player.isPlaying() && player.getCurrentPosition() > 500 && player.getVideoSize().width > 0 && player.getAudioFormat() != null);
                });
                if (!playing.get()) android.os.SystemClock.sleep(200);
            }
            check(playing.get(), "decoded_video_playback");
            check(brandedAsciiUa.get(), "ascii_muli_http_user_agent");
            if (!BuildConfig.IS_TV) verifyMobileControls(playerActivity);
            else verifyTvControls(playerActivity);
            onMain(() -> invoke(playerActivity, "togglePlayback", new Class<?>[]{}));
            onMain(() -> check(!((ExoPlayer) field(playerActivity, "player")).getPlayWhenReady(), "pause_control"));
            onMain(() -> invoke(playerActivity, "seekBy", new Class<?>[]{long.class}, 1000L));
            onMain(() -> check(((ExoPlayer) field(playerActivity, "player")).getCurrentPosition() >= 1000, "seek_control"));
            onMain(() -> invoke(playerActivity, "togglePlayback", new Class<?>[]{}));
            onMain(() -> invoke(playerActivity, "showItemList", new Class<?>[]{}));
            waitForIdleSync();
            screenshot("episodes");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            onMain(() -> invoke(playerActivity, "selectItem", new Class<?>[]{int.class, boolean.class}, 1, false));
            onMain(() -> check(((Integer) field(playerActivity, "currentIndex")) == 1, "episode_switch"));
            playing.set(false);
            deadline = android.os.SystemClock.elapsedRealtime() + 10000;
            while (!playing.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
                onMain(() -> {
                    ExoPlayer player = (ExoPlayer) field(playerActivity, "player");
                    playing.set(player != null && player.isPlaying() && player.getCurrentPosition() > 250 && player.getVideoSize().width > 0);
                });
                if (!playing.get()) android.os.SystemClock.sleep(200);
            }
            check(playing.get(), "episode_decoded_playback");
            waitForIdleSync();
            screenshot("player");
            onMain(() -> playerActivity.finish());
            waitForIdleSync();
            if (!BuildConfig.IS_TV) onMain(() -> check(
                    Math.abs(playerActivity.getWindow().getAttributes().screenBrightness
                            - (Float) field(field(playerActivity, "mobileControls"), "originalBrightness")) < .001f,
                    "leaving_player_restores_window_brightness"));
            if (BuildConfig.IS_TV) verifyTvLiveControls(playback);
            onMain(() -> home.finish());
            result.putString("stream", "PASS " + profile + " " + checks + "\n");
            result.putString("checks", String.join(",", checks));
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL " + profile + ": " + error + "\nChecks before failure: " + checks + "\n");
            result.putString("failure", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    /** Read real actor-search results from the actual UI, without substituting source responses. */
    private void verifyCommentarySearch() {
        Bundle result = new Bundle();
        try {
            check(BuildConfig.IS_TV, "commentary_mode_requires_tv");
            MainActivity home = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            activateNavigation(home, 2);
            final String keyword = commentaryKeyword;
            onMain(() -> {
                EditText input = (EditText) field(home, "query");
                check(input.requestFocus(), "commentary_search_input_focus");
                input.setText(keyword);
                input.setSelection(input.length());
                InputConnection connection = input.onCreateInputConnection(new EditorInfo());
                check(connection != null && connection.performEditorAction(EditorInfo.IME_ACTION_SEARCH),
                        "commentary_search_ime_action");
            });
            String[] status = new String[1];
            boolean[] completed = new boolean[1];
            long deadline = android.os.SystemClock.elapsedRealtime() + 18000;
            do {
                onMain(() -> {
                    status[0] = ((TextView) field(home, "status")).getText().toString();
                    completed[0] = !status[0].contains("正在寻找好故事");
                });
                if (!completed[0]) android.os.SystemClock.sleep(150);
            } while (!completed[0] && android.os.SystemClock.elapsedRealtime() < deadline);
            List<String> titles = new ArrayList<>();
            onMain(() -> {
                check(keyword.equals(((EditText) field(home, "query")).getText().toString()), "commentary_keyword_preserved");
                collectMovieTileTitles((View) field(home, "cards"), titles);
            });
            screenshot("commentary-search");
            for (String title : titles) check(!title.contains("电影解说"), "commentary_not_visible:" + title);
            boolean upstreamFailure = status[0].contains("暂时无法载入") || status[0].contains("部分来源暂不可用");
            String summary = "keyword=" + keyword + ", completed=" + completed[0] + ", renderedCount=" + titles.size()
                    + ", upstreamFailure=" + upstreamFailure + ", status=" + status[0]
                    + ", titles=" + titles.subList(0, Math.min(20, titles.size()));
            result.putString("query", keyword);
            result.putInt("renderedCount", titles.size());
            result.putBoolean("searchCompleted", completed[0]);
            result.putBoolean("upstreamFailure", upstreamFailure);
            result.putString("status", status[0]);
            result.putString("titles", String.join("\n", titles.subList(0, Math.min(20, titles.size()))));
            result.putString("coverage", "Currently rendered movie tiles; load-more pages are not traversed.");
            boolean verified = completed[0] && !titles.isEmpty();
            result.putString("verification", verified ? "PASS" : "UNVERIFIED");
            result.putString("stream", (verified ? "PASS " : "UNVERIFIED ") + profile + " " + summary
                    + (verified ? "\n" : "\nLimit: no completed nonempty live result set; empty/network results do not establish this scenario.\n"));
            finish(verified ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        } catch (Throwable error) {
            try { screenshot("commentary-search-failure"); } catch (Exception ignored) { }
            result.putString("verification", "FAIL");
            result.putString("stream", "FAIL " + profile + ": " + error + "\nChecks before failure: " + checks + "\n");
            result.putString("failure", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void collectMovieTileTitles(View view, List<String> titles) {
        if (!(view instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) view;
        if (view.getTag() instanceof String && ((String) view.getTag()).startsWith("movie:")) {
            for (int i = 0; i < group.getChildCount(); i++) {
                View child = group.getChildAt(i);
                if (child instanceof TextView) {
                    String title = ((TextView) child).getText().toString();
                    check(!title.isEmpty(), "commentary_result_has_title");
                    titles.add(title);
                    return;
                }
            }
            check(false, "commentary_result_title_missing");
        }
        for (int i = 0; i < group.getChildCount(); i++) collectMovieTileTitles(group.getChildAt(i), titles);
    }

    /** Verify the visible home controls and D-pad paths without starting network playback. */
    private void verifyHome() {
        Bundle result = new Bundle();
        try {
            check(BuildConfig.IS_TV, "home_mode_requires_tv");
            MainActivity home = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            activateNavigation(home, 0);
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_DOWN, "hero:play");
            String[] original = new String[1], selected = new String[1];
            onMain(() -> original[0] = home.getWindow().getDecorView().findViewWithTag("hero:play").getContentDescription().toString());
            screenshot("home");
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_RIGHT, "hero:details");
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_RIGHT, "hero:next");
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            waitForIdleSync();
            onMain(() -> {
                selected[0] = home.getWindow().getDecorView().findViewWithTag("hero:play").getContentDescription().toString();
                check(!original[0].equals(selected[0]), "home_next_changes_visible_play_title");
            });
            assertHomeFocus(home, "hero:next");
            // Refresh while a noninitial film is selected, so this catches a carousel reset.
            onMain(() -> invoke(home, "renderHome", new Class<?>[]{List.class, boolean.class}, field(home, "discoveries"), false));
            waitForIdleSync();
            onMain(() -> check(selected[0].equals(home.getWindow().getDecorView().findViewWithTag("hero:play")
                    .getContentDescription().toString()), "home_refresh_preserves_visible_play_title"));
            assertHomeFocus(home, "hero:next");
            screenshot("home-carousel");
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_LEFT, "hero:details");
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_LEFT, "hero:play");
            moveHomeFocus(home, KeyEvent.KEYCODE_DPAD_LEFT, "hero:previous");
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            waitForIdleSync();
            onMain(() -> check(original[0].equals(home.getWindow().getDecorView().findViewWithTag("hero:play")
                    .getContentDescription().toString()), "home_previous_returns_to_original_title"));
            assertHomeFocus(home, "hero:previous");
            onMain(() -> {
                View all = home.getWindow().getDecorView().findViewWithTag("shelf:all:为你推荐");
                check(all != null && all.requestFocus(), "home_view_all_focus");
            });
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            waitForIdleSync();
            onMain(() -> check(hasText(home.getWindow().getDecorView(), "搜索电影、电视剧或纪录片"), "home_view_all_opens_search"));
            screenshot("home-view-all");
            activateNavigation(home, 0);
            result.putString("stream", "PASS " + profile + " " + checks + "\n");
            result.putString("checks", String.join(",", checks));
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            try { screenshot("home-failure"); } catch (Exception ignored) { }
            result.putString("stream", "FAIL " + profile + ": " + error + "\nChecks before failure: " + checks + "\n");
            result.putString("failure", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void moveHomeFocus(MainActivity home, int key, String tag) {
        sendKeyDownUpSync(key);
        waitForIdleSync();
        assertHomeFocus(home, tag);
    }

    private void assertHomeFocus(MainActivity home, String tag) {
        onMain(() -> {
            View target = home.getWindow().getDecorView().findViewWithTag(tag);
            check(target != null && target.isFocused(), "home_focus_" + tag);
        });
    }

    /** Exercise real system IME visibility without depending on any search provider response. */
    private void verifySearch() {
        Bundle result = new Bundle();
        try {
            check(BuildConfig.IS_TV, "search_mode_requires_tv");
            MainActivity home = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            activateNavigation(home, 2);
            waitForIdleSync();
            openSearchIme(home, "ImeSmoke_First", false);
            screenshot("search-ime-open");
            submitSearchAction(home, EditorInfo.IME_ACTION_SEARCH, "ime_search", true);
            screenshot("search-ime-hidden");
            openSearchIme(home, "ImeSmoke_Second", true);
            submitSearchAction(home, EditorInfo.IME_ACTION_DONE, "ime_done_second_search", true);
            openSearchIme(home, "ImeSmoke_Enter", true);
            submitSearchAction(home, EditorInfo.IME_NULL, "hardware_enter_down_up", true);
            screenshot("search-enter-hidden");
            openSearchIme(home, "ImeSmoke_Button", true);
            submitSearchAction(home, -1, "page_search_button", true);
            activateNavigation(home, 1);
            waitForIdleSync();
            openSearchIme(home, "ImeSmoke_NoMatchingChannel_27931", false);
            submitSearchAction(home, EditorInfo.IME_ACTION_SEARCH, "live_filter", false);
            onMain(() -> check(hasText(home.getWindow().getDecorView(), "没有匹配的频道"), "live_filter_local_empty_results"));
            screenshot("search-live-hidden");
            activateNavigation(home, 2);
            waitForIdleSync();
            openSearchIme(home, "ImeSmoke_Final", false);
            submitSearchAction(home, EditorInfo.IME_ACTION_SEARCH, "final_search", true);
            screenshot("search-final");
            result.putString("stream", "PASS " + profile + " " + checks + "\n");
            result.putString("checks", String.join(",", checks));
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            try { screenshot("search-failure"); } catch (Exception ignored) { }
            result.putString("stream", "FAIL " + profile + ": " + error + "\nChecks before failure: " + checks + "\n");
            result.putString("failure", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void openSearchIme(MainActivity home, String text, boolean returnByDpad) throws Exception {
        if (returnByDpad) {
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_LEFT);
            waitForIdleSync();
            onMain(() -> check(((EditText) field(home, "query")).isFocused(), "dpad_returns_to_search_input"));
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        } else {
            onMain(() -> {
                EditText input = (EditText) field(home, "query");
                check(input.requestFocus(), "search_input_focus");
                InputMethodManager keyboard = (InputMethodManager) home.getSystemService(Activity.INPUT_METHOD_SERVICE);
                keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
            });
        }
        awaitSearchIme(true, "system_ime_shown");
        onMain(() -> {
            EditText input = (EditText) field(home, "query");
            input.setText(text);
            input.setSelection(input.length());
        });
        waitForIdleSync();
    }

    private void submitSearchAction(MainActivity home, int action, String name, boolean rebuild) throws Exception {
        String[] typed = new String[1];
        int[] generation = new int[1];
        InputConnection[] connection = new InputConnection[1];
        onMain(() -> {
            EditText input = (EditText) field(home, "query");
            typed[0] = input.getText().toString();
            generation[0] = (Integer) field(home, "generation");
            connection[0] = input.onCreateInputConnection(new EditorInfo());
            check(connection[0] != null, name + "_input_connection");
            if (action == -1) {
                ViewGroup row = (ViewGroup) input.getParent();
                check(row.getChildAt(row.getChildCount() - 1).performClick(), name + "_clicked");
            }
            else if (action == EditorInfo.IME_NULL) connection[0].sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER));
            else check(connection[0].performEditorAction(action), name + "_action_delivered");
        });
        waitForIdleSync();
        if (action == EditorInfo.IME_NULL) {
            onMain(() -> check((Integer) field(home, "generation") == generation[0] + (rebuild ? 1 : 0), name + "_down_submits_once"));
            onMain(() -> connection[0].sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER)));
            waitForIdleSync();
        }
        awaitSearchIme(false, name + "_system_ime_hidden");
        onMain(() -> {
            check(typed[0].equals(((EditText) field(home, "query")).getText().toString()), name + "_query_preserved");
            View focus = home.getCurrentFocus();
            check(focus instanceof android.widget.Button && "搜索".contentEquals(((TextView) focus).getText()), name + "_focus_on_search_button");
            check((Integer) field(home, "generation") == generation[0] + (rebuild ? 1 : 0), name + "_submits_once");
        });
    }

    private void awaitSearchIme(boolean shown, String name) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 6000;
        boolean matched = false;
        int consecutive = 0;
        do {
            try (InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                    getUiAutomation().executeShellCommand("dumpsys input_method"));
                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                matched = output.toString("UTF-8").contains("mInputShown=" + shown);
            }
            consecutive = matched ? consecutive + 1 : 0;
            if (consecutive < (shown ? 1 : 3)) android.os.SystemClock.sleep(100);
        } while (consecutive < (shown ? 1 : 3) && android.os.SystemClock.elapsedRealtime() < deadline);
        check(consecutive >= (shown ? 1 : 3), name);
    }

    /** Fetch real source details and the real shared CDN image; this mode has no invented artwork. */
    private void verifyArtwork() {
        Bundle result = new Bundle();
        MainActivity home = null;
        try {
            home = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            final MainActivity activity = home;
            TvRepository repository = (TvRepository) field(home, "repository");
            ArtworkRepository artwork = (ArtworkRepository) field(home, "artworkRepository");
            check(!artwork.hasCredential(), "artwork_no_tmdb_credential");
            TvRepository.VodItem movie = new TvRepository.VodItem(new TvRepository.Source("360资源", "https://360zy.com/api.php/provide/vod"),
                    "4342", "燃烧女子的肖像", "", "剧情片", "2019", "");
            TvRepository.VideoDetails detail = repository.detail(movie);
            check("燃烧女子的肖像".equals(detail.item.title), "artwork_real_source_title");
            check("2019".equals(detail.item.year), "artwork_real_source_year");
            check(!detail.item.cover.isEmpty() && !detail.episodes.isEmpty(), "artwork_real_poster_and_episodes");
            onMain(() -> invoke(activity, "detailDialog", new Class<?>[]{TvRepository.VideoDetails.class}, detail));
            waitForIdleSync();
            android.widget.ImageView[] loaded = new android.widget.ImageView[1];
            long deadline = android.os.SystemClock.elapsedRealtime() + 35000;
            while (loaded[0] == null && android.os.SystemClock.elapsedRealtime() < deadline) {
                onMain(() -> {
                    android.app.AlertDialog dialog = (android.app.AlertDialog) field(activity, "activeDetails");
                    if (dialog != null && detail.backdrop != null)
                        loaded[0] = imageForUrl(dialog.getWindow().getDecorView(), detail.backdrop.url(), null);
                });
                if (loaded[0] == null) android.os.SystemClock.sleep(100);
            }
            check(detail.backdrop != null && detail.backdrop.tmdbId == 531428, "artwork_verified_tmdb_531428");
            check(detail.backdrop.width == 3840 && detail.backdrop.height == 2160, "artwork_verified_metadata_3840x2160");
            check(loaded[0] != null, "artwork_real_cdn_bitmap_loaded");
            Bitmap[] original = new Bitmap[1];
            onMain(() -> original[0] = ((android.graphics.drawable.BitmapDrawable) loaded[0].getDrawable()).getBitmap());
            check(original[0].getWidth() > 1600 && original[0].getWidth() <= 3840
                    && (long) original[0].getWidth() * original[0].getHeight() <= ImageDecodePolicy.UHD_PIXELS,
                    "artwork_actual_decode_" + original[0].getWidth() + "x" + original[0].getHeight());
            check((double) original[0].getWidth() / original[0].getHeight() > 1.5, "artwork_landscape_separate_from_poster");
            screenshot("artwork-details");
            PosterLoader posters = (PosterLoader) field(home, "posters");
            onMain(() -> posters.loadBackdrop("http://127.0.0.1:1/unavailable-backdrop.jpg", detail.item.cover, loaded[0]));
            android.widget.ImageView[] restored = new android.widget.ImageView[1];
            deadline = android.os.SystemClock.elapsedRealtime() + 25000;
            while (restored[0] == null && android.os.SystemClock.elapsedRealtime() < deadline) {
                onMain(() -> {
                    restored[0] = imageForUrl(loaded[0], detail.item.cover, original[0]);
                });
                if (restored[0] == null) android.os.SystemClock.sleep(100);
            }
            check(restored[0] != null, "artwork_failed_download_restores_current_source_cover");
            onMain(() -> {
                Bitmap fallback = ((android.graphics.drawable.BitmapDrawable) loaded[0].getDrawable()).getBitmap();
                check(fallback != original[0], "artwork_background_replaced_with_cover_" + fallback.getWidth() + "x" + fallback.getHeight());
            });
            screenshot("artwork-fallback");
            onMain(() -> {
                ((android.app.AlertDialog) field(activity, "activeDetails")).dismiss();
                invoke(activity, "showSettings", new Class<?>[]{});
            });
            waitForIdleSync();
            check(hasText(home.getWindow().getDecorView(), "高清图片 / TMDB"), "artwork_native_settings");
            check(hasText(home.getWindow().getDecorView(), "This product uses the TMDB API but is not endorsed or certified by TMDB."), "artwork_tmdb_official_attribution");
            onMain(() -> {
                View label = textView(activity.getWindow().getDecorView(), "高清图片 / TMDB");
                if (label != null) label.requestRectangleOnScreen(new android.graphics.Rect(0, 0, label.getWidth(), label.getHeight() + 600), true);
            });
            screenshot("artwork-settings");
            onMain(() -> {
                View label = textView(activity.getWindow().getDecorView(), "高清图片来源：TMDB\nThis product uses the TMDB API but is not endorsed or certified by TMDB.");
                if (label != null) label.requestRectangleOnScreen(new android.graphics.Rect(0, -100, label.getWidth(), label.getHeight() + 160), true);
            });
            screenshot("artwork-attribution");
            result.putString("stream", "PASS " + profile + " " + checks + "\n");
            result.putString("checks", String.join(",", checks));
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL " + profile + ": " + error + "\nChecks before failure: " + checks + "\n");
            result.putString("failure", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private static android.widget.ImageView imageForUrl(View view, String url, Bitmap differentFrom) {
        if (view instanceof android.widget.ImageView && view.getTag() != null) {
            try {
                android.widget.ImageView image = (android.widget.ImageView) view;
                if (url.equals(field(view.getTag(), "url")) && image.getDrawable() instanceof android.graphics.drawable.BitmapDrawable) {
                    Bitmap bitmap = ((android.graphics.drawable.BitmapDrawable) image.getDrawable()).getBitmap();
                    if (bitmap != differentFrom && bitmap.getWidth() > 0 && bitmap.getHeight() > 0) return image;
                }
            } catch (RuntimeException ignored) { }
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.widget.ImageView image = imageForUrl(group.getChildAt(i), url, differentFrom);
                if (image != null) return image;
            }
        }
        return null;
    }

    private static View textView(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                View found = textView(group.getChildAt(i), text);
                if (found != null) return found;
            }
        }
        return null;
    }

    private void verifyTvControls(PlaybackActivity activity) throws Exception {
        TvPlaybackControls controls = (TvPlaybackControls) field(activity, "tvControls");
        check(controls != null, "custom_tv_player_ui");
        setInTouchMode(false);
        onMain(() -> {
            check(!((androidx.media3.ui.PlayerView) field(activity, "playerView")).getUseController(), "native_coarse_controller_disabled");
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            player.pause(); player.seekTo(1000); controls.showChrome(); controls.playButton.requestFocus();
        });
        waitForIdleSync();
        onMain(() -> {
            check(controls.playButton.isFocused(), "tv_initial_play_focus");
            View progress = controls.findViewWithTag("tv-player-progress");
            int[] progressLocation = new int[2], playLocation = new int[2];
            progress.getLocationOnScreen(progressLocation); controls.playButton.getLocationOnScreen(playLocation);
            check(progressLocation[1] + progress.getHeight() <= playLocation[1], "tv_thin_progress_above_transport");
            check(controls.top.getChildCount() == 3, "tv_top_only_back_title_more");
        });
        screenshot("tv-player-layout");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);
        onMain(() -> check(controls.nextButton.isFocused(), "dpad_moves_focus_between_transport_buttons"));
        onMain(() -> controls.hideChrome());
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> check(((ExoPlayer) field(activity, "player")).getPlayWhenReady(), "hidden_center_resumes_playback"));
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> check(!((ExoPlayer) field(activity, "player")).getPlayWhenReady(), "focused_center_pauses_playback"));
        onMain(() -> { ((ExoPlayer) field(activity, "player")).seekTo(1000); controls.hideChrome(); });
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);
        onMain(() -> check(((ExoPlayer) field(activity, "player")).getCurrentPosition() >= 10000, "fullscreen_dpad_seeks_forward_ten_seconds"));
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_LEFT);
        onMain(() -> check(((ExoPlayer) field(activity, "player")).getCurrentPosition() < 2000, "fullscreen_dpad_seeks_back_ten_seconds"));
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP);
        onMain(() -> check(controls.isChromeVisible() && controls.playButton.isFocused(), "dpad_up_reveals_focused_transport"));
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP);
        onMain(() -> check(controls.findViewWithTag("tv-player-progress").isFocused(), "dpad_up_focuses_progress"));
        onMain(() -> controls.findViewWithTag("tv-player-speed").requestFocus());
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        screenshot("tv-speed");
        focusTvOption(controls, "tv-speed-1.5");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> {
            check(Math.abs(((ExoPlayer) field(activity, "player")).getPlaybackParameters().speed - 1.5f) < .01f, "tv_speed_controls_real_player_rate");
            check(Math.abs(activity.getSharedPreferences("kongwotv_playback", 0).getFloat("tv_speed", 1f) - 1.5f) < .01f, "tv_speed_is_persisted");
        });
        focusTvTransport(activity, controls, "tv-player-resize");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        screenshot("tv-settings");
        focusTvOption(controls, "tv-resize-fill");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> check(((androidx.media3.ui.PlayerView) field(activity, "playerView")).getResizeMode() == androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM, "tv_fill_changes_actual_video_resize_mode"));
        focusTvTransport(activity, controls, "tv-player-resize");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        focusTvOption(controls, "tv-resize-fit");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> check(((androidx.media3.ui.PlayerView) field(activity, "playerView")).getResizeMode() == androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT, "tv_fit_restores_video_aspect_ratio"));
        focusTvTransport(activity, controls, "tv-player-episodes");
        sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        onMain(() -> check(field(controls, "sheet") != null, "menu_key_opens_episode_drawer"));
        screenshot("tv-episodes");
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        onMain(() -> check(field(controls, "sheet") == null && !activity.isFinishing(), "back_closes_tv_drawer_first"));
        focusTvTransport(activity, controls, "tv-player-episodes");
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        onMain(() -> check(!controls.isChromeVisible() && !activity.isFinishing(), "back_hides_tv_controls_before_exit"));
        sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        focusTvOption(controls, "tv-episode-1");
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        onMain(() -> {
            check((Integer) field(activity, "currentIndex") == 1, "tv_drawer_selection_changes_episode");
            check(Math.abs(((ExoPlayer) field(activity, "player")).getPlaybackParameters().speed - 1.5f) < .01f, "tv_episode_keeps_selected_speed");
            invoke(activity, "selectItem", new Class<?>[]{int.class, boolean.class}, 0, false);
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            player.setPlaybackSpeed(1f); player.seekTo(1000); player.play();
            activity.getSharedPreferences("kongwotv_playback", 0).edit().putFloat("tv_speed", 1f).apply();
            controls.showChrome(); controls.playButton.requestFocus();
        });
        awaitPlayback(activity);
    }

    private void verifyTvLiveControls(Intent vod) throws Exception {
        Intent intent = new Intent(vod).putExtra("live", true).putExtra("title", "幕里 直播频道验证").putExtra("searchTitle", "smoke-live");
        PlaybackActivity activity = (PlaybackActivity) startActivitySync(intent);
        awaitPlayback(activity);
        TvPlaybackControls controls = (TvPlaybackControls) field(activity, "tvControls");
        focusTvTransport(activity, controls, "tv-player-play");
        onMain(() -> {
            check(controls.findViewWithTag("tv-player-progress").getVisibility() == View.GONE, "live_hides_tv_seek_bar");
            check(controls.findViewWithTag("tv-player-speed").getVisibility() == View.GONE, "live_hides_tv_speed_entry");
            check(Math.abs(((ExoPlayer) field(activity, "player")).getPlaybackParameters().speed - 1f) < .01f, "live_uses_normal_playback_rate");
            controls.hideChrome();
        });
        sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
        onMain(() -> {
            check((Integer) field(activity, "currentIndex") == 1, "fullscreen_dpad_changes_live_channel");
            check(!controls.isChromeVisible(), "live_channel_switch_keeps_immersive_view");
            ((ExoPlayer) field(activity, "player")).pause();
        });
        sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        onMain(() -> {
            android.app.Dialog dialog = (android.app.Dialog) field(controls, "sheet");
            check(dialog != null && hasText(dialog.getWindow().getDecorView(), "选择频道"), "live_menu_shows_channel_drawer");
        });
        screenshot("tv-live-channels");
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        focusTvTransport(activity, controls, "tv-player-episodes");
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        onMain(() -> check(activity.isFinishing(), "tv_back_exits_after_drawer_and_chrome_close"));
    }

    private void focusTvTransport(PlaybackActivity activity, TvPlaybackControls controls, String tag) {
        AtomicBoolean focused = new AtomicBoolean();
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        while (!focused.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
            onMain(() -> focused.set(activity.hasWindowFocus() && field(controls, "sheet") == null));
            if (!focused.get()) android.os.SystemClock.sleep(50);
        }
        check(focused.get(), "tv_activity_window_focus_restored");
        onMain(() -> check(controls.findViewWithTag(tag).requestFocus(), "tv_transport_focus_" + tag));
        waitForIdleSync();
    }

    private void focusTvOption(TvPlaybackControls controls, String tag) {
        AtomicBoolean focused = new AtomicBoolean();
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        while (!focused.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
            onMain(() -> {
                android.app.Dialog dialog = (android.app.Dialog) field(controls, "sheet");
                focused.set(dialog != null && dialog.isShowing() && dialog.getWindow().getDecorView().hasWindowFocus());
            });
            if (!focused.get()) android.os.SystemClock.sleep(50);
        }
        check(focused.get(), "tv_drawer_window_focus_" + tag);
        onMain(() -> {
            android.app.Dialog dialog = (android.app.Dialog) field(controls, "sheet");
            check(dialog != null && dialog.isShowing(), "tv_drawer_visible_for_" + tag);
            View option = dialog.getWindow().getDecorView().findViewWithTag(tag);
            check(option != null && option.requestFocus(), "tv_focus_" + tag);
        });
        waitForIdleSync();
    }

    private void verifyMobileControls(PlaybackActivity activity) throws Exception {
        MobilePlaybackControls controls = (MobilePlaybackControls) field(activity, "mobileControls");
        check(controls != null, "custom_mobile_player_ui");
        onMain(() -> {
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            player.pause(); player.seekTo(3000); player.setPlaybackSpeed(1.25f);
            invoke(controls, "setChromeVisible", new Class<?>[]{boolean.class}, false);
        });
        waitForIdleSync();
        View surface = controls.findViewWithTag("mobile-player-surface");
        check(surface != null && surface.getHeight() > 0, "mobile_gesture_surface");
        float[] origin = surfacePoint(surface, .38f, .45f);
        float[] destination = surfacePoint(surface, .70f, .45f);
        long down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, origin[0], origin[1]);
        pointer(down, android.view.MotionEvent.ACTION_MOVE, destination[0], destination[1]);
        onMain(() -> check(Math.abs(((ExoPlayer) field(activity, "player")).getCurrentPosition() - 3000) < 150, "seek_preview_does_not_commit"));
        screenshot("gesture-progress");
        pointer(down, android.view.MotionEvent.ACTION_CANCEL, destination[0], destination[1]);
        onMain(() -> check(Math.abs(((ExoPlayer) field(activity, "player")).getCurrentPosition() - 3000) < 150, "canceled_seek_preserves_position"));
        drag(surface, .38f, .45f, .70f, .45f);
        onMain(() -> check(((ExoPlayer) field(activity, "player")).getCurrentPosition() > 5000, "horizontal_swipe_commits_on_release"));
        long[] beforeMulti = new long[1];
        onMain(() -> beforeMulti[0] = ((ExoPlayer) field(activity, "player")).getCurrentPosition());
        down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, origin[0], origin[1]);
        pointer(down, android.view.MotionEvent.ACTION_MOVE, destination[0], destination[1]);
        twoPointers(down, android.view.MotionEvent.ACTION_POINTER_DOWN | (1 << android.view.MotionEvent.ACTION_POINTER_INDEX_SHIFT), destination[0], destination[1]);
        twoPointers(down, android.view.MotionEvent.ACTION_MOVE, destination[0] + 30, destination[1]);
        twoPointers(down, android.view.MotionEvent.ACTION_POINTER_UP | (1 << android.view.MotionEvent.ACTION_POINTER_INDEX_SHIFT), destination[0] + 30, destination[1]);
        pointer(down, android.view.MotionEvent.ACTION_UP, destination[0] + 30, destination[1]);
        onMain(() -> check(Math.abs(((ExoPlayer) field(activity, "player")).getCurrentPosition() - beforeMulti[0]) < 150, "second_finger_cancels_pending_seek"));
        onMain(() -> {
            android.view.WindowManager.LayoutParams attrs = activity.getWindow().getAttributes();
            attrs.screenBrightness = .4f; activity.getWindow().setAttributes(attrs);
        });
        drag(surface, .25f, .68f, .25f, .32f);
        onMain(() -> check(activity.getWindow().getAttributes().screenBrightness > .7f, "left_swipe_changes_window_brightness"));
        screenshot("gesture-brightness");
        onMain(() -> check(!(Boolean) field(controls, "chromeVisible"), "paused_seek_buffering_keeps_controls_hidden"));
        android.media.AudioManager audio = (android.media.AudioManager) activity.getSystemService(android.content.Context.AUDIO_SERVICE);
        int oldVolume = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
        int maximum = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
        if (!audio.isVolumeFixed() && maximum > 0) {
            audio.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, maximum / 3, 0);
            long volumeDeadline = android.os.SystemClock.elapsedRealtime() + 2000;
            while (audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) != maximum / 3
                    && android.os.SystemClock.elapsedRealtime() < volumeDeadline) android.os.SystemClock.sleep(50);
            int baseline = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
            check(baseline == maximum / 3, "media_volume_baseline_ready");
            drag(surface, .75f, .68f, .75f, .32f);
            volumeDeadline = android.os.SystemClock.elapsedRealtime() + 2000;
            while (audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) <= baseline
                    && android.os.SystemClock.elapsedRealtime() < volumeDeadline) android.os.SystemClock.sleep(50);
            screenshot("gesture-volume");
            int adjusted = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
            check(adjusted > baseline, "right_swipe_changes_system_media_volume (" + baseline + " -> " + adjusted + "/" + maximum + ")");
            audio.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, oldVolume, 0);
        }
        onMain(() -> {
            controls.showChrome();
            controls.findViewWithTag("mobile-player-lock").performClick();
        });
        doubleTap(surface, .5f, .45f);
        drag(surface, .38f, .45f, .70f, .45f);
        onMain(() -> {
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            check(!player.getPlayWhenReady(), "locked_double_tap_cannot_play");
            check(Math.abs(player.getCurrentPosition() - 6840) < 250, "locked_swipe_cannot_seek");
            check(controls.handleBack(), "locked_back_requires_unlock");
        });
        screenshot("player-locked");
        onMain(() -> {
            controls.findViewWithTag("mobile-player-lock").performClick();
            invoke(controls, "setChromeVisible", new Class<?>[]{boolean.class}, false);
        });
        float[] middle = surfacePoint(surface, .5f, .45f);
        down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, middle[0], middle[1]);
        android.os.SystemClock.sleep(650);
        onMain(() -> {
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            check(!player.getPlayWhenReady() && Math.abs(player.getPlaybackParameters().speed - 1.25f) < .01f, "paused_long_press_keeps_paused");
        });
        pointer(down, android.view.MotionEvent.ACTION_UP, middle[0], middle[1]);
        doubleTap(surface, .5f, .45f);
        onMain(() -> check(((ExoPlayer) field(activity, "player")).getPlayWhenReady(), "double_tap_toggles_playback"));
        onMain(() -> ((ExoPlayer) field(activity, "player")).seekTo(1000));
        awaitPlayback(activity);
        onMain(() -> invoke(controls, "setChromeVisible", new Class<?>[]{boolean.class}, false));
        down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, middle[0], middle[1]);
        android.os.SystemClock.sleep(650);
        onMain(() -> check(Math.abs(((ExoPlayer) field(activity, "player")).getPlaybackParameters().speed - 2f) < .01f, "long_press_temporarily_boosts_speed"));
        screenshot("gesture-speed");
        pointer(down, android.view.MotionEvent.ACTION_CANCEL, middle[0], middle[1]);
        onMain(() -> check(Math.abs(((ExoPlayer) field(activity, "player")).getPlaybackParameters().speed - 1.25f) < .01f, "cancel_restores_selected_speed"));
        down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, middle[0], middle[1]);
        android.os.SystemClock.sleep(650);
        pointer(down, android.view.MotionEvent.ACTION_UP, middle[0], middle[1]);
        onMain(() -> {
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            check(Math.abs(player.getPlaybackParameters().speed - 1.25f) < .01f, "release_restores_selected_speed");
            player.pause(); controls.showChrome();
        });
        screenshot("player-portrait");
        onMain(() -> controls.showEpisodes());
        onMain(() -> invoke(activity, "toggleMobileFullscreen", new Class<?>[]{}));
        awaitOrientation(activity, android.content.res.Configuration.ORIENTATION_LANDSCAPE);
        screenshot("player-landscape");
        onMain(() -> {
            check(((Boolean) field(activity, "mobileFullscreen")), "landscape_immersive_player");
            check(((View) field(activity, "mobileDetails")).getVisibility() == View.GONE, "fullscreen_hides_portrait_details");
            check(field(controls, "sheet") == null, "rotation_closes_orientation_specific_sheet");
            activity.onBackPressed();
        });
        awaitOrientation(activity, android.content.res.Configuration.ORIENTATION_PORTRAIT);
        onMain(() -> {
            check(!activity.isFinishing(), "back_exits_fullscreen_before_leaving");
            ExoPlayer player = (ExoPlayer) field(activity, "player");
            player.seekTo(1000); player.play();
        });
    }

    private void awaitPlayback(PlaybackActivity activity) {
        AtomicBoolean ready = new AtomicBoolean();
        long deadline = android.os.SystemClock.elapsedRealtime() + 8000;
        while (!ready.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
            onMain(() -> ready.set(((ExoPlayer) field(activity, "player")).isPlaying()));
            if (!ready.get()) android.os.SystemClock.sleep(100);
        }
        check(ready.get(), "gesture_test_video_playing");
    }

    private void awaitOrientation(PlaybackActivity activity, int orientation) {
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        while (activity.getResources().getConfiguration().orientation != orientation && android.os.SystemClock.elapsedRealtime() < deadline)
            android.os.SystemClock.sleep(100);
        waitForIdleSync();
        check(activity.getResources().getConfiguration().orientation == orientation, "orientation_" + orientation);
        // Surface rotation animations outlive the configuration callback.
        android.os.SystemClock.sleep(700);
        waitForIdleSync();
    }

    private float[] surfacePoint(View surface, float x, float y) {
        float[] point = new float[2];
        onMain(() -> {
            int[] location = new int[2]; surface.getLocationOnScreen(location);
            point[0] = location[0] + surface.getWidth() * x;
            point[1] = location[1] + surface.getHeight() * y;
        });
        return point;
    }

    private void pointer(long down, int action, float x, float y) {
        android.view.MotionEvent event = android.view.MotionEvent.obtain(down, android.os.SystemClock.uptimeMillis(), action, x, y, 0);
        sendPointerSync(event); event.recycle();
    }

    private void twoPointers(long down, int action, float x, float y) {
        android.view.MotionEvent.PointerProperties[] properties = new android.view.MotionEvent.PointerProperties[2];
        android.view.MotionEvent.PointerCoords[] coordinates = new android.view.MotionEvent.PointerCoords[2];
        for (int i = 0; i < 2; i++) {
            properties[i] = new android.view.MotionEvent.PointerProperties();
            properties[i].id = i; properties[i].toolType = android.view.MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new android.view.MotionEvent.PointerCoords();
            coordinates[i].x = x + i * 50; coordinates[i].y = y;
            coordinates[i].pressure = 1; coordinates[i].size = 1;
        }
        android.view.MotionEvent event = android.view.MotionEvent.obtain(down, android.os.SystemClock.uptimeMillis(), action,
                2, properties, coordinates, 0, 0, 1, 1, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0);
        sendPointerSync(event); event.recycle();
    }

    private void drag(View surface, float x1, float y1, float x2, float y2) {
        float[] a = surfacePoint(surface, x1, y1), b = surfacePoint(surface, x2, y2);
        long down = android.os.SystemClock.uptimeMillis();
        pointer(down, android.view.MotionEvent.ACTION_DOWN, a[0], a[1]);
        for (int step = 1; step <= 6; step++) {
            pointer(down, android.view.MotionEvent.ACTION_MOVE, a[0] + (b[0] - a[0]) * step / 6, a[1] + (b[1] - a[1]) * step / 6);
            android.os.SystemClock.sleep(16);
        }
        pointer(down, android.view.MotionEvent.ACTION_UP, b[0], b[1]);
        waitForIdleSync();
    }

    private void doubleTap(View surface, float x, float y) {
        float[] point = surfacePoint(surface, x, y);
        for (int tap = 0; tap < 2; tap++) {
            long down = android.os.SystemClock.uptimeMillis();
            pointer(down, android.view.MotionEvent.ACTION_DOWN, point[0], point[1]);
            pointer(down, android.view.MotionEvent.ACTION_UP, point[0], point[1]);
            android.os.SystemClock.sleep(80);
        }
        waitForIdleSync();
    }

    private void activateNavigation(MainActivity home, int index) {
        if (BuildConfig.IS_TV) {
            setInTouchMode(false);
            waitForIdleSync();
            // The first injected D-pad key can establish window input focus on a cold AVD.
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP);
            onMain(() -> check(home.getWindow().getDecorView().findViewWithTag("navigation:0").requestFocus(), "dpad_navigation_start_focus"));
            waitForIdleSync();
            for (int i = 0; i < index; i++) {
                sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);
                final int expected = i + 1;
                onMain(() -> check(home.getWindow().getDecorView().findViewWithTag("navigation:" + expected).isFocused(), "dpad_focus_navigation_" + expected));
            }
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            checks.add("dpad_navigation_" + index);
        } else {
            int[] position = new int[2];
            onMain(() -> {
                View target = home.getWindow().getDecorView().findViewWithTag("navigation:" + index);
                target.getLocationOnScreen(position);
                position[0] += target.getWidth() / 2;
                position[1] += target.getHeight() / 2;
            });
            long now = android.os.SystemClock.uptimeMillis();
            android.view.MotionEvent down = android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, position[0], position[1], 0);
            android.view.MotionEvent up = android.view.MotionEvent.obtain(now, now + 40, android.view.MotionEvent.ACTION_UP, position[0], position[1], 0);
            sendPointerSync(down);
            sendPointerSync(up);
            down.recycle(); up.recycle();
            checks.add("touch_navigation_" + index);
        }
    }

    private void screenshot(String name) throws Exception {
        waitForIdleSync();
        try { getUiAutomation().waitForIdle(100, 2000); } catch (java.util.concurrent.TimeoutException ignored) { }
        android.os.SystemClock.sleep(180);
        Bitmap image = getUiAutomation().takeScreenshot();
        check(image != null, "screenshot_" + name);
        File path = new File(getTargetContext().getExternalFilesDir(null), "smoke-" + profile + "-" + name + ".png");
        try (OutputStream output = new FileOutputStream(path)) { image.compress(Bitmap.CompressFormat.PNG, 100, output); }
        image.recycle();
        if (artworkOnly || searchOnly || homeOnly || commentaryOnly) {
            String publicPath = "/data/local/tmp/kongwo-" + profile.replaceAll("[^A-Za-z0-9_-]", "_") + "-" + name + ".png";
            try (InputStream completion = new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                    getUiAutomation().executeShellCommand("/system/bin/screencap -p " + publicPath))) {
                byte[] buffer = new byte[1024];
                while (completion.read(buffer) != -1) { /* Drain until the native screenshot is complete. */ }
            }
        }
    }

    private void onMain(Runnable action) {
        final Throwable[] failure = new Throwable[1];
        super.runOnMainSync(() -> {
            try { action.run(); } catch (Throwable error) { failure[0] = error; }
        });
        if (failure[0] instanceof Error) throw (Error) failure[0];
        if (failure[0] instanceof RuntimeException) throw (RuntimeException) failure[0];
        if (failure[0] != null) throw new IllegalStateException(failure[0]);
    }

    private void check(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
        checks.add(name);
    }

    private static Object field(Object target, String name) {
        try {
            Field value = target.getClass().getDeclaredField(name);
            value.setAccessible(true);
            return value.get(target);
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    private static void invoke(Object target, String name, Class<?>[] types, Object... arguments) {
        try {
            Method method = target.getClass().getDeclaredMethod(name, types);
            method.setAccessible(true);
            method.invoke(target, arguments);
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    private static boolean hasText(View view, String wanted) {
        if (view instanceof TextView) {
            TextView text = (TextView) view;
            if (text.getText().toString().contains(wanted) || (text.getHint() != null && text.getHint().toString().contains(wanted))) return true;
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (hasText(group.getChildAt(i), wanted)) return true;
        }
        return false;
    }

    private static boolean isAscii(String text) {
        for (int i = 0; i < text.length(); i++) if (text.charAt(i) > 127) return false;
        return true;
    }

    private void serve(ServerSocket server, byte[] fixture) {
        while (!server.isClosed()) {
            try (Socket socket = server.accept()) {
                socket.setSoTimeout(5000);
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
                int start = 0;
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (line.startsWith("Range: bytes=")) {
                        try { start = Integer.parseInt(line.substring(13).split("-")[0]); } catch (RuntimeException ignored) { }
                    }
                    if (line.startsWith("User-Agent:")) brandedAsciiUa.set(line.contains("Muli/2.16.12") && isAscii(line));
                }
                start = Math.max(0, Math.min(start, fixture.length - 1));
                String header = "HTTP/1.1 " + (start > 0 ? "206 Partial Content" : "200 OK") + "\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: " + (fixture.length - start)
                        + (start > 0 ? "\r\nContent-Range: bytes " + start + "-" + (fixture.length - 1) + "/" + fixture.length : "") + "\r\nConnection: close\r\n\r\n";
                socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII));
                socket.getOutputStream().write(fixture, start, fixture.length - start);
            } catch (Exception ignored) { }
        }
    }
}
