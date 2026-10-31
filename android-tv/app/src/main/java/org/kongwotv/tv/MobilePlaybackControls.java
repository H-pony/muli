package org.kongwotv.tv;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.TimeBar;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Phone/tablet transport UI. TV retains its native D-pad controller. */
@UnstableApi
final class MobilePlaybackControls extends FrameLayout implements Player.Listener {
    interface Actions {
        void back();
        void fullscreen();
        void togglePlayback();
        void next();
        void select(int index);
        void switchSource();
        void seekCompleted();
        void resize(boolean fill);
        void lockChanged(boolean locked);
    }
    private static final int WHITE = 0xFFF5F5F7, MUTED = 0xFFB2B2BA;
    private static final int NONE = 0, SEEK = 1, BRIGHTNESS = 2, VOLUME = 3, BLOCKED = 4;
    private static final float[] SPEEDS = {.5f, .75f, 1f, 1.25f, 1.5f, 2f, 3f};
    private final Activity activity;
    private final Actions actions;
    private final boolean live;
    private final AudioManager audio;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final LinearLayout top, bottom;
    private LinearLayout hud;
    private final TextView title, time, speed, list, hudText, boostBanner;
    private final ImageButton play, next, fullscreen, lock;
    private final DefaultTimeBar progress;
    private final ProgressBar hudProgress;
    private final MiniProgress miniProgress;
    private final GestureDetector detector;
    private final ArrayList<String> names = new ArrayList<>();
    private ExoPlayer player;
    private Dialog sheet;
    private int index, gesture = NONE;
    private boolean chromeVisible = true, locked, landscape, scrubbing, touching, boosting, suspended;
    private float downX, downY, startBrightness, originalRate = 1f;
    private final float originalBrightness;
    private int startVolume;
    private long startPosition, seekPreview, gestureDuration;
    private final Runnable hideChrome = () -> setChromeVisible(false);
    private final Runnable hideHud = () -> hud.setVisibility(GONE);
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (suspended) return;
            refresh(); handler.postDelayed(this, 250);
        }
    };

    MobilePlaybackControls(Activity activity, boolean live, Actions actions) {
        super(activity);
        this.activity = activity; this.live = live; this.actions = actions;
        audio = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
        preferences = activity.getSharedPreferences("kongwotv_playback", Context.MODE_PRIVATE);
        originalBrightness = activity.getWindow().getAttributes().screenBrightness;
        setTag("mobile-player-controls");
        setClipChildren(false);
        View surface = new View(activity);
        surface.setTag("mobile-player-surface");
        surface.setOnClickListener(view -> setChromeVisible(!chromeVisible));
        surface.setContentDescription("播放画面，双击播放或暂停，横滑调整进度，左侧上下调整亮度，右侧上下调整音量");
        addView(surface, new LayoutParams(-1, -1));
        miniProgress = new MiniProgress(activity);
        addView(miniProgress, new LayoutParams(-1, dp(2), Gravity.BOTTOM));
        top = new LinearLayout(activity);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(8), dp(6), dp(12), dp(12));
        top.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xB8000000, 0x60000000, Color.TRANSPARENT}));
        top.addView(icon("back", "返回", actions::back), row(dp(44), dp(44)));
        title = text("", 14, WHITE);
        title.setSingleLine(); title.setEllipsize(TextUtils.TruncateAt.END);
        top.addView(title, new LinearLayout.LayoutParams(0, dp(44), 1));
        top.addView(icon("more", "播放设置", this::showSettings), row(dp(44), dp(44)));
        addView(top, new LayoutParams(-1, -2, Gravity.TOP));
        bottom = new LinearLayout(activity);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(12), dp(18), dp(12), dp(8));
        bottom.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{Color.TRANSPARENT, 0x60000000, 0xCD000000}));
        progress = new DefaultTimeBar(activity);
        progress.setTag("mobile-player-progress");
        progress.setPlayedColor(WHITE); progress.setScrubberColor(Color.WHITE);
        progress.setBufferedColor(0x88FFFFFF); progress.setUnplayedColor(0x44FFFFFF);
        progress.setContentDescription("视频播放进度");
        progress.addListener(new TimeBar.OnScrubListener() {
            @Override public void onScrubStart(TimeBar bar, long position) {
                cancelInteraction(); scrubbing = true;
                handler.removeCallbacks(hideChrome); previewScrub(position);
            }
            @Override public void onScrubMove(TimeBar bar, long position) { previewScrub(position); }
            @Override public void onScrubStop(TimeBar bar, long position, boolean canceled) {
                scrubbing = false;
                if (!canceled && canSeek()) { player.seekTo(clampPosition(position, duration())); actions.seekCompleted(); }
                hideHudSoon(); scheduleHide(); refresh();
            }
        });
        bottom.addView(progress, row(-1, dp(30)));
        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        play = icon("pause", "暂停", () -> { actions.togglePlayback(); showChrome(); });
        play.setTag("mobile-player-play");
        controls.addView(play, row(dp(40), dp(44)));
        next = icon("next", live ? "下一频道" : "下一集", () -> { actions.next(); showChrome(); });
        controls.addView(next, row(dp(40), dp(44)));
        time = text(live ? "直播" : "00:00 / 00:00", 11, WHITE);
        time.setSingleLine();
        controls.addView(time, new LinearLayout.LayoutParams(0, dp(44), 1));
        speed = textButton("倍速", "选择播放倍速", this::showSpeeds);
        controls.addView(speed, row(dp(48), dp(44)));
        list = textButton(live ? "频道" : "选集", live ? "频道列表" : "选择剧集", this::showEpisodes);
        controls.addView(list, row(dp(48), dp(44)));
        fullscreen = icon("fullscreen", "全屏播放", actions::fullscreen);
        fullscreen.setTag("mobile-player-fullscreen");
        controls.addView(fullscreen, row(dp(40), dp(44)));
        bottom.addView(controls);
        addView(bottom, new LayoutParams(-1, -2, Gravity.BOTTOM));
        lock = icon("unlock", "锁定屏幕", () -> setLocked(!locked));
        lock.setBackground(rounded(0x55000000, 22));
        lock.setTag("mobile-player-lock");
        LayoutParams lockParams = new LayoutParams(dp(44), dp(44), Gravity.START | Gravity.CENTER_VERTICAL);
        lockParams.leftMargin = dp(12); addView(lock, lockParams);
        hud = new LinearLayout(activity);
        hud.setOrientation(LinearLayout.VERTICAL); hud.setGravity(Gravity.CENTER);
        hud.setPadding(dp(22), dp(16), dp(22), dp(16));
        hud.setBackground(rounded(0xEE111114, 12)); hud.setVisibility(GONE);
        hud.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        hudText = text("", 16, WHITE);
        hudText.setGravity(Gravity.CENTER); hudText.setLineSpacing(dp(6), 1f);
        hud.addView(hudText);
        hudProgress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        hudProgress.setMax(1000);
        hudProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(WHITE));
        hudProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(0x44FFFFFF));
        LinearLayout.LayoutParams hudBar = row(dp(150), dp(3)); hudBar.topMargin = dp(12);
        hud.addView(hudProgress, hudBar);
        addView(hud, new LayoutParams(-2, -2, Gravity.CENTER));
        boostBanner = text("", 13, WHITE);
        boostBanner.setPadding(dp(18), dp(8), dp(18), dp(8));
        boostBanner.setBackground(rounded(0xE6111114, 24)); boostBanner.setVisibility(GONE);
        LayoutParams boostParams = new LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        boostParams.topMargin = dp(20); addView(boostBanner, boostParams);
        detector = new GestureDetector(activity, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent event) { return true; }
            @Override public boolean onSingleTapConfirmed(MotionEvent event) {
                if (gesture != BLOCKED) surface.performClick();
                return true;
            }
            @Override public boolean onDoubleTap(MotionEvent event) {
                if (!locked && gesture != BLOCKED) { actions.togglePlayback(); showChrome(); }
                else if (locked) showChrome();
                return true;
            }
            @Override public void onLongPress(MotionEvent event) {
                if (!touching || locked || live || gesture != NONE || player == null || !player.isPlaying()) return;
                boosting = true; originalRate = player.getPlaybackParameters().speed;
                float temporary = Math.max(2f, originalRate);
                player.setPlaybackSpeed(temporary); setChromeVisible(false);
                boostBanner.setText("▶▶  " + rateLabel(temporary) + " 倍速播放中");
                boostBanner.setVisibility(VISIBLE);
                performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
            }
        });
        surface.setOnTouchListener(new OnTouchListener() {
            @Override @android.annotation.SuppressLint("ClickableViewAccessibility")
            public boolean onTouch(View view, MotionEvent event) { return handleTouch(event); }
        });
        if (live) { progress.setVisibility(GONE); miniProgress.setVisibility(GONE); speed.setVisibility(GONE); }
        refresh(); scheduleHide();
    }

    void bind(ExoPlayer nextPlayer) {
        cancelInteraction();
        if (player != null) player.removeListener(this);
        player = nextPlayer; suspended = nextPlayer == null;
        handler.removeCallbacks(tick);
        if (player != null) {
            float saved = preferences.getFloat("mobile_speed", 1f);
            player.setPlaybackSpeed(live ? 1f : Math.max(.5f, Math.min(3f, saved)));
            player.addListener(this); handler.post(tick); showChrome();
        }
        refresh();
    }
    void setItem(String heading, List<String> items, int selected) {
        cancelInteraction(); title.setText(heading);
        names.clear(); names.addAll(items); index = selected;
        list.setContentDescription((live ? "频道 " : "选集 ") + (index + 1) + "/" + names.size());
        next.setEnabled(index + 1 < names.size()); next.setAlpha(next.isEnabled() ? 1f : .35f);
        refresh();
    }
    void setLandscape(boolean landscape) {
        if (this.landscape != landscape) dismissSheet();
        cancelInteraction(); this.landscape = landscape;
        next.setVisibility(landscape ? VISIBLE : GONE);
        fullscreen.setImageDrawable(new ControlIcon(landscape ? "exitFullscreen" : "fullscreen"));
        fullscreen.setContentDescription(landscape ? "退出全屏" : "全屏播放"); showChrome();
    }
    void setSafeInsets(int left, int topInset, int right, int bottomInset) {
        top.setPadding(left + dp(8), topInset + dp(6), right + dp(12), dp(12));
        bottom.setPadding(left + dp(12), dp(18), right + dp(12), bottomInset + dp(8));
        LayoutParams lp = (LayoutParams) lock.getLayoutParams(); lp.leftMargin = left + dp(12); lock.setLayoutParams(lp);
    }
    void showChrome() { setChromeVisible(true); }
    private void setChromeVisible(boolean visible) {
        chromeVisible = visible;
        top.setVisibility(visible && !locked ? VISIBLE : GONE);
        bottom.setVisibility(visible && !locked ? VISIBLE : GONE);
        lock.setVisibility(visible ? VISIBLE : GONE);
        miniProgress.setVisibility(!visible && !live ? VISIBLE : GONE); scheduleHide();
    }
    private void scheduleHide() {
        handler.removeCallbacks(hideChrome);
        if (chromeVisible && !touching && !scrubbing && (locked || (player != null && player.getPlayWhenReady())))
            handler.postDelayed(hideChrome, 4000);
    }
    private void setLocked(boolean locked) {
        cancelInteraction(); this.locked = locked;
        lock.setImageDrawable(new ControlIcon(locked ? "lock" : "unlock"));
        lock.setContentDescription(locked ? "解除屏幕锁定" : "锁定屏幕");
        actions.lockChanged(locked); showChrome(); showToast(locked ? "屏幕已锁定，点击锁图标解锁" : "已解锁");
    }
    boolean handleBack() {
        if (sheet != null && sheet.isShowing()) { sheet.dismiss(); return true; }
        if (locked) { showChrome(); showToast("点击左侧锁图标解锁"); return true; }
        return false;
    }

    private boolean handleTouch(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            handler.removeCallbacks(hideChrome); touching = true; gesture = NONE;
            downX = event.getX(); downY = event.getY();
            startPosition = player == null ? 0 : player.getCurrentPosition(); seekPreview = startPosition;
            gestureDuration = duration(); startBrightness = brightness();
            startVolume = audio == null ? 0 : audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        } else if (action == MotionEvent.ACTION_POINTER_DOWN) {
            cancelInteraction(); touching = true; gesture = BLOCKED;
            MotionEvent cancel = MotionEvent.obtain(event); cancel.setAction(MotionEvent.ACTION_CANCEL);
            detector.onTouchEvent(cancel); cancel.recycle(); return true;
        }
        if (gesture == BLOCKED) {
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) { touching = false; gesture = NONE; scheduleHide(); }
            return true;
        }
        detector.onTouchEvent(event);
        if (action == MotionEvent.ACTION_MOVE && !locked && !boosting && touching) {
            float dx = event.getX() - downX, dy = event.getY() - downY;
            float threshold = Math.max(dp(10), ViewConfiguration.get(activity).getScaledTouchSlop());
            if (gesture == NONE && Math.max(Math.abs(dx), Math.abs(dy)) > threshold) {
                if (Math.abs(dx) > Math.abs(dy) * 1.2f) gesture = SEEK;
                else if (Math.abs(dy) > Math.abs(dx) * 1.2f) gesture = downX < getWidth() / 2f ? BRIGHTNESS : VOLUME;
                if (gesture != NONE) {
                    MotionEvent cancel = MotionEvent.obtain(event); cancel.setAction(MotionEvent.ACTION_CANCEL);
                    detector.onTouchEvent(cancel); cancel.recycle(); setChromeVisible(false);
                }
            }
            if (gesture == SEEK) {
                if (canSeek() && gestureDuration > 0) {
                    seekPreview = PlaybackGestureMath.seekTarget(startPosition, dx, getWidth(), gestureDuration);
                    long difference = seekPreview - startPosition;
                    showHud(formatTime(seekPreview) + " / " + formatTime(gestureDuration) + "\n"
                            + (difference >= 0 ? "快进 " : "快退 ") + formatTime(Math.abs(difference)), (float) seekPreview / gestureDuration);
                } else showHud(live ? "直播不支持调整进度" : "当前视频暂不支持调整进度", -1);
            } else if (gesture == BRIGHTNESS) {
                float value = PlaybackGestureMath.level(startBrightness, -dy, getHeight());
                WindowManager.LayoutParams attributes = activity.getWindow().getAttributes();
                attributes.screenBrightness = Math.max(.02f, value); activity.getWindow().setAttributes(attributes);
                showHud("亮度  " + Math.round(value * 100) + "%", value);
            } else if (gesture == VOLUME) {
                int max = audio == null ? 0 : audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if (max <= 0 || audio.isVolumeFixed()) showHud("请使用设备音量键调整音量", -1);
                else {
                    float value = PlaybackGestureMath.level((float) startVolume / max, -dy, getHeight());
                    try {
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(value * max), 0);
                        float actual = (float) audio.getStreamVolume(AudioManager.STREAM_MUSIC) / max;
                        showHud((actual == 0 ? "静音  " : "音量  ") + Math.round(actual * 100) + "%", actual);
                    } catch (SecurityException blocked) { showHud("请使用设备音量键调整音量", -1); }
                }
            }
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            if (action == MotionEvent.ACTION_UP && gesture == SEEK && canSeek()) {
                player.seekTo(clampPosition(seekPreview, duration())); actions.seekCompleted();
            }
            boolean hadGesture = gesture != NONE || boosting;
            restoreRate(); touching = false; gesture = NONE;
            if (hadGesture) hideHudSoon(); scheduleHide();
        }
        return true;
    }
    private float brightness() {
        float value = activity.getWindow().getAttributes().screenBrightness;
        if (value < 0) {
            try { value = Settings.System.getInt(activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f; }
            catch (Settings.SettingNotFoundException unavailable) { value = .5f; }
        }
        return Math.max(0f, Math.min(1f, value));
    }
    void cancelInteraction() {
        restoreRate(); touching = false; scrubbing = false; gesture = NONE;
        handler.removeCallbacks(hideHud); hud.setVisibility(GONE);
        if (detector != null) {
            long now = android.os.SystemClock.uptimeMillis();
            MotionEvent cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0, 0, 0);
            detector.onTouchEvent(cancel); cancel.recycle();
        }
    }
    private void restoreRate() {
        if (boosting && player != null) player.setPlaybackSpeed(originalRate);
        boosting = false; boostBanner.setVisibility(GONE);
    }
    void suspend() {
        cancelInteraction(); suspended = true; handler.removeCallbacksAndMessages(null);
        dismissSheet();
        WindowManager.LayoutParams attributes = activity.getWindow().getAttributes();
        attributes.screenBrightness = originalBrightness; activity.getWindow().setAttributes(attributes);
    }
    private void previewScrub(long position) {
        if (!canSeek()) return;
        long duration = duration();
        showHud(formatTime(position) + " / " + formatTime(duration), (float) position / duration);
        time.setText(formatTime(position) + " / " + formatTime(duration));
    }
    private void showHud(String value, float fraction) {
        handler.removeCallbacks(hideHud); hudText.setText(value);
        hudProgress.setVisibility(fraction < 0 ? GONE : VISIBLE);
        hudProgress.setProgress(Math.round(Math.max(0, Math.min(1, fraction)) * 1000)); hud.setVisibility(VISIBLE);
    }
    void showToast(String value) { showHud(value, -1); hideHudSoon(); }
    private void hideHudSoon() { handler.removeCallbacks(hideHud); handler.postDelayed(hideHud, 1000); }
    private long duration() { return player != null && player.getDuration() != C.TIME_UNSET ? Math.max(0, player.getDuration()) : 0; }
    private boolean canSeek() { return !live && !locked && player != null && player.isCurrentMediaItemSeekable() && duration() > 0; }
    private long clampPosition(long position, long total) { return Math.max(0, Math.min(position, total)); }
    private void refresh() {
        long duration = duration(), position = player == null ? 0 : Math.max(0, player.getCurrentPosition());
        boolean playing = player != null && player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED;
        play.setImageDrawable(new ControlIcon(playing ? "pause" : "play")); play.setContentDescription(playing ? "暂停" : "播放");
        if (!scrubbing && gesture != SEEK) {
            time.setText(live ? "●  直播" : formatTime(position) + " / " + formatTime(duration));
            progress.setDuration(duration); progress.setPosition(position);
            progress.setBufferedPosition(player == null ? 0 : player.getBufferedPosition());
        }
        progress.setEnabled(canSeek());
        float rate = player == null ? 1f : boosting ? originalRate : player.getPlaybackParameters().speed;
        speed.setText(rate == 1f ? "倍速" : rateLabel(rate) + "x");
        miniProgress.update(duration, position, player == null ? 0 : player.getBufferedPosition());
    }
    @Override public void onEvents(Player player, Player.Events events) {
        refresh();
        if (events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED)) {
            if (!player.getPlayWhenReady()) showChrome(); else scheduleHide();
        } else if (events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) && player.getPlaybackState() == Player.STATE_ENDED) {
            showChrome();
        }
    }

    void showEpisodes() {
        if (names.isEmpty() || locked) return;
        LinearLayout body = sheetBody((live ? "频道" : "选集") + "  (" + (index + 1) + "/" + names.size() + ")");
        ScrollView scroll = new ScrollView(activity);
        LinearLayout rows = new LinearLayout(activity); rows.setOrientation(LinearLayout.VERTICAL);
        LinearLayout selectedRow = null;
        for (int start = 0; start < names.size(); start += live ? 1 : 3) {
            LinearLayout row = new LinearLayout(activity);
            for (int column = 0; column < (live ? 1 : 3); column++) {
                final int target = start + column;
                if (target >= names.size()) { row.addView(new View(activity), new LinearLayout.LayoutParams(0, dp(50), 1)); continue; }
                TextView episode = textButton(names.get(target), names.get(target), () -> { dismissSheet(); actions.select(target); showChrome(); });
                episode.setTextColor(target == index ? 0xFF111114 : WHITE);
                episode.setBackground(rounded(target == index ? WHITE : 0xFF232327, 12));
                episode.setSingleLine(); episode.setEllipsize(TextUtils.TruncateAt.END);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(50), 1);
                params.setMargins(dp(4), dp(4), dp(4), dp(4)); row.addView(episode, params);
                if (target == index) selectedRow = row;
            }
            rows.addView(row);
        }
        scroll.addView(rows); body.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1)); showSheet(body);
        final LinearLayout targetRow = selectedRow;
        if (targetRow != null) scroll.post(() -> scroll.scrollTo(0, Math.max(0, targetRow.getTop() - dp(50))));
    }
    private void showSpeeds() {
        if (live || locked || player == null) return;
        LinearLayout body = sheetBody("播放速度");
        ScrollView scroll = new ScrollView(activity);
        LinearLayout options = new LinearLayout(activity); options.setOrientation(LinearLayout.VERTICAL);
        float current = player.getPlaybackParameters().speed;
        for (float rate : SPEEDS) {
            TextView option = textButton(rateLabel(rate) + "x" + (rate == 1f ? "  正常" : ""), rateLabel(rate) + "倍速", () -> {
                if (player != null) player.setPlaybackSpeed(rate);
                preferences.edit().putFloat("mobile_speed", rate).apply(); dismissSheet(); showChrome(); refresh();
            });
            option.setTextColor(rate == current ? 0xFF111114 : WHITE);
            option.setBackground(rounded(rate == current ? WHITE : Color.TRANSPARENT, 12));
            options.addView(option, row(-1, dp(48)));
        }
        scroll.addView(options); body.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1)); showSheet(body);
    }
    private void showSettings() {
        if (locked) return;
        LinearLayout body = sheetBody("播放设置");
        ScrollView scroll = new ScrollView(activity);
        LinearLayout options = new LinearLayout(activity); options.setOrientation(LinearLayout.VERTICAL);
        options.addView(textButton("切换播放源", "返回更换播放源", () -> { dismissSheet(); actions.switchSource(); }), row(-1, dp(48)));
        options.addView(textButton("适应画面", "按视频比例显示", () -> { actions.resize(false); dismissSheet(); }), row(-1, dp(48)));
        options.addView(textButton("铺满屏幕", "铺满屏幕，画面边缘可能被裁切", () -> { actions.resize(true); dismissSheet(); }), row(-1, dp(48)));
        TextView help = text("手势操作\n\n轻触：显示 / 隐藏控制栏\n双击：播放 / 暂停\n左右滑动：调整进度，松手跳转\n左侧上下滑动：调节亮度\n右侧上下滑动：调节音量\n长按：临时 2 倍速，松手恢复\n锁屏：避免误触", 12, MUTED);
        help.setLineSpacing(dp(5), 1); help.setPadding(dp(12), dp(18), dp(12), dp(20)); options.addView(help);
        scroll.addView(options); body.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1)); showSheet(body);
    }
    private LinearLayout sheetBody(String heading) {
        cancelInteraction(); handler.removeCallbacks(hideChrome);
        LinearLayout body = new LinearLayout(activity); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(22), dp(18), dp(22), dp(26)); body.setBackground(rounded(TvUi.SURFACE, 24));
        LinearLayout header = new LinearLayout(activity); header.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(text(heading, 22, WHITE), new LinearLayout.LayoutParams(0, dp(48), 1));
        header.addView(icon("close", "关闭面板", this::dismissSheet), row(dp(44), dp(44))); body.addView(header);
        return body;
    }
    private void showSheet(LinearLayout content) {
        dismissSheet(); sheet = new Dialog(activity); sheet.requestWindowFeature(Window.FEATURE_NO_TITLE);
        sheet.setContentView(content); sheet.setOnDismissListener(dialog -> { sheet = null; if (!suspended) showChrome(); });
        Window window = sheet.getWindow();
        if (window != null) {
            window.setBackgroundDrawableResource(android.R.color.transparent); window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams params = window.getAttributes(); params.dimAmount = .45f; window.setAttributes(params);
        }
        sheet.show();
        if (window != null) {
            int width = getResources().getDisplayMetrics().widthPixels, height = getResources().getDisplayMetrics().heightPixels;
            window.setGravity(landscape ? Gravity.END : Gravity.BOTTOM);
            window.setLayout(landscape ? Math.min(dp(340), width / 2) : Math.min(width, dp(600)), landscape ? -1 : Math.min(dp(460), Math.round(height * .66f)));
            window.getDecorView().setSystemUiVisibility(activity.getWindow().getDecorView().getSystemUiVisibility());
        }
    }
    private void dismissSheet() { if (sheet != null) { Dialog old = sheet; sheet = null; old.dismiss(); } }
    private ImageButton icon(String name, String description, Runnable action) {
        ImageButton button = new ImageButton(activity); button.setImageDrawable(new ControlIcon(name));
        button.setBackground(MobileUi.touchBackground(activity, Color.TRANSPARENT, 22, false)); button.setPadding(dp(10), dp(10), dp(10), dp(10));
        button.setContentDescription(description); button.setOnClickListener(view -> action.run()); return button;
    }
    private TextView textButton(String value, String description, Runnable action) {
        TextView button = text(value, 13, WHITE); button.setGravity(Gravity.CENTER); button.setContentDescription(description);
        button.setBackground(MobileUi.touchBackground(activity, Color.TRANSPARENT, 12, false));
        button.setFocusable(true); button.setOnClickListener(view -> action.run()); return button;
    }
    private TextView text(String value, int size, int color) {
        TextView label = new TextView(activity); label.setText(value); label.setTextSize(size); label.setTextColor(color);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); label.setGravity(Gravity.CENTER_VERTICAL);
        label.setIncludeFontPadding(false); return label;
    }
    private GradientDrawable rounded(int color, int radius) { GradientDrawable shape = new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(radius)); return shape; }
    private LinearLayout.LayoutParams row(int width, int height) { return new LinearLayout.LayoutParams(width, height); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static String rateLabel(float value) { return String.format(Locale.ROOT, "%.2f", value).replaceAll("0+$", "").replaceAll("\\.$", ""); }
    private static String formatTime(long millis) {
        long seconds = Math.max(0, millis / 1000);
        return seconds >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
                : String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60);
    }
    private static final class MiniProgress extends View {
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float position, buffered;
        MiniProgress(Context context) { super(context); }
        void update(long duration, long played, long buffered) {
            position = duration > 0 ? (float) played / duration : 0; this.buffered = duration > 0 ? (float) buffered / duration : 0; invalidate();
        }
        @Override protected void onDraw(Canvas canvas) {
            paint.setColor(0x33FFFFFF); canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
            paint.setColor(0x66FFFFFF); canvas.drawRect(0, 0, getWidth() * Math.min(1, buffered), getHeight(), paint);
            paint.setColor(WHITE); canvas.drawRect(0, 0, getWidth() * Math.min(1, position), getHeight(), paint);
        }
    }
    private static final class ControlIcon extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String name;
        ControlIcon(String name) { this.name = name; }
        @Override public void draw(Canvas canvas) {
            canvas.save(); canvas.translate(getBounds().left, getBounds().top);
            canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
            paint.setColor(Color.WHITE); paint.setStrokeWidth(1.8f); paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND); paint.setStyle(Paint.Style.STROKE);
            Path path = new Path();
            switch (name) {
                case "back": path.moveTo(15, 4); path.lineTo(7, 12); path.lineTo(15, 20); canvas.drawPath(path, paint); break;
                case "close": canvas.drawLine(6, 6, 18, 18, paint); canvas.drawLine(6, 18, 18, 6, paint); break;
                case "more": paint.setStyle(Paint.Style.FILL); for (int x = 5; x <= 19; x += 7) canvas.drawCircle(x, 12, 1.4f, paint); break;
                case "pause": paint.setStyle(Paint.Style.FILL); canvas.drawRoundRect(new RectF(5, 4, 9, 20), 1, 1, paint); canvas.drawRoundRect(new RectF(15, 4, 19, 20), 1, 1, paint); break;
                case "play": case "next":
                    path.moveTo(6, 4); path.lineTo(19, 12); path.lineTo(6, 20); path.close(); paint.setStyle(Paint.Style.FILL); canvas.drawPath(path, paint);
                    if (name.equals("next")) canvas.drawRect(19, 4, 21, 20, paint); break;
                case "lock": case "unlock":
                    canvas.drawRoundRect(new RectF(5, 10, 19, 21), 2, 2, paint);
                    canvas.drawArc(new RectF(8, 2, 16, 15), name.equals("lock") ? 180 : 210, name.equals("lock") ? 180 : 150, false, paint);
                    canvas.drawLine(8, 6, 8, 10, paint); if (name.equals("lock")) canvas.drawLine(16, 6, 16, 10, paint);
                    canvas.drawLine(12, 14, 12, 17, paint); break;
                case "exitFullscreen":
                    path.moveTo(3, 8); path.lineTo(8, 8); path.lineTo(8, 3); path.moveTo(16, 3); path.lineTo(16, 8); path.lineTo(21, 8);
                    path.moveTo(3, 16); path.lineTo(8, 16); path.lineTo(8, 21); path.moveTo(16, 21); path.lineTo(16, 16); path.lineTo(21, 16);
                    canvas.drawPath(path, paint); break;
                default:
                    path.moveTo(8, 3); path.lineTo(3, 3); path.lineTo(3, 8); path.moveTo(16, 3); path.lineTo(21, 3); path.lineTo(21, 8);
                    path.moveTo(3, 16); path.lineTo(3, 21); path.lineTo(8, 21); path.moveTo(16, 21); path.lineTo(21, 21); path.lineTo(21, 16);
                    canvas.drawPath(path, paint);
            }
            canvas.restore();
        }
        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
        @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
}
