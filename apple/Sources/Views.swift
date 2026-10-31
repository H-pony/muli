import SwiftUI

#if os(tvOS)
private let canvas = Cinema.canvas
private let panel = Cinema.surface

private enum TVSection: Int, CaseIterable {
    case home, search, live, history, settings
    var title: String {
        switch self {
        case .home: return "推荐"
        case .search: return "搜索"
        case .live: return "直播"
        case .history: return "历史"
        case .settings: return "设置"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .search: return "magnifyingglass"
        case .live: return "tv"
        case .history: return "clock.arrow.circlepath"
        case .settings: return "gearshape"
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selection: TVSection = .home

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            NavigationStack {
                Group {
                    switch selection {
                    case .home: HomeView()
                    case .search: SearchView()
                    case .live: LiveView()
                    case .history: HistoryView()
                    case .settings: SettingsView()
                    }
                }
                .navigationDestination(for: Film.self) { DetailView(film: $0) }
            }
            .id(selection)
        }
        .background(canvas).tint(Cinema.text)
        .fullScreenCover(item: $store.playback) { request in PlayerScreen(request: request, store: store) }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image("BrandMark").resizable().scaledToFit().frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .accessibilityHidden(true)
                Text("幕里").font(.system(size: 29, weight: .bold))
            }.padding(.bottom, 44)
            ForEach(TVSection.allCases, id: \.rawValue) { section in
                Button { selection = section } label: {
                    Label(section.title, systemImage: section.icon)
                        .font(.system(size: 22, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                        .padding(.horizontal, 16)
                        .foregroundStyle(selection == section ? Cinema.text : Cinema.muted)
                        .background(selection == section ? Cinema.chip : .clear, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain).televisionFocus()
                .accessibilityAddTraits(selection == section ? .isSelected : [])
            }
            Spacer()
        }
        .padding(.horizontal, 28).padding(.top, 66).padding(.bottom, 42)
        .frame(width: 264).background(Cinema.surface.opacity(0.7))
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 42) {
                TVFeaturedHero(film: store.home.first, loading: store.homeLoading)
                if !store.history.isEmpty { TVContinueRail(entries: Array(store.history.prefix(10))) }
                HStack(alignment: .firstTextBaseline) {
                    Text("为你推荐").font(.system(size: 32, weight: .bold))
                    Spacer()
                    Button { Task { await store.loadHome(force: true) } } label: {
                        Label("刷新", systemImage: "arrow.clockwise").font(.system(size: 20, weight: .medium))
                    }.buttonStyle(CinemaPillStyle()).televisionFocus().disabled(store.homeLoading)
                }
                WarningView(messages: store.homeWarnings)
                if store.home.isEmpty {
                    EmptyState(icon: "sparkles.tv", title: store.homeLoading ? "正在获取推荐" : "暂无推荐", message: "聚合多个点播来源，也可以通过搜索查找片名。")
                } else {
                    TVFilmRail(films: Array(store.home.prefix(18)))
                    if store.home.count > 18 {
                        Text("更多值得一看").font(.system(size: 32, weight: .bold))
                        TVFilmRail(films: Array(store.home.dropFirst(18)))
                    }
                }
                Text("内容由第三方来源提供，实际可用性取决于源站与网络。")
                    .font(.system(size: 18)).foregroundStyle(Cinema.faint)
            }.padding(.horizontal, pagePadding).padding(.top, 36).padding(.bottom, 64)
        }
        .background(canvas).navigationTitle("")
        .task(id: store.sourceSignature) { await store.loadHome() }
    }
}

private struct TVFeaturedHero: View {
    let film: Film?
    let loading: Bool
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Poster(url: film?.cover ?? "")
            LinearGradient(colors: [.clear, .black.opacity(0.25), canvas], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.black.opacity(0.72), .clear], startPoint: .leading, endPoint: .trailing)
            VStack(alignment: .leading, spacing: 18) {
                Text("幕里 · 主页").font(.system(size: 20, weight: .semibold)).foregroundStyle(Cinema.muted)
                Text(film?.title ?? (loading ? "正在寻找好故事" : "你的下一段观影时光"))
                    .font(.system(size: 56, weight: .bold)).tracking(-1.6).lineLimit(2)
                if let film {
                    if !film.subtitle.isEmpty { Text(film.subtitle).font(.system(size: 22)).foregroundStyle(Cinema.muted).lineLimit(2) }
                    Text(film.source.name).font(.system(size: 18)).foregroundStyle(Cinema.muted)
                    NavigationLink(value: film) { Label("查看影片", systemImage: "play.fill") }
                        .buttonStyle(CinemaPillStyle(primary: true)).televisionFocus().padding(.top, 10)
                } else {
                    Text("电影、剧集与直播，随时开始。").font(.system(size: 22)).foregroundStyle(Cinema.muted)
                    if loading { ProgressView().tint(.white) }
                }
            }.frame(maxWidth: 760, alignment: .leading).padding(44)
        }
        .frame(height: 540)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

private struct TVFilmRail: View {
    let films: [Film]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 28) {
                ForEach(films) { film in
                    NavigationLink(value: film) { FilmCard(film: film).frame(width: 230) }
                        .buttonStyle(.plain).televisionFocus()
                }
            }.padding(.vertical, 14).padding(.horizontal, 8)
        }
        .padding(.horizontal, -8)
    }
}

