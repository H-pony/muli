#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Opt-in native QA entry only. It uses the real DetailView, source repository and bundled catalog/CDN.
struct ArtworkDebugPreview: View {
    @EnvironmentObject private var store: AppStore
    private let film = Film(
        source: MediaSource(name: "360资源", url: "https://360zy.com/api.php/provide/vod"),
        mediaID: "4342", title: "燃烧女子的肖像",
        cover: "https://www.imgzy360.com:7788/upload/vod/20231129-12/14ec3ce4a41766fddaeee54b4d5b66c3.jpg",
        category: "剧情片", year: "2019", remarks: ""
    )
    var body: some View {
        NavigationStack { DetailView(film: film) }
            .overlay(alignment: .top) {
                Text("DEBUG · 调试模拟器验证 · 真实片源 / 图片")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.black.opacity(0.86), in: Capsule())
                    .allowsHitTesting(false)
            }
            .onAppear {
                store.highQualityArtworkEnabled = !ProcessInfo.processInfo.arguments.contains("--artwork-qa-cover")
            }
            .fullScreenCover(item: $store.playback) { PlayerScreen(request: $0, store: store) }
    }
}
#endif
