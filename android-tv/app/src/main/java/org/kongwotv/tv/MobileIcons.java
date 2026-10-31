package org.kongwotv.tv;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/** Small native line icons, using the same 24px geometry as the web catalogue. */
final class MobileIcons extends Drawable {
    enum Kind { HOME, FILM, SCREEN, SPARK, LIVE, SEARCH, HISTORY, SETTINGS, PLAY, ARROW, CHEVRON, CLOSE, FILTER, RESET }

    private final Kind kind;
    private final ColorStateList colors;
    private final int size;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private int alpha = 255;

    MobileIcons(Context context, Kind kind, int color, int sizeDp) {
        this(context, kind, ColorStateList.valueOf(color), sizeDp);
    }

    MobileIcons(Context context, Kind kind, ColorStateList colors, int sizeDp) {
        this.kind = kind;
        this.colors = colors;
        size = TvUi.dp(context, sizeDp);
        paint.setStrokeWidth(1.65f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
    }

    @Override public void draw(Canvas canvas) {
        int save = canvas.save();
        canvas.translate(getBounds().left, getBounds().top);
        canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
        paint.setColor(colors.getColorForState(getState(), colors.getDefaultColor()));
        paint.setAlpha(Math.round(android.graphics.Color.alpha(paint.getColor()) * alpha / 255f));
        paint.setStyle(Paint.Style.STROKE);
        path.reset();
        switch (kind) {
            case HOME:
                line(3, 10, 12, 3, 21, 10);
                line(5, 9, 5, 21, 10, 21, 10, 15, 14, 15, 14, 21, 19, 21, 19, 9);
                break;
            case FILM:
                canvas.drawRoundRect(new RectF(3, 4, 21, 20), 2, 2, paint);
                line(7, 4, 7, 20); line(17, 4, 17, 20);
                for (int y = 8; y < 20; y += 4) { line(3, y, 7, y); line(17, y, 21, y); }
                break;
            case SCREEN:
                canvas.drawRoundRect(new RectF(3, 5, 21, 18), 2.5f, 2.5f, paint);
                line(8, 21, 16, 21); line(12, 18, 12, 21);
                break;
            case SPARK:
                line(12, 3, 14.5f, 9.5f, 21, 12, 14.5f, 14.5f, 12, 21, 9.5f, 14.5f, 3, 12, 9.5f, 9.5f, 12, 3);
                break;
            case LIVE:
                canvas.drawCircle(12, 12, 1.5f, paint);
                canvas.drawArc(new RectF(3, 3, 21, 21), 135, 90, false, paint);
                canvas.drawArc(new RectF(3, 3, 21, 21), -45, 90, false, paint);
                canvas.drawArc(new RectF(7, 7, 17, 17), 135, 90, false, paint);
                canvas.drawArc(new RectF(7, 7, 17, 17), -45, 90, false, paint);
                break;
            case SEARCH:
                canvas.drawCircle(10.5f, 10.5f, 6.5f, paint); line(15.5f, 15.5f, 21, 21);
                break;
            case HISTORY:
                canvas.drawArc(new RectF(4, 4, 21, 21), -145, 305, false, paint);
                line(3, 4, 3, 9, 8, 9); line(12, 7, 12, 12, 15.5f, 14);
                break;
            case SETTINGS:
                for (int i = 0; i < 8; i++) {
                    double a = Math.PI * i / 4;
                    line(12 + 7 * (float) Math.cos(a), 12 + 7 * (float) Math.sin(a),
                            12 + 9.5f * (float) Math.cos(a), 12 + 9.5f * (float) Math.sin(a));
                }
                canvas.drawCircle(12, 12, 7, paint); canvas.drawCircle(12, 12, 2.7f, paint);
                break;
            case PLAY:
                paint.setStyle(Paint.Style.FILL);
                line(8, 4.5f, 20, 12, 8, 19.5f, 8, 4.5f);
                break;
            case ARROW:
                line(5, 12, 19, 12); line(13, 6, 19, 12, 13, 18);
                break;
            case CHEVRON:
                line(9, 5, 16, 12, 9, 19);
                break;
            case CLOSE:
                line(6, 6, 18, 18); line(18, 6, 6, 18);
                break;
            case FILTER:
                line(4, 7, 20, 7); line(7, 12, 17, 12); line(10, 17, 14, 17);
                break;
            case RESET:
                canvas.drawArc(new RectF(4, 4, 20, 20), -145, 305, false, paint);
                line(3, 4, 3, 9, 8, 9);
                break;
        }
        canvas.drawPath(path, paint);
        canvas.restoreToCount(save);
    }

    private void line(float... points) {
        path.moveTo(points[0], points[1]);
        for (int i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
    }

    @Override public boolean isStateful() { return colors.isStateful(); }
    @Override protected boolean onStateChange(int[] state) { invalidateSelf(); return true; }
    @Override public int getIntrinsicWidth() { return size; }
    @Override public int getIntrinsicHeight() { return size; }
    @Override public void setAlpha(int alpha) { this.alpha = alpha; invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}
