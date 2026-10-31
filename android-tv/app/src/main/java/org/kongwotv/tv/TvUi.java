package org.kongwotv.tv;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Shared tvOS-inspired surfaces and D-pad focus treatment. */
final class TvUi {
    static final int BACKGROUND = Color.rgb(8, 9, 11);
    static final int SURFACE = Color.rgb(17, 17, 20);
    static final int RAISED = Color.rgb(35, 35, 39);
    static final int MUTED = Color.rgb(163, 163, 171);
    static final int TEXT = Color.rgb(245, 245, 247);
    static final int ACCENT = Color.WHITE;
    static final int LIVE_GREEN = Color.rgb(211, 211, 217);
    private static final DecelerateInterpolator EASE = new DecelerateInterpolator(1.5f);

    private TvUi() {}

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable shape(Context context, int color, int strokeColor, int stroke) {
        return rounded(context, color, 12, strokeColor, stroke);
    }

    static GradientDrawable rounded(Context context, int color, float radius, int strokeColor, float stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(context, radius));
        if (stroke > 0) drawable.setStroke(Math.max(1, dp(context, stroke)), strokeColor);
        return drawable;
    }

    static StateListDrawable focusBackground(Context context, int base) {
        StateListDrawable result = new StateListDrawable();
        result.addState(new int[]{android.R.attr.state_focused}, rounded(context, Color.WHITE, 12, Color.WHITE, 1));
        result.addState(new int[]{android.R.attr.state_pressed}, rounded(context, 0xFFE6E6EB, 12, 0, 0));
        result.addState(new int[]{android.R.attr.state_selected}, rounded(context, 0xFF2B2B30, 12, 0x26FFFFFF, 1));
        result.addState(new int[]{}, rounded(context, base, 12, 0, 0));
        return result;
    }

    static StateListDrawable cardBackground(Context context, int base, float radius) {
        StateListDrawable result = new StateListDrawable();
        result.addState(new int[]{android.R.attr.state_focused}, rounded(context, base, radius, 0xFFF4F4F8, 2));
        result.addState(new int[]{android.R.attr.state_pressed}, rounded(context, RAISED, radius, 0xB3FFFFFF, 1));
        result.addState(new int[]{}, rounded(context, base, radius, 0, 0));
        return result;
    }

    static void focusable(View view, float scale) {
        if (!BuildConfig.IS_TV) {
            MobileUi.touch(view);
            return;
        }
        view.setFocusable(true);
        view.setClickable(true);
        if (view.getId() == View.NO_ID) view.setId(View.generateViewId());
        view.setStateListAnimator(null);
        view.setOnFocusChangeListener((target, focused) -> animateFocus(target, focused, scale));
    }

    static void animateFocus(View view, boolean focused, float scale) {
        view.animate().cancel();
        view.animate().scaleX(focused ? scale : 1f).scaleY(focused ? scale : 1f)
                .translationZ(dp(view.getContext(), focused ? 10 : 0))
                .setDuration(focused ? 190 : 150).setInterpolator(EASE).start();
        view.setElevation(dp(view.getContext(), focused ? 10 : 0));
        if (focused) view.post(() -> {
            if (!view.isFocused() || view.getWidth() == 0 || view.getHeight() == 0) return;
            Rect bounds = new Rect(0, 0, view.getWidth(), view.getHeight());
            int margin = dp(view.getContext(), 12);
            bounds.inset(-margin, -margin);
            view.requestRectangleOnScreen(bounds, false);
        });
    }

    static void unclipped(ViewGroup group) {
        group.setClipChildren(false);
        group.setClipToPadding(false);
    }

    static TextView text(Context context, String value, float size, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setFontFeatureSettings("kern");
        view.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        view.setIncludeFontPadding(false);
        return view;
    }

    static TextView heading(Context context, String value, float size) {
        TextView view = text(context, value, size, TEXT);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return view;
    }

    static Button button(Context context, String value, View.OnClickListener action) {
        if (!BuildConfig.IS_TV) return MobileUi.button(context, value, null, false, false, action);
        Button button = new Button(context);
        button.setText(value);
        button.setTextSize(14);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setTextColor(new ColorStateList(new int[][]{
                {android.R.attr.state_focused}, {android.R.attr.state_pressed}, {}
        }, new int[]{0xFF15161B, 0xFF15161B, TEXT}));
        button.setAllCaps(false);
        button.setIncludeFontPadding(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(context, 17), dp(context, 7), dp(context, 17), dp(context, 7));
        button.setBackground(focusBackground(context, 0xFF232327));
        button.setClipToOutline(true);
        focusable(button, 1.045f);
        button.setOnClickListener(action);
        return button;
    }

    static LinearLayout vertical(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        unclipped(layout);
        return layout;
    }

    static final class WatchProgress {
        final int index;
        final String label;
        final float fraction;
        WatchProgress(int index, String label, float fraction) {
            this.index = index; this.label = label; this.fraction = fraction;
        }
    }

    /** Source + item identity prevents same-title remakes or providers from sharing progress. */
    static WatchProgress watchProgress(Context context, TvRepository.VodItem item) {
        SharedPreferences playback = context.getSharedPreferences("kongwotv_playback", Context.MODE_PRIVATE);
        String key = PlaybackState.contentKey(item);
        int index = playback.getInt("selected_index_" + key, -1);
        String url = playback.getString("selected_url_" + key, "");
        long position = url == null || url.isEmpty() ? 0 : playback.getLong("position_" + PlaybackState.digest(url), 0);
        long duration = url == null || url.isEmpty() ? 0 : playback.getLong("duration_" + PlaybackState.digest(url), 0);
        String episode = playback.getString("selected_name_" + key, "");
        String label = index < 0 ? "打开影片查看进度" : (episode.isEmpty() ? "第 " + (index + 1) + " 集" : episode)
                + (position >= 60_000 ? " · 已看 " + position / 60_000 + " 分钟" : " · 随时继续");
        return new WatchProgress(index, label, duration > 0 ? Math.max(0, Math.min(1, (float) position / duration)) : -1);
    }

    static void showDialog(AlertDialog dialog, int maxWidthDp) {
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            Context context = dialog.getContext();
            int width = Math.min(context.getResources().getDisplayMetrics().widthPixels - dp(context, BuildConfig.IS_TV ? 64 : 24), dp(context, maxWidthDp));
            window.setBackgroundDrawable(rounded(context, 0xFC111114, 24, 0x1FFFFFFF, 1));
            window.setDimAmount(.72f);
            window.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        for (int which : new int[]{AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE, AlertDialog.BUTTON_NEUTRAL}) {
            Button button = dialog.getButton(which);
            if (button == null) continue;
            button.setAllCaps(false);
            button.setTextColor(new ColorStateList(new int[][]{{android.R.attr.state_focused}, {}}, new int[]{0xFF15161B, TEXT}));
            button.setBackground(focusBackground(button.getContext(), 0xFF232327));
            focusable(button, 1.035f);
        }
    }
}