private struct TVContinueRail: View {
    @EnvironmentObject private var store: AppStore
    let entries: [WatchEntry]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("继续观看").font(.system(size: 32, weight: .bold))
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 26) {
                    ForEach(entries) { entry in
                        Button { store.playback = entry.resumedRequest } label: {
                            VStack(alignment: .leading, spacing: 12) {
                                Poster(url: entry.request.film?.cover ?? "").frame(height: 170)
                                    .overlay { Image(systemName: "play.fill").font(.system(size: 24)).foregroundStyle(Cinema.canvas).padding(18).background(.white, in: Circle()) }
                                    .clipShape(RoundedRectangle(cornerRadius: 16))
                                Text(entry.request.title).font(.system(size: 23, weight: .semibold)).lineLimit(1)
                                Text(entry.request.current.name + " · " + entry.positionText).font(.system(size: 18)).foregroundStyle(Cinema.muted).lineLimit(1)
                                if !entry.request.isLive { ProgressView(value: entry.progress).tint(Cinema.text) }
                            }.frame(width: 310, alignment: .leading)
                        }.buttonStyle(.plain).televisionFocus()
                    }
                }.padding(.vertical, 14).padding(.horizontal, 8)
            }.padding(.horizontal, -8)
        }
    }
}

struct SearchView: View {
    @EnvironmentObject private var store: AppStore
    @State private var keyword = ""
    @State private var submitted = ""
    @State private var films: [Film] = []
    @State private var warnings: [String] = []
    @State private var loading = false
    @State private var searchNonce = 0
    private var searchIdentity: String { submitted + "|" + store.sourceSignature + "|" + String(searchNonce) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 12) {
                    TextField("输入影片或剧集名称", text: $keyword).platformSearchStyle()
                        .submitLabel(.search).onSubmit { submit() }
                    Button("搜索", systemImage: "magnifyingglass") { submit() }
                        .buttonStyle(.borderedProminent).disabled(keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if loading { HStack { ProgressView(); Text("正在搜索 \(store.activeSources.count) 个来源…").foregroundStyle(.secondary) } }
                WarningView(messages: warnings)
                if !submitted.isEmpty && !loading { Text("“\(submitted)” · \(films.count) 个结果").font(.headline) }
                if films.isEmpty {
                    EmptyState(icon: "magnifyingglass", title: submitted.isEmpty ? "寻找想看的故事" : loading ? "正在搜索" : "未找到相关影片", message: submitted.isEmpty ? "按片名搜索，自动聚合已启用的来源。" : "可换一个关键词，或在设置中调整来源后重试。")
                } else { FilmGrid(films: films) }
            }.padding(pagePadding)
        }.background(canvas).navigationTitle("片名搜索")
        .task(id: searchIdentity) {
            guard !submitted.isEmpty else { return }
            let query = submitted
            let sources = store.activeSources
            loading = true; warnings = []; films = []
            defer { if !Task.isCancelled { loading = false } }
            let results = await store.repository.aggregate(sources, keyword: query)
            guard !Task.isCancelled else { return }
            films = MediaRepository.merge(results, keyword: query)
            warnings = results.compactMap { item in item.error.map { item.source.name + "：" + $0 } }
            if sources.isEmpty { warnings = ["请在设置中启用至少一个点播来源。"] }
        }
    }
    private func submit() {
        let query = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        submitted = query
        searchNonce += 1
    }
}

struct FilmGrid: View {
    let films: [Film]
    #if os(tvOS)
    private let columns = [GridItem(.adaptive(minimum: 230, maximum: 300), spacing: 30)]
    #else
    private let columns = [GridItem(.adaptive(minimum: 145, maximum: 220), spacing: 16)]
    #endif
    var body: some View {
        LazyVGrid(columns: columns, spacing: 24) {
            ForEach(films) { film in
                NavigationLink(value: film) { FilmCard(film: film) }.buttonStyle(.plain).televisionFocus()
            }
        }
    }
}

struct FilmCard: View {
    let film: Film
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Poster(url: film.cover).aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay(alignment: .bottomLeading) {
                    Text(film.source.name).font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 5)
                        .background(.black.opacity(0.75), in: Capsule()).padding(8)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14))
            Text(film.title).font(.headline).lineLimit(1)
            Text(film.subtitle.isEmpty ? film.source.name : film.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }.contentShape(Rectangle())
    }
}

