package org.kongwotv.tv;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.StateListAnimator;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.os.Build;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.widget.ScrollView;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckedTextView;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.SSLException;

/**
 * Standalone TV playback. Requires Media3 exoplayer, exoplayer-hls and ui 1.5.1.
 *
 * Intent: urls / names (ArrayList<String>), index (int), title / searchTitle
 * (String), live (boolean). A valid explicit index wins; index=-1 or an absent
 * index restores the selection saved for this title. No layout resources needed.
 */
@UnstableApi
public final class PlaybackActivity extends Activity implements Player.Listener {
    private static final String PREFS = "kongwotv_playback";
    private static final String STATE_URL = "playback_url";
    private static final String STATE_POSITION = "playback_position";
    private static final String STATE_PLAY = "playback_play";
    private static final long SAVE_INTERVAL_MS = 5_000L;
    private static final long SEEK_MS = 10_000L;
    private static final int CONTROLLER_TIMEOUT_MS = 5_000;
    private static final int TEXT_PRIMARY = 0xFFF5F5F7;
    private static final int TEXT_SECONDARY = 0xFFB7B7BE;
    private static final int TEXT_FOCUSED = 0xFF19191C;
    private static final int ACCENT = TEXT_PRIMARY;
    private static final int FLOATING_SURFACE = 0xDE111114;
    private static final String USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) "
            + "Chrome/131.0.0.0 Safari/537.36 Muli/2.16.12";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<String> urls = new ArrayList<>();
    private final ArrayList<String> names = new ArrayList<>();
    private SharedPreferences preferences;
    private String title;
    private String searchTitle;
    private String selectionKey;
    private String contentItem;
    private int currentIndex;
    private boolean live;
    private boolean validArguments;
    private boolean resumed;
    private boolean playAfterResume = true;
    private long resumePositionMs;
    private int consumedKeyUp = KeyEvent.KEYCODE_UNKNOWN;
    private boolean useHls;
    private boolean useFlv;
    private boolean explicitFormat;
    private boolean triedOtherFormat;
    private boolean endActionPosted;
    private boolean sourceReady;
    private String failureMessage;

    private ExoPlayer player;
    private PlayerView playerView;
    private MobilePlaybackControls mobileControls;
    private TvPlaybackControls tvControls;
    private LinearLayout mobilePage;
    private FrameLayout mobileStage;
    private ScrollView mobileDetails;
    private TextView mobileTitle, mobileSubtitle;
    private LinearLayout mobileEpisodes;
    private boolean mobileFullscreen;
    private int unlockedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
    private int safeLeft, safeTop, safeRight, safeBottom;
    private LinearLayout topPanel;
    private LinearLayout loadingPanel;
    private TextView titleView;
    private TextView loadingText;
    private TextView actionMessage;
    private Button previousButton;
    private Button nextButton;
    private Button listButton;
    private Button playButton;
    private AlertDialog itemDialog;
    private AlertDialog errorDialog;

    private final Runnable hideMessage = () -> {
        if (actionMessage != null) actionMessage.setVisibility(View.GONE);
    };
    private final Runnable restoreControllerTimeout = () -> {
        if (playerView != null && topPanel != null && !topPanel.hasFocus()) {
            playerView.setControllerShowTimeoutMs(CONTROLLER_TIMEOUT_MS);
        }
    };
    private final Runnable saveProgress = new Runnable() {
        @Override
        public void run() {
            if (!resumed) return;
            savePlayback();
            handler.postDelayed(this, SAVE_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(BuildConfig.IS_TV ? R.style.AppTheme : R.style.MobileTheme);
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
        setRequestedOrientation(BuildConfig.IS_TV ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!readArguments(savedInstanceState)) {
            Toast.makeText(this, "没有可播放的地址，请返回重新选择视频源。", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        validArguments = true;
        buildUi();
        updateItemUi();
        enterImmersiveMode();
    }

    private boolean readArguments(Bundle state) {
        Intent intent = getIntent();
        if (intent == null) return false;
        try {
            live = intent.getBooleanExtra("live", false);
            title = clean(intent.getStringExtra("title"));
            searchTitle = clean(intent.getStringExtra("searchTitle"));
            contentItem = clean(intent.getStringExtra("contentItem"));
            if (searchTitle.isEmpty()) searchTitle = title;
            ArrayList<String> suppliedUrls = intent.getStringArrayListExtra("urls");
            ArrayList<String> suppliedNames = intent.getStringArrayListExtra("names");
            if (suppliedUrls == null || suppliedUrls.isEmpty()) return false;
            int requested = intent.getIntExtra("index", -1);
            int mappedIndex = -1;
            for (int i = 0; i < suppliedUrls.size(); i++) {
                String url = clean(suppliedUrls.get(i));
                if (!isHttpUrl(url)) continue;
                if (i == requested) mappedIndex = urls.size();
                urls.add(url);
                String name = suppliedNames != null && i < suppliedNames.size()
                        ? clean(suppliedNames.get(i)) : "";
                names.add(name.isEmpty() ? (live ? "频道 " : "第 ") + (i + 1)
                        + (live ? "" : " 集") : name);
            }
            if (urls.isEmpty()) return false;
            String identity = !searchTitle.isEmpty() ? searchTitle
                    : (!title.isEmpty() ? title : urls.get(0));
            String scopedKey = clean(intent.getStringExtra("contentKey"));
            String legacyKey = digest((live ? "live|" : "vod|") + identity);
            selectionKey = !live && !scopedKey.isEmpty() ? scopedKey : legacyKey;
            String savedUrl = state != null ? state.getString(STATE_URL) : null;
            int restoredIndex = savedUrl == null ? -1 : urls.indexOf(savedUrl);
            if (restoredIndex >= 0) {
                currentIndex = restoredIndex;
            } else if (mappedIndex >= 0) {
                currentIndex = mappedIndex;
            } else {
                String rememberedUrl = preferences.getString("selected_url_" + selectionKey, "");
                // Migrate a title-only record only when its actual URL belongs to this item.
                if (rememberedUrl.isEmpty() && !selectionKey.equals(legacyKey)) {
                    String legacyUrl = preferences.getString("selected_url_" + legacyKey, "");
                    if (urls.contains(legacyUrl)) rememberedUrl = legacyUrl;
                }
                currentIndex = PlaybackState.selectedIndex(urls, rememberedUrl,
                        preferences.getInt("selected_index_" + selectionKey, 0));
            }
            resumePositionMs = live ? 0L : preferences.getLong(progressKey(), 0L);
            if (!live && state == null && intent.hasExtra("resumePosition")) {
                resumePositionMs = intent.getLongExtra("resumePosition", resumePositionMs);
            }
            if (state != null && restoredIndex >= 0) {
                resumePositionMs = live ? 0L : state.getLong(STATE_POSITION, resumePositionMs);
                playAfterResume = state.getBoolean(STATE_PLAY, true);
            }
            resumePositionMs = Math.max(0L, resumePositionMs);
            return true;
        } catch (RuntimeException malformedExtras) {
            // Missing or incorrectly typed extras must never crash this screen.
            return false;
        }
    }

    private void buildMobileUi() {
        mobilePage = new LinearLayout(this);
        mobilePage.setOrientation(LinearLayout.VERTICAL);
        mobilePage.setBackgroundColor(0xFF08090B);
        mobileStage = new FrameLayout(this);
        mobileStage.setBackgroundColor(Color.BLACK);
        playerView = new PlayerView(this);
        playerView.setUseController(false);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        mobileStage.addView(playerView, new FrameLayout.LayoutParams(-1, -1));
        mobileControls = new MobilePlaybackControls(this, live, new MobilePlaybackControls.Actions() {
            @Override public void back() { onBackPressed(); }
            @Override public void fullscreen() { toggleMobileFullscreen(); }
            @Override public void togglePlayback() { PlaybackActivity.this.togglePlayback(); }
            @Override public void next() { changeItem(1, false); }
            @Override public void select(int index) { selectItem(index, false); }
            @Override public void switchSource() { returnForAnotherSource(); }
            @Override public void seekCompleted() { savePlayback(); }
            @Override public void resize(boolean fill) {
                playerView.setResizeMode(fill ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
            }
            @Override public void lockChanged(boolean locked) {
                if (locked) {
                    unlockedOrientation = getRequestedOrientation();
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
                } else setRequestedOrientation(unlockedOrientation);
            }
        });
        mobileStage.addView(mobileControls, new FrameLayout.LayoutParams(-1, -1));
        loadingPanel = new LinearLayout(this);
        loadingPanel.setOrientation(LinearLayout.VERTICAL);
        loadingPanel.setGravity(Gravity.CENTER);
        loadingPanel.setPadding(dp(18), dp(12), dp(18), dp(12));
        loadingPanel.setBackground(surface(0xE6111114, 18));
        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(TEXT_PRIMARY));
        loadingPanel.addView(spinner, new LinearLayout.LayoutParams(dp(26), dp(26)));
        loadingText = text("正在连接视频源…", 12, TEXT_PRIMARY);
        LinearLayout.LayoutParams loadingParams = new LinearLayout.LayoutParams(-2, -2);
        loadingParams.topMargin = dp(10);
        loadingPanel.addView(loadingText, loadingParams);
        // A buffering label must not swallow touches, including unlock and back.
        loadingPanel.setClickable(false);
        mobileStage.addView(loadingPanel, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        mobileControls.bringToFront();
        mobilePage.addView(mobileStage, new LinearLayout.LayoutParams(-1, dp(220)));
        mobileDetails = new ScrollView(this);
        mobileDetails.setFillViewport(true);
        LinearLayout details = new LinearLayout(this);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setPadding(dp(24), dp(30), dp(24), dp(40));
        mobileTitle = text("", 30, TEXT_PRIMARY);
        mobileTitle.setLetterSpacing(-.035f);
        mobileTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        details.addView(mobileTitle);
        mobileSubtitle = text("", 12, TEXT_SECONDARY);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(-1, -2);
        subParams.topMargin = dp(10);
        details.addView(mobileSubtitle, subParams);
        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(0, dp(20), 0, dp(24));
        TextView episodeAction = mobileAction(live ? "频道列表" : "选集", this::showItemList);
        episodeAction.setTextColor(TEXT_FOCUSED);
        episodeAction.setBackground(MobileUi.touchBackground(this, Color.WHITE, 12, false));
        actions.addView(episodeAction, new LinearLayout.LayoutParams(0, dp(48), 1));
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        actionParams.leftMargin = dp(10);
        actions.addView(mobileAction("切换来源", this::returnForAnotherSource), actionParams);
        details.addView(actions);
        TextView episodeHeading = text(live ? "全部频道" : "剧集", 17, TEXT_PRIMARY);
        details.addView(episodeHeading);
        mobileEpisodes = new LinearLayout(this);
        mobileEpisodes.setOrientation(LinearLayout.VERTICAL);
        mobileEpisodes.setPadding(0, dp(14), 0, dp(24));
        details.addView(mobileEpisodes);
        TextView help = text("左右滑动调整进度 · 左侧上下调亮度 · 右侧上下调音量\n双击播放 / 暂停 · 长按临时倍速", 11, TEXT_SECONDARY);
        help.setLineSpacing(dp(6), 1f);
        details.addView(help);
        mobileDetails.addView(details);
        mobilePage.addView(mobileDetails, new LinearLayout.LayoutParams(-1, 0, 1));
        mobilePage.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                safeLeft = safe.left; safeTop = safe.top; safeRight = safe.right; safeBottom = safe.bottom;
            } else {
                safeLeft = insets.getSystemWindowInsetLeft(); safeTop = insets.getSystemWindowInsetTop();
                safeRight = insets.getSystemWindowInsetRight(); safeBottom = insets.getSystemWindowInsetBottom();
            }
            applyMobileInsets();
            return insets;
        });
        setContentView(mobilePage);
        updateMobileLayout();
        mobilePage.requestApplyInsets();
    }

    private TextView mobileAction(String label, Runnable action) {
        TextView button = text(label, 13, TEXT_PRIMARY);
        button.setGravity(Gravity.CENTER);
        button.setBackground(MobileUi.touchBackground(this, 0xFF232327, 12, false));
        button.setFocusable(true);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private void updateMobileLayout() {
        if (mobilePage == null) return;
        mobileFullscreen = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        int width = getResources().getDisplayMetrics().widthPixels - (mobileFullscreen ? 0 : safeLeft + safeRight);
        mobileStage.setLayoutParams(new LinearLayout.LayoutParams(-1, mobileFullscreen ? 0 : Math.round(width * 9f / 16), mobileFullscreen ? 1f : 0f));
        mobileDetails.setVisibility(mobileFullscreen ? View.GONE : View.VISIBLE);
        mobileControls.setLandscape(mobileFullscreen);
        applyMobileInsets();
        enterImmersiveMode();
    }

    private void applyMobileInsets() {
        if (mobilePage == null) return;
        mobilePage.setPadding(mobileFullscreen ? 0 : safeLeft, mobileFullscreen ? 0 : safeTop,
                mobileFullscreen ? 0 : safeRight, mobileFullscreen ? 0 : safeBottom);
        mobileControls.setSafeInsets(mobileFullscreen ? safeLeft : 0, mobileFullscreen ? safeTop : 0,
                mobileFullscreen ? safeRight : 0, mobileFullscreen ? safeBottom : 0);
    }

    private void toggleMobileFullscreen() {
        mobileControls.cancelInteraction();
        setRequestedOrientation(mobileFullscreen ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (!BuildConfig.IS_TV) { updateMobileLayout(); updateItemUi(); mobilePage.requestApplyInsets(); }
    }

    private void buildUi() {
        if (!BuildConfig.IS_TV) { buildMobileUi(); return; }
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        playerView = new PlayerView(this);
        playerView.setId(View.generateViewId());
        playerView.setUseController(false);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        playerView.setKeepContentOnPlayerReset(false);
        playerView.setFocusable(false);
        root.addView(playerView, new FrameLayout.LayoutParams(-1, -1));
        tvControls = new TvPlaybackControls(this, live, new TvPlaybackControls.Actions() {
            @Override public void back() { finish(); }
            @Override public void togglePlayback() { PlaybackActivity.this.togglePlayback(); }
            @Override public void changeItem(int offset, boolean fullscreen) { PlaybackActivity.this.changeItem(offset, fullscreen); }
            @Override public void select(int index) { selectItem(index, false); }
            @Override public void seek(long delta) { seekBy(delta); }
            @Override public void switchSource() { returnForAnotherSource(); }
            @Override public void resize(boolean fill) {
                playerView.setResizeMode(fill ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
            }
        });
        topPanel = tvControls.top; titleView = tvControls.title;
        playButton = tvControls.playButton; nextButton = tvControls.nextButton;
        previousButton = tvControls.previousButton; listButton = tvControls.listButton;
        loadingPanel = new LinearLayout(this);
        loadingPanel.setOrientation(LinearLayout.VERTICAL); loadingPanel.setGravity(Gravity.CENTER);
        loadingPanel.setPadding(dp(26), dp(20), dp(26), dp(20));
        loadingPanel.setBackground(surface(0xE6111114, 18)); loadingPanel.setClickable(false);
        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(TEXT_PRIMARY));
        loadingPanel.addView(spinner, new LinearLayout.LayoutParams(dp(30), dp(30)));
        loadingText = text("正在连接视频源…", 15, TEXT_PRIMARY);
        LinearLayout.LayoutParams loadingParams = new LinearLayout.LayoutParams(-2, -2);
        loadingParams.topMargin = dp(14); loadingPanel.addView(loadingText, loadingParams);
        root.addView(loadingPanel, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        root.addView(tvControls, new FrameLayout.LayoutParams(-1, -1));
        actionMessage = text("", 16, TEXT_PRIMARY);
        actionMessage.setGravity(Gravity.CENTER); actionMessage.setPadding(dp(24), dp(14), dp(24), dp(14));
        actionMessage.setBackground(surface(0xEB111114, 18)); actionMessage.setVisibility(View.GONE);
        root.addView(actionMessage, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        tvControls.showChrome(); playButton.requestFocus();
    }

    private void styleButton(Button button) {
        button.setTextSize(BuildConfig.IS_TV ? 15 : 13);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setAllCaps(false);
        button.setIncludeFontPadding(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setMinWidth(dp(94));
        button.setMinimumWidth(dp(94));
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(18), 0, dp(18), 0);
        button.setTextColor(actionTextColors());
        button.setBackground(actionBackground(12));
        button.setBackgroundTintList(null);
        button.setFocusable(true);
        applyFocusMotion(button, false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!validArguments || isFinishing()) return;
        resumed = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        if (failureMessage == null) {
            createPlayer();
            beginPlayback(resumePositionMs, playAfterResume);
        } else {
            showErrorDialog();
        }
        handler.removeCallbacks(saveProgress);
        handler.postDelayed(saveProgress, SAVE_INTERVAL_MS);
    }

    private void createPlayer() {
        if (player != null) return;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
                .setEnableDecoderFallback(true);
        // MediaCodec uses the TV's hardware codecs first, with platform fallback.
        // No FFmpeg/native codec download, proxy, or external playback backend.
        renderers.setMediaCodecSelector((mimeType, secure, tunneling) -> {
            List<MediaCodecInfo> codecs = new ArrayList<>(
                    MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, secure, tunneling));
            Collections.sort(codecs, (first, second) ->
                    Boolean.compare(second.hardwareAccelerated, first.hardwareAccelerated));
            return codecs;
        });
        player = new ExoPlayer.Builder(this, renderers)
                .setSeekBackIncrementMs(SEEK_MS)
                .setSeekForwardIncrementMs(SEEK_MS)
                .build();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.setRepeatMode(Player.REPEAT_MODE_OFF);
        player.addListener(this);
        // Disable seek commands in the native controller even for DVR-capable
        // live HLS. Our channel controls still operate the underlying player.
        playerView.setPlayer(live ? new ForwardingPlayer(player) {
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon().removeAll(
                        COMMAND_SEEK_TO_DEFAULT_POSITION, COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                        COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, COMMAND_SEEK_TO_PREVIOUS,
                        COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, COMMAND_SEEK_TO_NEXT,
                        COMMAND_SEEK_TO_MEDIA_ITEM, COMMAND_SEEK_BACK, COMMAND_SEEK_FORWARD).build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return getAvailableCommands().contains(command);
            }

            @Override
            public boolean isCurrentMediaItemSeekable() {
                return false;
            }
        } : player);
        if (mobileControls != null) mobileControls.bind(player);
        if (tvControls != null) tvControls.bind(player);
    }

    private void beginPlayback(long positionMs, boolean autoplay) {
        String lowerUrl = urls.get(currentIndex).toLowerCase(Locale.ROOT);
        String path = clean(Uri.parse(urls.get(currentIndex)).getPath()).toLowerCase(Locale.ROOT);
        boolean hlsUrl = lowerUrl.contains(".m3u8") || lowerUrl.contains("format=hls")
                || lowerUrl.contains("type=hls");
        boolean mp4Url = path.endsWith(".mp4") || path.endsWith(".m4v");
        useFlv = path.endsWith(".flv") || TvRepository.isBundledFlv(this, urls.get(currentIndex));
        explicitFormat = hlsUrl || mp4Url || useFlv;
        useHls = hlsUrl || (live && !mp4Url && !useFlv);
        triedOtherFormat = false;
        prepareSource(positionMs, autoplay);
    }

    private void prepareSource(long positionMs, boolean autoplay) {
        if (!resumed || isFinishing()) return;
        createPlayer();
        failureMessage = null;
        endActionPosted = false;
        dismissErrorDialog();
        resumePositionMs = live ? 0L : Math.max(0L, positionMs);
        sourceReady = false;
        playAfterResume = autoplay;
        String url = urls.get(currentIndex);
        Map<String, String> headers = new HashMap<>();
        // Some origins require a Referer even for their directly accessible media.
        // Use this item URL; do not install a permissive TLS verifier/trust manager.
        headers.put("Referer", url);
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000)
                .setDefaultRequestProperties(headers);
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(this, http);
        MediaItem.Builder item = new MediaItem.Builder().setUri(url).setMediaId(url)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(displayTitle()).build());
        if (useHls) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if (useFlv) item.setMimeType(MimeTypes.VIDEO_FLV);
        MediaSource source;
        try {
            source = new DefaultMediaSourceFactory(dataSource).createMediaSource(item.build());
        } catch (RuntimeException unsupportedSource) {
            fail("无法打开这个视频地址，请选择可直接播放的 HLS / MP4 来源。");
            return;
        }
        loadingText.setText("正在连接视频源…");
        loadingPanel.setVisibility(View.VISIBLE);
        if (live) {
            // Let a live HLS source choose its default live position. Never seek live.
            player.setMediaSource(source);
        } else {
            player.setMediaSource(source, resumePositionMs);
        }
        player.setPlayWhenReady(autoplay);
        player.prepare();
        persistSelection();
        updateItemUi();
    }

    @Override
    public void onPlaybackStateChanged(int state) {
        if (player == null || !resumed) return;
        if (state == Player.STATE_READY) sourceReady = true;
        if (failureMessage == null) {
            loadingPanel.setVisibility(state == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE);
            if (state == Player.STATE_BUFFERING) loadingText.setText("正在缓冲…");
        }
        updatePlayButton();
        if (state == Player.STATE_ENDED && !endActionPosted) {
            endActionPosted = true;
            if (live) {
                fail("直播信号已结束或连接已中断，请重试或切换频道。");
                return;
            }
            resumePositionMs = 0L;
            preferences.edit().putLong(progressKey(), 0L).apply();
            final int endedIndex = currentIndex;
            handler.post(() -> {
                if (!resumed || player == null || currentIndex != endedIndex
                        || player.getPlaybackState() != Player.STATE_ENDED) return;
                if (currentIndex + 1 < urls.size()) {
                    selectItem(currentIndex + 1, false);
                    showMessage("开始播放：" + names.get(currentIndex));
                } else {
                    playAfterResume = false;
                    player.pause();
                    showMessage("已播放完毕");
                    if (mobileControls != null) mobileControls.showChrome(); else if (tvControls != null) tvControls.showChrome();
                }
            });
        }
    }

    @Override
    public void onIsPlayingChanged(boolean isPlaying) {
        updatePlayButton();
    }

    @Override
    public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
        if (resumed && failureMessage == null) playAfterResume = playWhenReady;
        updatePlayButton();
    }

    @Override
    public void onPlayerError(PlaybackException error) {
        if (!resumed || isFinishing()) return;
        savePlayback();
        // Extensionless endpoints can return either HLS or MP4. Try the other
        // extractor only for a format error, never for an HTTP/TLS/auth failure.
        if (!explicitFormat && !triedOtherFormat && isParsingError(error.errorCode)) {
            triedOtherFormat = true;
            useHls = !useHls;
            prepareSource(resumePositionMs, playAfterResume);
            return;
        }
        fail(chineseError(error));
    }

    private void fail(String message) {
        if (mobileControls != null) mobileControls.cancelInteraction();
        if (tvControls != null) tvControls.dismissSheet();
        failureMessage = message;
        loadingPanel.setVisibility(View.GONE);
        if (itemDialog != null) {
            itemDialog.dismiss();
            itemDialog = null;
        }
        if (player != null) player.pause();
        showErrorDialog();
    }

    private void showErrorDialog() {
        if (!resumed || isFinishing() || failureMessage == null
                || (errorDialog != null && errorDialog.isShowing())) return;
        AlertDialog.Builder builder = new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setCustomTitle(dialogHeader("播放遇到问题", "暂时无法播放", names.get(currentIndex)))
                .setMessage(failureMessage)
                .setPositiveButton("重试", (dialog, which) -> {
                    failureMessage = null;
                    beginPlayback(resumePositionMs, true);
                })
                .setNegativeButton("返回换源", (dialog, which) -> returnForAnotherSource())
                .setOnCancelListener(dialog -> finish());
        if (currentIndex + 1 < urls.size()) {
            builder.setNeutralButton(live ? "下一频道" : "下一集",
                    (dialog, which) -> selectItem(currentIndex + 1, false));
        }
        errorDialog = builder.create();
        errorDialog.setOnShowListener(dialog -> {
            styleDialog(errorDialog);
            errorDialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus();
        });
        errorDialog.show();
    }

    private void dismissErrorDialog() {
        if (errorDialog != null) {
            errorDialog.dismiss();
            errorDialog = null;
        }
    }

    private void showItemList() {
        if (!resumed || urls.isEmpty()) return;
        if (mobileControls != null) { mobileControls.showEpisodes(); return; }
        if (tvControls != null) { tvControls.showEpisodes(); return; }
        if (itemDialog != null && itemDialog.isShowing()) return;
        String[] rows = new String[names.size()];
        for (int i = 0; i < rows.length; i++) {
            rows[i] = names.get(i) + (i == currentIndex ? "  ·  正在播放" : "");
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_single_choice, rows) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                CheckedTextView row = (CheckedTextView) super.getView(position, convertView, parent);
                row.setCheckMarkDrawable(null);
                row.setTextSize(17);
                row.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                row.setIncludeFontPadding(false);
                row.setSingleLine(true);
                row.setEllipsize(TextUtils.TruncateAt.END);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setMinHeight(dp(56));
                row.setPadding(dp(20), dp(12), dp(20), dp(12));
                row.setTextColor(listTextColors());
                row.setBackground(listRowBackground());
                applyFocusMotion(row, true);
                return row;
            }
        };
        itemDialog = new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setCustomTitle(dialogHeader(live ? "直播" : "点播", live ? "选择频道" : "选择剧集",
                        "正在播放 " + (currentIndex + 1) + " / " + urls.size()))
                .setSingleChoiceItems(adapter, currentIndex, (dialog, which) -> {
                    dialog.dismiss();
                    selectItem(which, false);
                })
                .setNegativeButton("关闭", null)
                .create();
        itemDialog.setOnShowListener(dialog -> {
            styleDialog(itemDialog);
            ListView list = itemDialog.getListView();
            list.setDivider(null);
            list.setDividerHeight(0);
            list.setPadding(dp(16), dp(8), dp(16), dp(12));
            list.setClipChildren(false);
            list.setClipToPadding(false);
            list.setVerticalScrollBarEnabled(false);
            list.setSelector(rounded(Color.TRANSPARENT, dp(12)));
            list.setSelection(currentIndex);
            list.requestFocus();
        });
        itemDialog.show();
    }

    private void changeItem(int offset, boolean keepFullscreen) {
        int next = currentIndex + offset;
        if (next < 0 || next >= urls.size()) {
            showMessage(offset < 0 ? (live ? "已经是第一个频道" : "已经是第一集")
                    : (live ? "已经是最后一个频道" : "已经是最后一集"));
            return;
        }
        selectItem(next, keepFullscreen);
        showMessage("正在播放：" + names.get(currentIndex));
    }

    private void selectItem(int index, boolean keepFullscreen) {
        if (index < 0 || index >= urls.size()) return;
        if (index == currentIndex && failureMessage == null) return;
        if (mobileControls != null) mobileControls.cancelInteraction();
        savePlayback();
        currentIndex = index;
        resumePositionMs = live ? 0L : Math.max(0L, preferences.getLong(progressKey(), 0L));
        failureMessage = null;
        persistSelection();
        beginPlayback(resumePositionMs, true);
        if (mobileControls != null) mobileControls.showChrome();
        else if (tvControls != null) { if (keepFullscreen) tvControls.hideChrome(); else tvControls.showChrome(); }
        else if (keepFullscreen) playerView.hideController();
        else playerView.showController();
    }

    private void togglePlayback() {
        if (failureMessage != null) {
            showErrorDialog();
            return;
        }
        if (player == null) return;
        if (player.getPlaybackState() == Player.STATE_ENDED) {
            beginPlayback(0L, true);
        } else if (player.getPlayWhenReady()) {
            player.pause();
        } else {
            player.play();
        }
        updatePlayButton();
    }

    private void seekBy(long offsetMs) {
        if (live || player == null || failureMessage != null) return;
        if (!player.isCurrentMediaItemSeekable()) {
            showMessage("当前视频源暂不支持快进 / 快退");
            return;
        }
        long target = Math.max(0L, player.getCurrentPosition() + offsetMs);
        long duration = player.getDuration();
        if (duration != C.TIME_UNSET && duration > 0) target = Math.min(target, duration);
        player.seekTo(target);
        resumePositionMs = target;
        showMessage((offsetMs > 0 ? "快进 " : "快退 ") + (Math.abs(offsetMs) / 1_000L)
                + " 秒 · " + formatTime(target));
        savePlayback();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (!validArguments) return super.dispatchKeyEvent(event);
        if (!BuildConfig.IS_TV) {
            if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                if (event.getAction() == KeyEvent.ACTION_UP) onBackPressed();
                return true;
            }
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                switch (event.getKeyCode()) {
                    case KeyEvent.KEYCODE_MENU: showItemList(); return true;
                    case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: togglePlayback(); return true;
                    case KeyEvent.KEYCODE_MEDIA_NEXT: changeItem(1, false); return true;
                    case KeyEvent.KEYCODE_MEDIA_PREVIOUS: changeItem(-1, false); return true;
                    default: break;
                }
            }
            return super.dispatchKeyEvent(event);
        }
        if (tvControls != null && tvControls.handleKeyEvent(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (mobileControls != null) {
            if (mobileControls.handleBack()) return;
            if (mobileFullscreen) { toggleMobileFullscreen(); return; }
        }
        if (tvControls != null && tvControls.handleBack()) return;
        finish();
    }

    private void returnForAnotherSource() {
        savePlayback();
        setResult(RESULT_OK, new Intent().putExtra("retry_search", searchTitle).putExtra("retry_live", live)
                .putExtra("retry_item", contentItem).putExtra("retry_episode", names.get(currentIndex))
                .putExtra("retry_count", names.size()).putExtra("retry_position", live ? 0L : resumePositionMs));
        finish();
    }

    private void updateItemUi() {
        if (mobileControls != null) {
            mobileControls.setItem(displayTitle(), names, currentIndex);
            mobileTitle.setText(title.isEmpty() ? names.get(currentIndex) : title);
            mobileSubtitle.setText((live ? "电视直播" : "正在播放") + " · " + names.get(currentIndex)
                    + " · 共 " + urls.size() + (live ? " 个频道" : " 集"));
            mobileEpisodes.removeAllViews();
            int columns = Math.max(3, getResources().getConfiguration().screenWidthDp / 110);
            int visible = Math.min(names.size(), live ? 8 : columns * 4);
            int start = Math.max(0, currentIndex - visible / 2);
            start = Math.min(start, Math.max(0, names.size() - visible));
            for (int offset = 0; offset < visible; offset += columns) {
                LinearLayout row = new LinearLayout(this);
                for (int col = 0; col < columns; col++) {
                    int relative = offset + col;
                    if (relative >= visible) { row.addView(new View(this), new LinearLayout.LayoutParams(0, dp(52), 1)); continue; }
                    final int target = start + relative;
                    TextView item = mobileAction(names.get(target), () -> selectItem(target, false));
                    item.setSingleLine(); item.setEllipsize(TextUtils.TruncateAt.END);
                    item.setTextColor(target == currentIndex ? TEXT_FOCUSED : TEXT_PRIMARY);
                    item.setBackground(MobileUi.touchBackground(this, target == currentIndex ? Color.WHITE : TvUi.SURFACE, 12, false));
                    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
                    params.setMargins(dp(3), dp(3), dp(3), dp(3)); row.addView(item, params);
                }
                mobileEpisodes.addView(row);
            }
            if (visible < names.size()) {
                TextView all = mobileAction(live ? "查看全部频道  ›" : "查看全部选集  ›", this::showItemList);
                mobileEpisodes.addView(all, new LinearLayout.LayoutParams(-1, dp(48)));
            }
            return;
        }
        if (tvControls != null) { tvControls.setItem(displayTitle(), names, currentIndex); return; }
        titleView.setText(displayTitle());
        previousButton.setEnabled(currentIndex > 0);
        nextButton.setEnabled(currentIndex + 1 < urls.size());
        listButton.setText((live ? "频道 " : "选集 ") + (currentIndex + 1) + "/" + urls.size());
        updatePlayButton();
    }

    private String displayTitle() {
        String name = names.get(currentIndex);
        return title.isEmpty() || title.equals(name) ? name : title + " · " + name;
    }

    private void updatePlayButton() {
        if (tvControls != null) return;
        if (playButton == null) return;
        if (player != null && player.getPlaybackState() == Player.STATE_ENDED && !live) {
            playButton.setText("重新播放");
        } else {
            playButton.setText(player != null && player.getPlayWhenReady() ? "暂停" : "播放");
        }
    }

    private void showMessage(String message) {
        if (mobileControls != null && resumed) { mobileControls.showToast(message); return; }
        if (actionMessage == null || !resumed) return;
        actionMessage.setText(message);
        actionMessage.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideMessage);
        handler.postDelayed(hideMessage, 1_800L);
    }

    private void persistSelection() {
        if (!validArguments) return;
        preferences.edit().putInt("selected_index_" + selectionKey, currentIndex)
                .putString("selected_url_" + selectionKey, urls.get(currentIndex))
                .putString("selected_name_" + selectionKey, names.get(currentIndex)).apply();
    }

    private void savePlayback() {
        if (!validArguments) return;
        persistSelection();
        if (live) return;
        long position = resumePositionMs;
        if (player != null) {
            long duration = player.getDuration();
            if (sourceReady && duration != C.TIME_UNSET && duration > 0) {
                preferences.edit().putLong("duration_" + digest(urls.get(currentIndex)), duration).apply();
            }
            position = PlaybackState.savedPosition(resumePositionMs, player.getCurrentPosition(), duration,
                    sourceReady, player.getPlaybackState() == Player.STATE_ENDED);
        }
        resumePositionMs = Math.max(0L, position);
        preferences.edit().putLong(progressKey(), resumePositionMs).apply();
    }

    private String progressKey() {
        return "position_" + digest(urls.get(currentIndex));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (validArguments) {
            savePlayback();
            outState.putString(STATE_URL, urls.get(currentIndex));
            outState.putLong(STATE_POSITION, live ? 0L : resumePositionMs);
            outState.putBoolean(STATE_PLAY, playAfterResume);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (mobileControls != null) mobileControls.suspend();
        if (tvControls != null) tvControls.suspend();
        resumed = false;
        handler.removeCallbacksAndMessages(null);
        if (player != null && failureMessage == null) playAfterResume = player.getPlayWhenReady();
        savePlayback();
        if (itemDialog != null) {
            itemDialog.dismiss();
            itemDialog = null;
        }
        dismissErrorDialog();
        releasePlayer();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onPause();
    }

    private void releasePlayer() {
        if (mobileControls != null) mobileControls.bind(null);
        if (tvControls != null) tvControls.bind(null);
        if (player != null) {
            player.removeListener(this);
            playerView.setPlayer(null);
            player.release();
            player = null;
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
        else if (mobileControls != null) mobileControls.cancelInteraction();
    }

    @SuppressWarnings("deprecation")
    private void enterImmersiveMode() {
        if (!BuildConfig.IS_TV && !mobileFullscreen) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().setStatusBarColor(Color.BLACK);
            getWindow().setNavigationBarColor(0xFF08090B);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            return;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private static boolean isParsingError(int code) {
        return code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED;
    }

    private static String chineseError(PlaybackException error) {
        Throwable cause = error;
        for (int depth = 0; cause != null && depth < 12; depth++, cause = cause.getCause()) {
            if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                int status = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                if (status == 401 || status == 403) {
                    return "视频源拒绝访问（HTTP " + status + "），地址可能过期或受防盗链限制，请返回换源。";
                }
                if (status == 404 || status == 410) return "视频地址已失效（HTTP " + status + "），请返回换源。";
                return "视频源服务器响应异常（HTTP " + status + "），请重试或换源。";
            }
            if (cause instanceof SSLException) {
                return "无法建立安全连接：源站证书或 TLS 配置异常。请更换视频源。";
            }
            if (cause instanceof SocketTimeoutException) return "连接视频源超时，请检查设备网络后重试，或更换来源。";
            if (cause instanceof UnknownHostException) return "无法解析视频源域名，请检查设备网络或更换来源。";
            if (cause instanceof ConnectException) return "无法连接视频源服务器，请稍后重试或更换来源。";
        }
        if (error.errorCode == PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED) {
            return "应用当前配置不允许此 HTTP 视频地址，请使用 HTTPS 源或检查应用网络配置。";
        }
        if (error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
                || error.errorCode == PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED
                || error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED
                || error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED) {
            return "这台设备无法解码当前视频格式，请更换视频源或选择其他清晰度。";
        }
        if (isParsingError(error.errorCode)) return "无法识别视频内容，地址可能不是有效的 HLS / MP4，请更换来源。";
        return "当前视频源播放失败，请重试或返回换源。（错误码：" + error.errorCode + "）";
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean isHttpUrl(String value) {
        if (value.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(value);
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && !uri.getHost().isEmpty();
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) {
                int unsigned = item & 0xFF;
                if (unsigned < 16) result.append('0');
                result.append(Integer.toHexString(unsigned));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String formatTime(long positionMs) {
        long seconds = Math.max(0L, positionMs / 1_000L);
        return seconds >= 3_600L
                ? String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3_600L, seconds / 60L % 60L, seconds % 60L)
                : String.format(Locale.ROOT, "%02d:%02d", seconds / 60L, seconds % 60L);
    }

    private LinearLayout dialogHeader(String eyebrow, String heading, String detail) {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(28), dp(26), dp(28), dp(14));
        TextView category = text(eyebrow, 12, ACCENT);
        category.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        category.setLetterSpacing(0.06f);
        header.addView(category);
        TextView headingView = text(heading, 24, TEXT_PRIMARY);
        headingView.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingParams.topMargin = dp(8);
        header.addView(headingView, headingParams);
        TextView detailView = text(detail, 14, TEXT_SECONDARY);
        detailView.setMaxLines(2);
        detailView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        detailParams.topMargin = dp(8);
        header.addView(detailView, detailParams);
        return header;
    }

    private void styleDialog(AlertDialog dialog) {
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(surface(0xFC111114, 24));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setDimAmount(0.72f);
            window.getDecorView().setPadding(0, 0, 0, 0);
            int height = ViewGroup.LayoutParams.WRAP_CONTENT;
            if (dialog.getListView() != null) {
                int available = getResources().getDisplayMetrics().heightPixels - dp(72);
                int desired = dp(216 + Math.min(5, names.size()) * 56);
                height = Math.min(available, desired);
            }
            window.setLayout(Math.min(dp(680),
                    getResources().getDisplayMetrics().widthPixels - dp(BuildConfig.IS_TV ? 80 : 24)), height);
        }
        TextView message = dialog.findViewById(android.R.id.message);
        if (message != null) {
            message.setTextColor(TEXT_PRIMARY);
            message.setTextSize(16);
            message.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            message.setLineSpacing(dp(5), 1f);
        }
        for (int which : new int[]{AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE,
                AlertDialog.BUTTON_NEUTRAL}) {
            Button action = dialog.getButton(which);
            if (action == null) continue;
            styleButton(action);
            ViewGroup.LayoutParams params = action.getLayoutParams();
            params.height = dp(44);
            if (params instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) params;
                margins.leftMargin = dp(6);
                margins.rightMargin = dp(6);
                margins.topMargin = dp(6);
                margins.bottomMargin = dp(6);
            }
            action.setLayoutParams(params);
            if (action.getParent() instanceof ViewGroup) {
                ViewGroup parent = (ViewGroup) action.getParent();
                parent.setClipChildren(false);
                parent.setClipToPadding(false);
            }
        }
    }

    private ColorStateList actionTextColors() {
        return new ColorStateList(new int[][]{
                new int[]{-android.R.attr.state_enabled},
                new int[]{android.R.attr.state_focused},
                new int[]{android.R.attr.state_pressed}, new int[]{}},
                new int[]{0xFF73737B, TEXT_FOCUSED, TEXT_FOCUSED, TEXT_PRIMARY});
    }

    private StateListDrawable actionBackground(int radius) {
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[]{-android.R.attr.state_enabled}, rounded(0x242F2F33, dp(radius)));
        background.addState(new int[]{android.R.attr.state_focused}, rounded(Color.WHITE, dp(radius)));
        background.addState(new int[]{android.R.attr.state_pressed}, rounded(TEXT_PRIMARY, dp(radius)));
        background.addState(new int[]{}, rounded(0x4047474C, dp(radius)));
        return background;
    }

    private ColorStateList listTextColors() {
        return new ColorStateList(new int[][]{
                new int[]{android.R.attr.state_selected},
                new int[]{android.R.attr.state_pressed},
                new int[]{android.R.attr.state_checked}, new int[]{}},
                new int[]{TEXT_FOCUSED, TEXT_FOCUSED, ACCENT, TEXT_PRIMARY});
    }

    private StateListDrawable listRowBackground() {
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[]{android.R.attr.state_selected}, rounded(Color.WHITE, dp(12)));
        background.addState(new int[]{android.R.attr.state_pressed}, rounded(TEXT_PRIMARY, dp(12)));
        background.addState(new int[]{android.R.attr.state_checked}, rounded(0x1AFFFFFF, dp(12)));
        background.addState(new int[]{}, rounded(Color.TRANSPARENT, dp(12)));
        return background;
    }

    private void applyFocusMotion(View view, boolean includeSelection) {
        StateListAnimator animator = new StateListAnimator();
        animator.addState(new int[]{android.R.attr.state_enabled, android.R.attr.state_focused},
                focusMotion(view, 1.04f, dp(10)));
        if (includeSelection) {
            animator.addState(new int[]{android.R.attr.state_enabled, android.R.attr.state_selected},
                    focusMotion(view, 1.04f, dp(10)));
        }
        animator.addState(new int[]{android.R.attr.state_enabled, android.R.attr.state_pressed},
                focusMotion(view, 1.02f, dp(5)));
        animator.addState(new int[]{}, focusMotion(view, 1f, 0f));
        view.setStateListAnimator(animator);
    }

    private AnimatorSet focusMotion(View view, float scale, float elevation) {
        AnimatorSet motion = new AnimatorSet();
        motion.playTogether(ObjectAnimator.ofFloat(view, View.SCALE_X, scale),
                ObjectAnimator.ofFloat(view, View.SCALE_Y, scale),
                ObjectAnimator.ofFloat(view, View.TRANSLATION_Z, elevation));
        motion.setDuration(160L);
        motion.setInterpolator(new DecelerateInterpolator());
        return motion;
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        view.setFontFeatureSettings("kern");
        view.setIncludeFontPadding(false);
        return view;
    }

    private GradientDrawable surface(int color, int radius) {
        GradientDrawable drawable = rounded(color, dp(radius));
        drawable.setStroke(dp(1), 0x16FFFFFF);
        return drawable;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
