package org.kongwotv.tv;

import org.json.JSONException;
import org.json.JSONObject;

/** Independent landscape artwork; never replaces a source poster/cover. */
public final class Backdrop {
    public final String mediaType, path;
    public final int tmdbId, width, height;

    private Backdrop(String mediaType, int tmdbId, String path, int width, int height) {
        this.mediaType = mediaType;
        this.tmdbId = tmdbId;
        this.path = path;
        this.width = width;
        this.height = height;
    }

    static Backdrop create(String mediaType, int tmdbId, String path, int width, int height) {
        if (!("movie".equals(mediaType) || "tv".equals(mediaType)) || tmdbId <= 0
                || path == null || !path.matches("/[A-Za-z0-9]{10,64}\\.(?:jpg|png|webp)")
                || width < 1280 || height < 720 || width > 50000 || height > 50000) return null;
        double ratio = (double) width / height;
        if (ratio < 1.5 || ratio > 2.4) return null;
        return new Backdrop(mediaType, tmdbId, path, width, height);
    }

    public String url() { return "https://image.tmdb.org/t/p/original" + path; }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("mediaType", mediaType).put("tmdbId", tmdbId)
                .put("path", path).put("width", width).put("height", height);
    }

    static Backdrop fromJson(JSONObject row) {
        return row == null ? null : create(row.optString("mediaType"), row.optInt("tmdbId"),
                row.optString("path"), row.optInt("width"), row.optInt("height"));
    }
}
