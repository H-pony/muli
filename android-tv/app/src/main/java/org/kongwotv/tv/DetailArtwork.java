package org.kongwotv.tv;

import android.app.AlertDialog;
import android.view.View;
import android.widget.ImageView;

/** Each detail window owns its lookup and image requests, including the first attach traversal. */
final class DetailArtwork {
    static void bind(ArtworkRepository repository, PosterLoader posters, TvRepository.VideoDetails detail,
                     ImageView target, AlertDialog dialog) {
        posters.loadBackdrop(detail.item.cover, target);
        class Binding implements View.OnAttachStateChangeListener {
            ArtworkRepository.Ticket lookup;
            boolean started;
            void start() {
                if (started || !dialog.isShowing()) return;
                started = true;
                int desiredWidth = Math.max(target.getResources().getDisplayMetrics().widthPixels,
                        target.getResources().getDisplayMetrics().heightPixels);
                lookup = repository.request(detail.item, desiredWidth, backdrop -> {
                    if (!dialog.isShowing() || !target.isAttachedToWindow() || !repository.isEnabled()) return;
                    detail.backdrop = backdrop;
                    if (backdrop != null) posters.loadBackdrop(backdrop.url(), detail.item.cover, target);
                });
            }
            @Override public void onViewAttachedToWindow(View view) { start(); }
            @Override public void onViewDetachedFromWindow(View view) {
                if (lookup != null) lookup.cancel();
                posters.cancel(target);
                target.removeOnAttachStateChangeListener(this);
            }
        }
        Binding binding = new Binding();
        target.addOnAttachStateChangeListener(binding);
        if (target.isAttachedToWindow()) binding.start();
    }
}
