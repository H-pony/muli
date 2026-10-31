package org.kongwotv.tv;

import org.junit.Test;
import static org.junit.Assert.*;

public final class PlaybackGestureMathTest {
    @Test public void filmSwipeStaysPreciseAndClampsAtBothEnds() {
        assertEquals(660_000L, PlaybackGestureMath.seekTarget(600_000L, 360, 1080, 7_200_000L));
        assertEquals(0L, PlaybackGestureMath.seekTarget(10_000L, -1000, 1080, 7_200_000L));
        assertEquals(7_200_000L, PlaybackGestureMath.seekTarget(7_190_000L, 1000, 1080, 7_200_000L));
    }
    @Test public void shortClipsUseTheirOwnDuration() {
        assertEquals(6_000L, PlaybackGestureMath.seekTarget(3_000L, 270, 1080, 12_000L));
        assertEquals(12_000L, PlaybackGestureMath.seekTarget(3_000L, 1080, 1080, 12_000L));
    }
    @Test public void rotationAndInvalidMetadataCannotProduceOverflow() {
        assertEquals(10_000L, PlaybackGestureMath.seekTarget(10_000L, 10, 0, 120_000L));
        assertEquals(10_000L, PlaybackGestureMath.seekTarget(10_000L, Float.NaN, 1080, 120_000L));
        assertEquals(10_000L, PlaybackGestureMath.seekTarget(10_000L, 10, 1080, -1));
    }
    @Test public void brightnessAndVolumeRespectBoundariesAndGestureDirection() {
        assertEquals(.75f, PlaybackGestureMath.level(.5f, 150, 800), .001f);
        assertEquals(.25f, PlaybackGestureMath.level(.5f, -150, 800), .001f);
        assertEquals(1f, PlaybackGestureMath.level(.8f, 5000, 800), .001f);
        assertEquals(0f, PlaybackGestureMath.level(.2f, -5000, 800), .001f);
        assertEquals(.5f, PlaybackGestureMath.level(Float.NaN, 0, 800), .001f);
    }
}