struct Poster: View {
    let url: String
    var body: some View {
        GeometryReader { proxy in
            AsyncImage(url: MediaRepository.httpURL(url)) { image in image.resizable().scaledToFill() } placeholder: {
                ZStack {
                    LinearGradient(colors: [Cinema.text.opacity(0.22), panel], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "play.rectangle").font(.largeTitle).foregroundStyle(Cinema.text.opacity(0.6))
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }
    }
}

struct DetailView: View {
    let film: Film
    @EnvironmentObject private var store: AppStore
    @State private var details: FilmDetails?
    @State private var error: String?
    @State private var selectedLine = ""
    @State private var retry = 0
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ZStack(alignment: .bottomLeading) {
                    DetailBackdrop(film: film, identity: details?.film.id == film.id ? details?.artworkIdentity : nil)
                    LinearGradient(colors: [.clear, canvas], startPoint: .top, endPoint: .bottom)
                    LinearGradient(colors: [.black.opacity(0.65), .clear], startPoint: .leading, endPoint: .trailing)
                    VStack(alignment: .leading, spacing: 18) {
                        Text(film.title).font(.system(size: 54, weight: .bold)).tracking(-1.2).lineLimit(3)
                        if !film.subtitle.isEmpty { Text(film.subtitle).font(.system(size: 22)).foregroundStyle(Cinema.muted) }
                        Text(film.source.name).font(.system(size: 19)).foregroundStyle(Cinema.muted)
                        if let details, let episode = details.preferredEpisode(line: selectedLine, history: store.historyEntry(for: details.film)) {
                            Button { store.play(details, episode: episode) } label: {
                                Label(store.historyEntry(for: details.film)?.playbackLabel(for: episode, film: details.film) ?? "立即播放", systemImage: "play.fill")
                            }
                                .buttonStyle(CinemaPillStyle(primary: true)).televisionFocus().padding(.top, 8)
                        }
                    }.frame(maxWidth: 780, alignment: .leading).padding(40)
                }.frame(height: 500).clipShape(RoundedRectangle(cornerRadius: 24))
                if let details {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("剧情简介").font(.system(size: 28, weight: .bold))
                        Text(details.synopsis).font(.system(size: 23)).foregroundStyle(Cinema.muted).lineSpacing(7).platformTextSelection()
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(28).cinemaSurface(radius: 22)
                    Text("播放线路").font(.title2.bold())
                    ScrollView(.horizontal) {
                        HStack(spacing: 12) {
                            ForEach(details.lines, id: \.self) { line in
                                Button { selectedLine = line } label: {
                                    CinemaChip(title: line, selected: selectedLine == line)
                                }.buttonStyle(.plain).televisionFocus()
                            }
                        }
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: episodeWidth), spacing: 14)], spacing: 14) {
                        ForEach(details.episodes.filter { $0.line == selectedLine }) { episode in
                            Button { store.play(details, episode: episode) } label: {
                                Text(episode.name).font(.system(size: 22, weight: .medium)).lineLimit(1).frame(maxWidth: .infinity, minHeight: 64).padding(.horizontal, 18).cinemaSurface(radius: 14)
                            }.buttonStyle(.plain).televisionFocus()
                        }
                    }
                } else if let error {
                    EmptyState(icon: "exclamationmark.triangle", title: "详情加载失败", message: error)
                    Button("重新加载") { retry += 1 }.buttonStyle(.bordered)
                } else { ProgressView("正在获取详情与选集…").frame(maxWidth: .infinity).padding(40) }
            }.padding(pagePadding)
        }.background(canvas).navigationTitle("")
        .task(id: film.id + "|" + String(retry)) {
            error = nil; details = nil; selectedLine = ""
            do {
                let value = try await store.repository.details(film)
                guard !Task.isCancelled else { return }
                details = value; selectedLine = store.preferredLine(for: value)
            } catch { if !Task.isCancelled { self.error = MediaRepository.message(error) } }
        }
    }
}

struct LiveView: View {
    @EnvironmentObject private var store: AppStore
    @State private var query = ""
    @State private var selectedGroup = "全部"
    private var groups: [String] { ["全部"] + Set(store.channels.map(\.group)).sorted() }
    private var filtered: [LiveChannel] {
        store.channels.filter { (selectedGroup == "全部" || $0.group == selectedGroup) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    TextField("搜索频道", text: $query).platformSearchStyle()
                    Button { Task { await store.refreshLive() } } label: { Label("更新频道", systemImage: "arrow.clockwise") }.disabled(store.liveLoading)
                }
                if store.liveLoading { ProgressView("正在更新订阅，内置频道仍可播放…") }
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(groups, id: \.self) { group in
                            Button { selectedGroup = group } label: {
                                CinemaChip(title: group, selected: selectedGroup == group)
                            }.buttonStyle(.plain).televisionFocus()
                        }
                    }
                }
                Text("\(filtered.count) 个频道").font(.subheadline).foregroundStyle(.secondary)
                WarningView(messages: store.liveWarnings)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: liveWidth), spacing: 16)], spacing: 16) {
                    ForEach(filtered) { channel in
                        Button { store.play(channel) } label: {
                            HStack(spacing: 14) {
                                Image(systemName: "tv.fill").font(.title2).foregroundStyle(Cinema.text).frame(width: 36)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(channel.name).font(.headline).lineLimit(1)
                                    Text(channel.group).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }.padding(18).background(panel, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain).televisionFocus()
                    }
                }
                if filtered.isEmpty { EmptyState(icon: "tv", title: "没有匹配的频道", message: "请调整分组或关键词。") }
                Text("部分频道需要 IPv6；源站可能按地区限制访问。播放失败时可切换频道。")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(pagePadding)
        }.background(canvas).navigationTitle("电视直播")
    }
}

