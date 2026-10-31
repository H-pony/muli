package org.kongwotv.tv;

/** Pure bounded decode planning, shared by the bitmap loader and memory regression tests. */
final class ImageDecodePolicy {
    static final int UHD_PIXELS = 3840 * 2160;
    final int maxWidth, maxHeight, maxPixels;
    final boolean lowMemory;

    ImageDecodePolicy(int maxWidth, int maxHeight, int maxPixels, boolean lowMemory) {
        this.maxWidth = maxWidth; this.maxHeight = maxHeight; this.maxPixels = maxPixels; this.lowMemory = lowMemory;
    }

    static ImageDecodePolicy poster() { return new ImageDecodePolicy(480, 720, 480 * 720, true); }

    static ImageDecodePolicy backdrop(int displayEdge, long heapBytes, boolean lowRam) {
        boolean low = lowRam || heapBytes < 192L * 1024 * 1024;
        int edge = Math.min(low ? 1280 : 3840, Math.max(720, displayEdge));
        int budgetPixels = (int) Math.min(UHD_PIXELS, Math.max(1280 * 720L, heapBytes / 32));
        return new ImageDecodePolicy(edge, edge, low ? 1280 * 720 : budgetPixels, low);
    }

    Plan plan(int width, int height) {
        if (width <= 0 || height <= 0 || width > 50000 || height > 50000) return null;
        double scale = Math.min(1d, Math.min((double) maxWidth / width, (double) maxHeight / height));
        scale = Math.min(scale, Math.sqrt((double) maxPixels / ((long) width * height)));
        int targetWidth = Math.max(1, (int) Math.floor(width * scale));
        int targetHeight = Math.max(1, (int) Math.floor(height * scale));
        int sample = 1;
        while (width / (sample * 2) >= targetWidth && height / (sample * 2) >= targetHeight) sample *= 2;
        return new Plan(targetWidth, targetHeight, sample, width / sample);
    }

    static final class Plan {
        final int width, height, sample, sampledWidth;
        Plan(int width, int height, int sample, int sampledWidth) {
            this.width = width; this.height = height; this.sample = sample; this.sampledWidth = sampledWidth;
        }
    }
}
