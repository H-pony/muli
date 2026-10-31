package org.kongwotv.tv;

/** Bounded gesture mapping, independent of Android's display density. */
final class PlaybackGestureMath {
    private PlaybackGestureMath() { }

    static long seekTarget(long startMs, float distance, int width, long durationMs) {
        if (durationMs <= 0 || width <= 0 || (Float.isNaN(distance) || Float.isInfinite(distance))) return Math.max(0, startMs);
        // A full-width swipe covers up to three minutes; short clips remain precise.
        long span = Math.min(durationMs, 180_000L);
        double target = startMs + (double) distance / width * span;
        return Math.round(Math.max(0, Math.min(durationMs, target)));
    }

    static float level(float start, float upwardDistance, int height) {
        if ((Float.isNaN(start) || Float.isInfinite(start))) start = .5f;
        if (height <= 0 || (Float.isNaN(upwardDistance) || Float.isInfinite(upwardDistance))) return Math.max(0, Math.min(1, start));
        return Math.max(0, Math.min(1, start + upwardDistance / (height * .75f)));
    }
}