struct HistoryView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if store.history.isEmpty { EmptyState(icon: "clock", title: "从一个故事开始", message: "观看后会自动保存进度，下次可以继续播放。") }
                ForEach(store.history) { entry in
                    HStack(spacing: 16) {
                        Button { store.playback = entry.resumedRequest } label: {
                            HStack(spacing: 16) {
                                Image(systemName: entry.request.isLive ? "dot.radiowaves.left.and.right" : "play.circle.fill").font(.title).foregroundStyle(Cinema.text)
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(entry.request.title).font(.headline).lineLimit(1)
                                    Text(entry.request.current.name + " · " + entry.positionText).font(.caption).foregroundStyle(.secondary)
                                    if !entry.request.isLive { ProgressView(value: entry.progress).tint(Cinema.text) }
                                }
                                Spacer()
                            }.padding(18).background(panel, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain).televisionFocus()
                        if let film = entry.request.film {
                            NavigationLink(value: film) { Image(systemName: "info.circle") }
                                .buttonStyle(CinemaPillStyle()).televisionFocus().accessibilityLabel("查看 " + film.title + " 的详情与线路")
                        }
                        Button(role: .destructive) { store.removeHistory(entry) } label: { Image(systemName: "trash") }
                            .buttonStyle(CinemaPillStyle()).televisionFocus().accessibilityLabel("删除观看记录")
                    }
                }
            }.padding(pagePadding)
        }.background(canvas).navigationTitle("观看历史")
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var confirmClear = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                TVSettingsPanel("幕里 · 2.16.12") {
                    Label("好故事，随时开始", systemImage: "play.rectangle.fill").font(.title2.bold())
                    Text("影片、直播与海报直接从互联网来源加载；观看历史仅保存在本机。")
                        .font(.system(size: 20)).foregroundStyle(Cinema.muted)
                }
                TVSettingsPanel("点播来源") {
                    ForEach(store.configuration.vodSources) { source in
                        Toggle(isOn: Binding(get: { !store.disabledSources.contains(source.id) }, set: { store.setSource(source, enabled: $0) })) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(source.name).font(.system(size: 23, weight: .medium))
                                Text(URL(string: source.url)?.host ?? "").font(.system(size: 18)).foregroundStyle(Cinema.muted)
                            }
                        }.televisionFocus()
                    }
                }
                TVSettingsPanel("高清背景图") {
                    ArtworkSettingsControls()
                }
                TVSettingsPanel("播放与记录") {
                    Toggle("自动播放下一集", isOn: $store.autoPlayNext).televisionFocus()
                    Button("清空观看历史", role: .destructive) { confirmClear = true }
                        .buttonStyle(CinemaPillStyle()).televisionFocus()
                }
                TVSettingsPanel("来源与开源许可") {
                    TMDBAttribution()
                    NavigationLink("版权声明与数据来源") { LegalView(resource: "NOTICE", title: "版权与数据来源") }
                        .buttonStyle(CinemaPillStyle()).televisionFocus()
                    NavigationLink("GNU AGPL v3 许可证") { LegalView(resource: "LICENSE", title: "开源许可证") }
                        .buttonStyle(CinemaPillStyle()).televisionFocus()
                    Text("第三方源的内容与可用性由各自提供者负责。请仅访问你有权观看的内容。")
                        .font(.system(size: 19)).foregroundStyle(Cinema.muted)
                }
            }.padding(pagePadding)
        }.background(canvas).navigationTitle("设置")
        .confirmationDialog("清空本机的全部观看历史？", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("清空历史", role: .destructive) { store.clearHistory() }
        }
    }
}

private struct TVSettingsPanel<Content: View>: View {
    let title: String
    let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(title).font(.system(size: 21, weight: .semibold)).foregroundStyle(Cinema.muted)
            content
        }.frame(maxWidth: .infinity, alignment: .leading).padding(30).cinemaSurface(radius: 22)
    }
}

struct LegalView: View {
    let resource: String
    let title: String
    private var text: String {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "txt"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "无法读取许可文件。" }
        return text
    }
    var body: some View {
        ScrollView { Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading).padding(pagePadding).platformTextSelection() }
            .navigationTitle(title).background(canvas)
    }
}

struct WarningView: View {
    let messages: [String]
    @State private var expanded = false
    var body: some View {
        if !messages.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Button { expanded.toggle() } label: {
                    HStack {
                        Text("来源状态 · \(messages.count) 条提示")
                        Spacer()
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    }
                }.buttonStyle(.plain).televisionFocus()
                if expanded {
                    ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                        Text(message).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }.font(.subheadline).foregroundStyle(.secondary).padding(14).background(panel, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon).font(.system(size: 46, weight: .light)).foregroundStyle(Cinema.text)
            Text(title).font(.title3.bold())
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 56)
    }
}

private let pagePadding: CGFloat = 56
private let episodeWidth: CGFloat = 210
private let liveWidth: CGFloat = 330
#else

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView(onLive: { selectedTab = 2 })
            }.tabItem { Label("推荐", systemImage: "house.fill") }.tag(0)
            NavigationStack { SearchView() }
                .tabItem { Label("搜索", systemImage: "magnifyingglass") }.tag(1)
            NavigationStack { LiveView() }
                .tabItem { Label("直播", systemImage: "tv") }.tag(2)
            NavigationStack { HistoryView() }
                .tabItem { Label("历史", systemImage: "clock.arrow.circlepath") }.tag(3)
            NavigationStack { SettingsView() }
                .tabItem { Label("设置", systemImage: "gearshape") }.tag(4)
        }
        .tint(Cinema.text)
        .toolbarBackground(Cinema.canvas, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .fullScreenCover(item: $store.playback) { request in
            PlayerScreen(request: request, store: store)
        }
    }
}

