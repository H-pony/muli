#if canImport(UIKit)
import SwiftUI
import UIKit
import ImageIO

struct LoadedBackdrop: @unchecked Sendable {
    let image: UIImage
}

/// Validate the downloaded pixels, not just TMDB metadata, before replacing the existing cover.
actor BackdropImageRepository {
    static let shared = BackdropImageRepository()
    private struct Entry {
        var image: LoadedBackdrop?
        var expires: Date
        var accessed: Date
    }
    private var cache: [String: Entry] = [:]
    private var inFlight: [String: Task<LoadedBackdrop?, Never>] = [:]

    func image(for artwork: BackdropArtwork) async -> LoadedBackdrop? {
        guard let url = artwork.url else { return nil }
        let key = url.absoluteString
        let now = Date()
        if var entry = cache[key], entry.expires > now {
            entry.accessed = now; cache[key] = entry
            return entry.image
        }
        if let task = inFlight[key] { return await task.value }
        let task = Task { () -> LoadedBackdrop? in
            do {
                let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6)
                let data = try await ArtworkHTTPClient.shared.download(request, limit: 24 * 1024 * 1024)
                return Self.decode(data)
            } catch { return nil }
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        cache = cache.filter { $0.value.expires > now }
        // A decoded 3840px image can occupy tens of MB; keep at most two successful images.
        while image != nil, cache.values.filter({ $0.image != nil }).count >= 2,
              let oldest = cache.filter({ $0.value.image != nil }).min(by: { $0.value.accessed < $1.value.accessed })?.key {
            cache[oldest] = nil
        }
        if cache.count >= 200, let oldest = cache.min(by: { $0.value.accessed < $1.value.accessed })?.key { cache[oldest] = nil }
        cache[key] = Entry(image: image, expires: now.addingTimeInterval(image == nil ? ArtworkCacheLifetime.failure : ArtworkCacheLifetime.success), accessed: now)
        return image
    }

    nonisolated static func decode(_ data: Data) -> LoadedBackdrop? {
        guard let image = BackdropImageDecoder.decode(data) else { return nil }
        return LoadedBackdrop(image: UIImage(cgImage: image))
    }
}

private struct ArtworkViewRequest: Equatable, Hashable {
    var filmID: String
    var identity: ArtworkIdentity
    var credentialRevision: Int
    var enabled: Bool
}

struct DetailBackdrop: View {
    let film: Film
    var identity: ArtworkIdentity?
    @EnvironmentObject private var store: AppStore
    @State private var loaded: LoadedBackdrop?
    @State private var loadedRequest: ArtworkViewRequest?
    private var request: ArtworkViewRequest {
        ArtworkViewRequest(filmID: film.id, identity: identity ?? ArtworkIdentity(film: film),
                           credentialRevision: store.artworkCredentialRevision, enabled: store.highQualityArtworkEnabled)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Poster(url: film.cover)
                if loadedRequest == request, let loaded {
                    Image(uiImage: loaded.image).resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }
        .accessibilityHidden(true)
        .overlay(alignment: .topTrailing) {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--artwork-qa-detail") {
                Group {
                    if loadedRequest == request, let image = loaded?.image.cgImage {
                        Text("TMDB 高清背景已加载 · \(image.width)×\(image.height)")
                    } else {
                        Text(request.enabled ? "原封面 · 高清背景等待 / 回退" : "原封面 · 高清背景已关闭")
                    }
                }
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                .padding(8).background(.black.opacity(0.78), in: Capsule()).padding(10)
            }
            #endif
        }
        .task(id: request) {
            let current = request
            loaded = nil; loadedRequest = nil
            guard current.enabled, !Task.isCancelled else { return }
            let credential = TMDBCredential(TMDBCredentialStore.read())
            guard let artwork = await store.backdrops.resolve(current.identity, credential: credential,
                                                              credentialRevision: current.credentialRevision),
                  !Task.isCancelled, current == request else { return }
            let image = await BackdropImageRepository.shared.image(for: artwork)
            guard !Task.isCancelled, current == request else { return }
            loaded = image; loadedRequest = image == nil ? nil : current
        }
        .onDisappear { loaded = nil; loadedRequest = nil }
    }
}

struct ArtworkSettingsControls: View {
    @EnvironmentObject private var store: AppStore
    @State private var draft = ""
    @State private var status: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Toggle("高清背景图", isOn: $store.highQualityArtworkEnabled).televisionFocus()
            Text("内置已匹配片目可直接显示高清背景；填写后自动获取更多影片高清背景。未匹配或加载失败时显示原封面。")
                .font(.footnote).foregroundStyle(Cinema.muted)
            credentialField
            HStack(spacing: 16) {
                Button(store.tmdbCredentialConfigured ? "更新凭据" : "保存凭据") {
                    if store.saveTMDBCredential(draft) {
                        draft = ""; status = "已在本机安全保存；详情会自动尝试获取高清背景。"
                    } else { status = "无法保存，请检查凭据格式或稍后重试。" }
                }.buttonStyle(CinemaPillStyle()).televisionFocus().disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if store.tmdbCredentialConfigured {
                    Button("移除凭据", role: .destructive) {
                        if store.saveTMDBCredential("") { draft = ""; status = "已移除 TMDB 凭据。" }
                        else { status = "无法移除，请稍后重试。" }
                    }.buttonStyle(CinemaPillStyle()).televisionFocus()
                }
            }
            Text(status ?? (store.tmdbCredentialConfigured ? "已配置 TMDB 凭据，仅安全保存在本机。" : "可选：使用你自己的 TMDB v3 API Key 或 API 读取令牌。"))
                .font(.footnote).foregroundStyle(Cinema.muted)
        }
        .onDisappear { draft = "" }
    }

    @ViewBuilder private var credentialField: some View {
        #if os(tvOS)
        SecureField("TMDB API Key 或读取令牌", text: $draft).platformSearchStyle()
        #else
        SecureField("TMDB API Key 或读取令牌", text: $draft)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .privacySensitive().platformSearchStyle()
        #endif
    }
}

struct TMDBAttribution: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Link(destination: URL(string: "https://www.themoviedb.org")!) {
                HStack(spacing: 16) {
                    if let path = Bundle.main.path(forResource: "tmdb-logo", ofType: "png"), let logo = UIImage(contentsOfFile: path) {
                        Image(uiImage: logo).resizable().scaledToFit().frame(width: 150, height: 38)
                    }
                    Text("TMDB · 图片与元数据").font(.headline)
                }
            }.televisionFocus()
            Text("This product uses the TMDB API but is not endorsed or certified by TMDB.")
                .font(.footnote).foregroundStyle(Cinema.muted).fixedSize(horizontal: false, vertical: true)
            Text("www.themoviedb.org").font(.caption).foregroundStyle(Cinema.muted)
        }
    }
}
#endif
