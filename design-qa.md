# TV reference UI verification — 2026-10-25

final result: passed

## Scope and visual truth

- Source: `/Users/kongwo/Documents/项目/LibreTV/artifacts/tv-reference-ui-20261025/reference.png` (the user's selected attachment, 1792×1356).
- Implementation: `/Users/kongwo/Documents/项目/LibreTV/artifacts/tv-reference-ui-20261025/15-home-final-idle.png` (real Android TV app, 1920×1080, API34, density 2; logical viewport 960×540dp; CSS viewport is not applicable).
- Full comparison: `artifacts/tv-reference-ui-20261025/comparison.png`.
- Focused comparison: `artifacts/tv-reference-ui-20261025/comparison-focused.png` (header, information/actions, shelf).
- State: home, first real featured movie, main navigation focused. Source is a taller viewport; the implementation intentionally adapts it to a 16:9 television. Both full images are shown at a common 960px width, retaining their aspect ratios and explicit unused space. The comparison does not claim pixel equality between different aspect ratios or movie artwork.

## Findings and iteration history

1. `01-home-first.png`: P2 navigation text wrapped; the image escaped the hero bounds into the shelf; a trailer was selected as the default movie; the previous arrow intersected the title. Fixed single-line navigation, bounded hero clipping, feature selection, and arrow placement.
2. `03-home-final.png`: those issues were resolved and real shared HD artwork displayed. A remaining P2 replaced the reference's usable “show all” control with a static subtitle. Fixed with a real, focusable “查看全部” action that opens the actual discovery/search page, history, or live section as appropriate. Cleaned leading full-width whitespace in source synopsis text.
3. `12-home-bundled.png`, confirmed on the shipping package in `15-home-final-idle.png`: final visual comparison passes. The three verified 3840×2160 home backgrounds now ship with the TV flavor as original JPEG bytes; this avoids a cold-start dependency on the CDN. Loading respects the existing HD preference, cancellation, decode/memory budget and original-cover fallback. No current P0/P1/P2 findings remain.
4. `rejected-02-wrong-foreground.png` was the Android TV system launcher, not the app, and was rejected. `09-home-original-poster.png`, `10-home-final.png`, and `11-home-complete.png` show the prior network fallback, not the accepted HD state.

## Five fidelity surfaces

- Typography: native sans-serif Chinese text; 15sp navigation, 26sp film heading, 12sp metadata/body, 23sp shelf heading. Hierarchy and truncation remain legible at the captured TV viewport; navigation stays on one line.
- Layout: full-width hero occupies approximately 75% of the television height; navigation overlays it; text starts at the 80px horizontal inset; white primary action, round secondary control, separated carousel arrows and pagination, then a horizontal portrait-poster shelf. Hero and shelf images do not escape their bounds or stretch.
- Colors: #0D1117 dark base and matching image shades, near-white text, white primary action, translucent neutral secondary controls. White focus and muted selected states remain distinguishable.
- Images: actual film artwork and source posters; the three bundled originals are 3840×2160 and byte-identical to the existing verified project files. Attribution and shared identity metadata are preserved. Runtime decoding retains the existing bounds; no new image was generated or re-encoded.
- Copy/content: 幕里 brand, Chinese controls, real film titles/year/type/source. No fabricated ratings, memberships, notifications or profile identity. Source “download” action becomes the supported film-details action. Five existing destinations remain functional.

## Interaction evidence

- Real release APK: top navigation → primary play/details → previous/next; title changes and focus remains on carousel controls. Refresh preserves the selected film and focus. “查看全部” opens the actual search/discovery screen.
- Search: actual system IME opens, SEARCH/DONE/Enter DOWN+UP/page search submit once, retain text, close the IME and focus the search action; re-edit and live filtering work.
- Existing TV smoke: local media decoding, real player transport, seeking, speed, resize, episodes, live switching and layered back actions pass.
- Actual featured-film entry: 《星际穿越》 entered the real player and advanced from 00:00 to 00:15; screenshots 05–07 record distinct frames and the advancing time.
- Unit tests and lint are summarized in `artifacts/tv-reference-ui-20261025/validation.json`.

## Intentional differences and limits

The user's reference is a composition target rather than a request to copy Waqana branding or unsupported product features. The 16:9 crop, 幕里 brand, five real destinations, clock, actual film art, and supported details action are accepted adaptations. When source details are unavailable the hero shows the real source instead of inventing a synopsis. The final shipping-package capture also shows the real source synopsis loaded and left-aligned. `13-search-live-final.png` verifies the current search layout; `14-home-live-final.png` was captured during the entry fade and is excluded from the accepted set. Network-dependent source availability remains separate from UI correctness. Native Android TV preview was checked; the physical Xiaomi television has not been updated or revalidated. This is not a claim of complete Apple HIG or assistive-technology compliance.

## Checklist

- [x] Selected source and final native screenshot inspected.
- [x] Full and focused comparison boards inspected together.
- [x] Earlier P2 issues corrected and recaptured.
- [x] Five fidelity surfaces checked.
- [x] Real primary interactions and search regression exercised.
- [x] No actionable P0/P1/P2 differences remain.