private struct CinemaPage<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) { content }
                .frame(maxWidth: 1200, alignment: .leading)
                .padding(.horizontal, sizeClass == .regular ? 32 : 18)
                .padding(.top, 18).padding(.bottom, 36)
                .frame(maxWidth: .infinity)
        }
        .background(Cinema.canvas)
        .toolbarBackground(Cinema.canvas, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PageHeading: View {
    let eyebrow: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(eyebrow).font(.caption2.weight(.medium)).tracking(1.5).foregroundStyle(Cinema.faint)
            Text(title).font(.system(size: 32, weight: .semibold)).tracking(-1.1).foregroundStyle(Cinema.text)
            Text(subtitle).font(.subheadline).foregroundStyle(Cinema.muted).lineSpacing(4)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: AppStore
    var onLive: () -> Void

    var body: some View {
        CinemaPage {
            CinematicHero(film: store.home.first, loading: store.homeLoading, onLive: onLive)
            if !store.history.isEmpty { ContinueWatchingRail(entries: Array(store.history.prefix(6))) }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 7) {
                    Text("为你推荐").font(.title2.weight(.semibold)).tracking(-0.5)
                    Text("发现下一部让你沉浸的好故事").font(.caption).foregroundStyle(Cinema.muted)
                }
                Spacer(minLength: 8)
                Button { Task { await store.loadHome(force: true) } } label: {
                    Image(systemName: "arrow.clockwise").frame(width: 44, height: 44)
                }.buttonStyle(CinemaPillStyle()).disabled(store.homeLoading).accessibilityLabel("刷新推荐")
            }
            WarningView(messages: store.homeWarnings)
            if store.home.isEmpty {
                EmptyState(icon: "sparkles.tv", title: store.homeLoading ? "正在获取推荐" : "暂无推荐", message: "推荐来自已启用的点播来源，也可以按片名搜索。")
            } else {
                FilmRail(films: Array(store.home.prefix(14)))
                if store.home.count > 14 {
                    Text("更多值得一看").font(.title2.weight(.bold)).tracking(-0.5)
                    FilmRail(films: Array(store.home.dropFirst(14)))
                }
            }
            Button(action: onLive) {
                HStack(spacing: 15) {
                    Image(systemName: "tv").font(.title2).frame(width: 46, height: 46)
                        .background(Cinema.chip, in: RoundedRectangle(cornerRadius: 13))
                    VStack(alignment: .leading, spacing: 7) {
                        Text("打开电视，遇见此刻。").font(.headline)
                        Text("新闻、纪录片与地方频道").font(.caption).foregroundStyle(Cinema.muted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Cinema.faint)
                }.padding(18).cinemaSurface(radius: 19)
            }.buttonStyle(.plain)
            Text("内容由第三方来源提供，实际可用性取决于源站与网络。")
                .font(.caption2).foregroundStyle(Cinema.faint).frame(maxWidth: .infinity)
        }
        .navigationTitle("幕里")
        .navigationDestination(for: Film.self) { DetailView(film: $0) }
        .task(id: store.sourceSignature) { await store.loadHome() }
    }
}

private struct CinematicHero: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let film: Film?
    let loading: Bool
    let onLive: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            GeometryReader { proxy in
                Poster(url: film?.cover ?? "")
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .overlay(Color.black.opacity(0.12))
            }
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: Cinema.canvas.opacity(0.68), location: 0.45), .init(color: Cinema.canvas, location: 1)], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.black.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
            heroContent.padding(sizeClass == .regular ? 34 : 25)
        }
        .frame(height: sizeClass == .regular ? 560 : 470)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.07)))
        .accessibilityElement(children: .contain)
    }

    private var heroContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("幕里  ·  主页").font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(Color.white.opacity(0.75))
            Text(film?.title ?? (loading ? "正在寻找好故事" : "你的下一段观影时光"))
                .font(.system(size: sizeClass == .regular ? 52 : 38, weight: .bold))
                .tracking(-1.3).lineLimit(3).foregroundStyle(Cinema.text)
            Text(film?.subtitle.isEmpty == false ? film!.subtitle : "电影、剧集与电视直播，尽在眼前。")
                .font(.caption).foregroundStyle(.white.opacity(0.68)).lineLimit(2)
            if let film { Text(film.source.name).font(.caption).foregroundStyle(Cinema.muted) }
            else if loading { ProgressView().tint(Cinema.text) }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { heroActions }
                VStack(alignment: .leading, spacing: 12) { heroActions }
            }.font(.subheadline.weight(.semibold)).padding(.top, 7)
        }.frame(maxWidth: 600, alignment: .leading)
    }

    @ViewBuilder private var heroActions: some View {
        if let film {
            NavigationLink(value: film) { Label("查看影片", systemImage: "play.fill") }
                .buttonStyle(CinemaPillStyle(primary: true))
        }
        Button(action: onLive) { Label("电视直播", systemImage: "tv") }
            .buttonStyle(CinemaPillStyle())
    }
}

private struct FilmRail: View {
    let films: [Film]
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 18) {
                ForEach(films) { film in
                    NavigationLink(value: film) { FilmCard(film: film).frame(width: sizeClass == .regular ? 205 : 155) }
                        .buttonStyle(.plain)
                }
            }.padding(.vertical, 4)
        }
    }
}

private struct ContinueWatchingRail: View {
    @EnvironmentObject private var store: AppStore
    let entries: [WatchEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("继续观看").font(.title2.weight(.semibold)).tracking(-0.5)
                Text("接着上次的故事").font(.caption).foregroundStyle(Cinema.faint)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 18) {
                    ForEach(entries) { entry in
                        Button { store.playback = entry.resumedRequest } label: {
                            ContinueCard(entry: entry).frame(width: 245)
                        }.buttonStyle(.plain)
                    }
                }.padding(.vertical, 2)
            }
        }
    }
}

