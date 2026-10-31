package org.kongwotv.tv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;

import static org.kongwotv.tv.TvUi.*;

/** Shared native controls in the independently rendered TV and phone/tablet settings pages. */
final class ArtworkSettings {
    static View content(Activity activity, ArtworkRepository repository) {
        LinearLayout body = vertical(activity);
        CheckBox enabled = new CheckBox(activity);
        enabled.setText("使用高清横图");
        enabled.setTextColor(TEXT);
        enabled.setTextSize(14);
        enabled.setChecked(repository.isEnabled());
        enabled.setContentDescription("使用高清横图，可关闭以仅显示原封面");
        body.addView(enabled, new LinearLayout.LayoutParams(-1, dp(activity, 48)));
        TextView explanation = text(activity, "优先使用已核实片目。可选填入你自己的 TMDB API Key（v3）或 API Read Access Token，为其他影片查找横图。图片不可用时显示原封面。", 12, MUTED);
        explanation.setLineSpacing(dp(activity, 4), 1);
        explanation.setPadding(0, dp(activity, 5), 0, dp(activity, 12));
        body.addView(explanation);
        EditText credential = new EditText(activity);
        credential.setSingleLine(true);
        credential.setTextColor(TEXT);
        credential.setTextSize(13);
        credential.setHintTextColor(MUTED);
        credential.setHint(repository.hasCredential() ? "已保存凭据；留空保留" : "可选：自己的 TMDB 凭据");
        credential.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        credential.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        credential.setSaveEnabled(false);
        if (Build.VERSION.SDK_INT >= 26) {
            credential.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            credential.setImeOptions(credential.getImeOptions() | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        }
        credential.setPadding(dp(activity, 12), 0, dp(activity, 12), 0);
        credential.setBackground(rounded(activity, 0xFF232327, 9, 0x33FFFFFF, 1));
        body.addView(credential, new LinearLayout.LayoutParams(-1, dp(activity, 48)));
        TextView privacy = text(activity, "凭据仅保存在此设备的应用私有数据中，不进入日志或导出。", 10, MUTED);
        privacy.setPadding(0, dp(activity, 8), 0, dp(activity, 12));
        body.addView(privacy);
        Button save = button(activity, "保存图片设置", view -> {
            String raw = credential.getText().toString().trim();
            if (!raw.isEmpty() && ArtworkRepository.cleanCredential(raw).isEmpty()) {
                Toast.makeText(activity, "请输入有效的 TMDB Key 或读取令牌", Toast.LENGTH_SHORT).show();
                return;
            }
            repository.saveSettings(enabled.isChecked(), raw, false);
            credential.setText("");
            credential.setHint(repository.hasCredential() ? "已保存凭据；留空保留" : "可选：自己的 TMDB 凭据");
            Toast.makeText(activity, "图片设置已保存", Toast.LENGTH_SHORT).show();
        });
        body.addView(save, new LinearLayout.LayoutParams(-1, dp(activity, 44)));
        Button clear = button(activity, "移除 TMDB 凭据", view -> {
            repository.saveSettings(enabled.isChecked(), "", true);
            credential.setText("");
            credential.setHint("可选：自己的 TMDB 凭据");
            Toast.makeText(activity, "TMDB 凭据已移除", Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(-1, dp(activity, 44));
        clearParams.topMargin = dp(activity, 9);
        body.addView(clear, clearParams);
        ImageView logo = new ImageView(activity);
        logo.setScaleType(ImageView.ScaleType.FIT_START);
        logo.setContentDescription("TMDB");
        try (InputStream input = activity.getAssets().open("tmdb-logo.png")) {
            logo.setImageDrawable(Drawable.createFromStream(input, "TMDB"));
        } catch (IOException ignored) { }
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(activity, 170), dp(activity, 27));
        logoParams.topMargin = dp(activity, 22);
        body.addView(logo, logoParams);
        TextView attribution = text(activity, "高清图片来源：TMDB\nThis product uses the TMDB API but is not endorsed or certified by TMDB.", 10, MUTED);
        attribution.setLineSpacing(dp(activity, 3), 1);
        attribution.setPadding(0, dp(activity, 8), 0, dp(activity, 10));
        body.addView(attribution);
        Button link = button(activity, "访问 TMDB · themoviedb.org", view -> {
            try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.themoviedb.org/"))); }
            catch (android.content.ActivityNotFoundException ignored) {
                Toast.makeText(activity, "https://www.themoviedb.org/", Toast.LENGTH_LONG).show();
            }
        });
        body.addView(link, new LinearLayout.LayoutParams(-1, dp(activity, 44)));
        return body;
    }
}
