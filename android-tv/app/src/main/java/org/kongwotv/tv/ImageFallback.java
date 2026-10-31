package org.kongwotv.tv;

/** One fallback attempt belonging to the same image request, never a previous film. */
final class ImageFallback {
    private final String primary, fallback;
    private boolean attempted;
    ImageFallback(String primary, String fallback) {
        this.primary = http(primary); this.fallback = http(fallback);
    }
    String initial() { return primary.isEmpty() ? fallback : primary; }
    String onFailure() {
        if (attempted || primary.isEmpty() || fallback.isEmpty() || primary.equals(fallback)) return "";
        attempted = true;
        return fallback;
    }
    static String http(String value) {
        if (value == null) return "";
        String text = value.trim();
        return text.startsWith("https://") || text.startsWith("http://") ? text : "";
    }
}