private struct ContinueCard: View {
    let entry: WatchEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Poster(url: entry.request.film?.cover ?? "").frame(height: 126)
                .overlay(.black.opacity(0.16))
                .overlay { Image(systemName: "play.fill").font(.body).foregroundStyle(Cinema.canvas).padding(15).background(.white, in: Circle()) }
            VStack(alignment: .leading, spacing: 7) {
                Text(entry.request.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(entry.request.current.name + " · " + entry.positionText).font(.caption2).foregroundStyle(Cinema.muted).lineLimit(1)
            }.padding(14)
            GeometryReader { proxy in
                Rectangle().fill(Cinema.line)
                Rectangle().fill(Cinema.text).frame(width: proxy.size.width * entry.progress)
            }.frame(height: 3)
        }.cinemaSurface(radius: 16).clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct SearchView: View {
    @EnvironmentObject private var store: AppStore
    @State private var keyword = ""
    @State private var submitted = ""
    @State private var films: [Film] = []
    @State private var warnings: [String] = []
    @State private var loading = false
    @State private var searchNonce = 0
    @FocusState private var searchFocused: Bool
    private var searchIdentity: String { submitted + "|" + store.sourceSignature + "|" + String(searchNonce) }

    var body: some View {
        CinemaPage {
            PageHeading(eyebrow: "幕里 · 发现", title: "寻找想看的故事", subtitle: "从一部片名开始，发现下一段观影时光。")
            HStack(spacing: 10) {
                TextField("输入影片或剧集名称", text: $keyword).platformSearchStyle()
                    .focused($searchFocused).submitLabel(.search).onSubmit(submit)
                Button(action: submit) { Image(systemName: "magnifyingglass").frame(minWidth: 20, minHeight: 20) }
                    .buttonStyle(CinemaPillStyle(primary: true))
                    .disabled(keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("搜索片名")
            }
            if loading {
                HStack(spacing: 12) { ProgressView(); Text("正在搜索 \(store.activeSources.count) 个来源…").font(.caption).foregroundStyle(Cinema.muted) }
            }
            WarningView(messages: warnings)
            if !submitted.isEmpty && !loading {
                HStack { Text("“\(submitted)”").font(.title3.weight(.semibold)); Spacer(); Text("\(films.count) 个结果").font(.caption).foregroundStyle(Cinema.faint) }
            }
            if films.isEmpty {
                EmptyState(icon: "magnifyingglass", title: submitted.isEmpty ? "故事等你发现" : loading ? "正在搜索" : "未找到相关影片", message: submitted.isEmpty ? "搜索会聚合已启用的来源。" : "可换一个关键词，或在设置中调整来源后重试。")
            } else { FilmGrid(films: films) }
        }
        .navigationTitle("片名搜索")
        .navigationDestination(for: Film.self) { DetailView(film: $0) }
        .task(id: searchIdentity) {
            guard !submitted.isEmpty else { return }
            let query = submitted
            let sources = store.activeSources
            loading = true; warnings = []; films = []
            defer { if !Task.isCancelled { loading = false } }
            let results = await store.repository.aggregate(sources, keyword: query)
            guard !Task.isCancelled else { return }
            films = MediaRepository.merge(results, keyword: query)
            warnings = results.compactMap { result in result.error.map { result.source.name + "：" + $0 } }
            if sources.isEmpty { warnings = ["请在设置中启用至少一个点播来源。"] }
        }
    }

    private func submit() {
        let query = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        submitted = query; searchNonce += 1; searchFocused = false
    }
}

struct FilmGrid: View {
    let films: [Film]
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var columns: [GridItem] { [GridItem(.adaptive(minimum: sizeClass == .regular ? 155 : 130, maximum: 215), spacing: 14, alignment: .top)] }
    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 24) {
            ForEach(films) { film in
                NavigationLink(value: film) { FilmCard(film: film) }.buttonStyle(.plain)
            }
        }
    }
}

struct FilmCard: View {
    let film: Film
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Poster(url: film.cover).aspectRatio(5.0 / 7.0, contentMode: .fit)
                .overlay(alignment: .bottomLeading) {
                    Text(film.source.name).font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(.black.opacity(0.65), in: Capsule()).padding(9)
                }
                .clipShape(RoundedRectangle(cornerRadius: 15))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(Cinema.line.opacity(0.4)))
            Text(film.title).font(.subheadline.weight(.medium)).foregroundStyle(Cinema.text).lineLimit(2)
            Text(film.subtitle.isEmpty ? film.source.name : film.subtitle)
                .font(.caption2).foregroundStyle(Cinema.faint).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .topLeading).contentShape(Rectangle())
    }
}

struct Poster: View {
    let url: String
    var body: some View {
        GeometryReader { proxy in
            AsyncImage(url: MediaRepository.httpURL(url)) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else {
                    ZStack {
                        LinearGradient(colors: [Cinema.raised, Cinema.surface], startPoint: .topLeading, endPoint: .bottomTrailing)
                        Image(systemName: "play.rectangle").font(.largeTitle.weight(.ultraLight)).foregroundStyle(Cinema.faint.opacity(0.45))
                    }
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }.accessibilityHidden(true)
    }
}

struct DetailView: View {
    let film: Film
    @EnvironmentObject private var store: AppStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var details: FilmDetails?
    @State private var error: String?
    @State private var selectedLine = ""
    @State private var retry = 0

    var body: some View {
        CinemaPage {
            ZStack(alignment: .bottomLeading) {
                DetailBackdrop(film: film, identity: details?.film.id == film.id ? details?.artworkIdentity : nil)
                LinearGradient(colors: [.clear, Cinema.canvas.opacity(0.6), Cinema.canvas], startPoint: .top, endPoint: .bottom)
                LinearGradient(colors: [.black.opacity(0.4), .clear], startPoint: .leading, endPoint: .trailing)
                detailHeader.padding(sizeClass == .regular ? 36 : 24)
            }
            .frame(height: sizeClass == .regular ? 530 : 460)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            if let details {
                VStack(alignment: .leading, spacing: 15) {
                    Text("剧情简介").font(.title3.weight(.semibold))
                    Text(details.synopsis).font(.subheadline).foregroundStyle(Cinema.muted).lineSpacing(7).platformTextSelection()
                }.frame(maxWidth: .infinity, alignment: .leading).padding(20).cinemaSurface(radius: 19)
                VStack(alignment: .leading, spacing: 18) {
                    HStack { Text("播放选集").font(.title2.weight(.semibold)); Spacer(); Text("\(selectedEpisodes.count) 集").font(.caption).foregroundStyle(Cinema.faint) }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(details.lines, id: \.self) { line in
                                Button { selectedLine = line } label: { CinemaChip(title: line, selected: line == selectedLine) }.buttonStyle(.plain)
                            }
                        }.padding(.vertical, 2)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100, maximum: 170), spacing: 10)], spacing: 10) {
                        ForEach(selectedEpisodes) { episode in
                            Button { store.play(details, episode: episode) } label: {
                                Text(episode.name).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, minHeight: 46)
                                    .padding(.horizontal, 10).cinemaSurface(radius: 12)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            } else if let error {
                EmptyState(icon: "exclamationmark.triangle", title: "详情加载失败", message: error)
                Button("重新加载") { retry += 1 }.buttonStyle(CinemaPillStyle())
            } else {
                ProgressView("正在获取详情与选集…").frame(maxWidth: .infinity).padding(.vertical, 40)
            }
        }
        .navigationTitle("影片详情")
        .task(id: film.id + "|" + String(retry)) {
            error = nil; details = nil; selectedLine = ""
            do {
                let value = try await store.repository.details(film)
                guard !Task.isCancelled else { return }
                details = value; selectedLine = store.preferredLine(for: value)
            } catch { if !Task.isCancelled { self.error = MediaRepository.message(error) } }
        }
    }

    private var selectedEpisodes: [Episode] { details?.episodes.filter { $0.line == selectedLine } ?? [] }
    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(film.title).font(.system(size: sizeClass == .regular ? 48 : 36, weight: .bold)).tracking(-1).lineLimit(3)
            if !film.subtitle.isEmpty { Text(film.subtitle).font(.caption).foregroundStyle(Cinema.muted) }
            Text(film.source.name).font(.caption).foregroundStyle(Cinema.muted)
            if let details, let episode = details.preferredEpisode(line: selectedLine, history: store.historyEntry(for: details.film)) {
                Button { store.play(details, episode: episode) } label: {
                    Label(store.historyEntry(for: details.film)?.playbackLabel(for: episode, film: details.film) ?? "立即播放", systemImage: "play.fill").font(.subheadline.weight(.semibold))
                }
                    .buttonStyle(CinemaPillStyle(primary: true))
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LiveView: View {
    @EnvironmentObject private var store: AppStore
    @State private var query = ""
    @State private var selectedGroup = "全部"
    private var groups: [String] { ["全部"] + Set(store.channels.map(\.group)).sorted() }
    private var filtered: [LiveChannel] {
        store.channels.filter { (selectedGroup == "全部" || $0.group == selectedGroup) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }
    var body: some View {
        CinemaPage {
            PageHeading(eyebrow: "幕里 · 直播", title: "打开电视，遇见此刻。", subtitle: "新闻、纪录片与地方频道，换一种方式享受观影时光。")
            HStack(spacing: 10) {
                TextField("搜索频道", text: $query).platformSearchStyle().submitLabel(.search)
                Button { Task { await store.refreshLive() } } label: { Image(systemName: "arrow.clockwise").frame(minWidth: 20, minHeight: 20) }
                    .buttonStyle(CinemaPillStyle()).disabled(store.liveLoading).accessibilityLabel("更新频道")
            }
            if store.liveLoading { ProgressView("正在更新订阅，内置频道仍可播放…").font(.caption) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(groups, id: \.self) { group in
                        Button { selectedGroup = group } label: { CinemaChip(title: group, selected: group == selectedGroup) }.buttonStyle(.plain)
                    }
                }.padding(.vertical, 2)
            }
            Text("\(filtered.count) 个频道").font(.caption).foregroundStyle(Cinema.faint)
            WarningView(messages: store.liveWarnings)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 270, maximum: 430), spacing: 14)], spacing: 14) {
                ForEach(filtered) { channel in
                    Button { store.play(channel) } label: {
                        HStack(spacing: 15) {
                            Image(systemName: "tv").font(.title2).foregroundStyle(Cinema.muted).frame(width: 40)
                            VStack(alignment: .leading, spacing: 7) {
                                Text(channel.name).font(.subheadline.weight(.semibold)).foregroundStyle(Cinema.text).lineLimit(1)
                                Text(channel.group).font(.caption).foregroundStyle(Cinema.faint)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "play.fill").font(.caption).foregroundStyle(Cinema.faint)
                        }.frame(maxWidth: .infinity, minHeight: 52, alignment: .leading).padding(17).cinemaSurface(radius: 17)
                    }.buttonStyle(.plain)
                }
            }
            if filtered.isEmpty { EmptyState(icon: "tv", title: "没有匹配的频道", message: "请调整分组或关键词。") }
            Text("部分频道需要 IPv6；播放可用性取决于源站和网络。")
                .font(.caption2).foregroundStyle(Cinema.faint)
        }.navigationTitle("电视直播")
    }
}

struct HistoryView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        CinemaPage {
            PageHeading(eyebrow: "幕里 · 你的时光", title: "接着上次的故事", subtitle: "观看进度保存在本机，喜欢的故事随时继续。")
            if store.history.isEmpty { EmptyState(icon: "clock", title: "从一个故事开始", message: "观看后会自动保存进度，下次可以继续播放。") }
            LazyVStack(spacing: 14) {
                ForEach(store.history) { entry in
                    HStack(spacing: 12) {
                        Button { store.playback = entry.resumedRequest } label: {
                            HStack(spacing: 14) {
                                Poster(url: entry.request.film?.cover ?? "").frame(width: 84, height: 70).clipShape(RoundedRectangle(cornerRadius: 11))
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(entry.request.title).font(.subheadline.weight(.semibold)).foregroundStyle(Cinema.text).lineLimit(1)
                                    Text(entry.request.current.name + " · " + entry.positionText).font(.caption2).foregroundStyle(Cinema.faint).lineLimit(1)
                                    if !entry.request.isLive { ProgressView(value: entry.progress).tint(Cinema.text) }
                                }
                                Spacer(minLength: 0)
                            }.padding(13).cinemaSurface(radius: 17)
                        }.buttonStyle(.plain)
                        VStack(spacing: 0) {
                            if let film = entry.request.film {
                                NavigationLink(value: film) { Image(systemName: "info.circle").frame(width: 44, height: 44) }
                                    .accessibilityLabel("查看 " + film.title + " 的详情与线路")
                            }
                            Button(role: .destructive) { store.removeHistory(entry) } label: { Image(systemName: "trash").frame(width: 44, height: 44) }
                                .accessibilityLabel("删除 \(entry.request.title) 的观看记录")
                        }.tint(Cinema.muted)
                    }
                }
            }
        }.navigationTitle("观看历史")
            .navigationDestination(for: Film.self) { DetailView(film: $0) }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var confirmClear = false
    var body: some View {
        Form {
            Section {
                HStack(spacing: 16) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 7) {
                        Text("幕里").font(.title2.weight(.semibold))
                        Text("好故事，随时随地。 · 2.16.12").font(.caption).foregroundStyle(Cinema.muted)
                    }
                }.padding(.vertical, 10)
                Text("影片、直播与海报直接从互联网来源加载；观看历史仅保存在本机。")
                    .font(.caption).foregroundStyle(Cinema.muted)
            }.listRowBackground(Cinema.surface)
            Section("点播来源") {
                ForEach(store.configuration.vodSources) { source in
                    Toggle(isOn: Binding(get: { !store.disabledSources.contains(source.id) }, set: { store.setSource(source, enabled: $0) })) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(source.name).font(.subheadline)
                            Text(URL(string: source.url)?.host ?? "").font(.caption2).foregroundStyle(Cinema.faint)
                        }.padding(.vertical, 3)
                    }
                }
            }.listRowBackground(Cinema.surface)
            Section("高清背景图") {
                ArtworkSettingsControls()
            }.listRowBackground(Cinema.surface)
            Section("播放与记录") {
                Toggle("自动播放下一集", isOn: $store.autoPlayNext)
                Button("清空观看历史", role: .destructive) { confirmClear = true }
            }.listRowBackground(Cinema.surface)
            Section("来源与开源许可") {
                TMDBAttribution()
                NavigationLink("版权声明与数据来源") { LegalView(resource: "NOTICE", title: "版权与数据来源") }
                NavigationLink("GNU AGPL v3 许可证") { LegalView(resource: "LICENSE", title: "开源许可证") }
                Text("第三方源的内容与可用性由各自提供者负责。请仅访问你有权观看的内容。")
                    .font(.caption).foregroundStyle(Cinema.muted)
            }.listRowBackground(Cinema.surface)
        }
        .scrollContentBackground(.hidden).background(Cinema.canvas).tint(Cinema.text)
        .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Cinema.canvas, for: .navigationBar)
        .confirmationDialog("清空本机的全部观看历史？", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("清空历史", role: .destructive) { store.clearHistory() }
        }
    }
}

struct LegalView: View {
    let resource: String
    let title: String
    private var text: String {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "txt"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "无法读取许可文件。" }
        return text
    }
    var body: some View {
        CinemaPage { Text(text).font(.footnote).foregroundStyle(Cinema.muted).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }
            .navigationTitle(title)
    }
}

struct WarningView: View {
    let messages: [String]
    @State private var expanded = false
    var body: some View {
        if !messages.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Button { expanded.toggle() } label: {
                    HStack { Text("来源状态 · \(messages.count) 条提示"); Spacer(); Image(systemName: expanded ? "chevron.up" : "chevron.down") }
                }.buttonStyle(.plain)
                if expanded {
                    ForEach(Array(messages.enumerated()), id: \.offset) { _, message in Text(message).font(.caption).lineSpacing(4) }
                }
            }.font(.caption).foregroundStyle(Cinema.muted).padding(16).cinemaSurface(radius: 14)
        }
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon).font(.system(size: 42, weight: .ultraLight)).foregroundStyle(Cinema.faint)
            Text(title).font(.title3.weight(.semibold)).foregroundStyle(Cinema.text)
            Text(message).font(.subheadline).foregroundStyle(Cinema.muted).multilineTextAlignment(.center).lineSpacing(4)
        }.frame(maxWidth: .infinity).padding(.horizontal, 20).padding(.vertical, 50)
    }
}
#endif
