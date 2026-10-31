'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { BUILTIN_LIVE_SOURCES } from '@/lib/default-live-sources';
import { channelHasUrl, isLiveFavorite, mergeLiveChannels, selectLiveLine, type LiveChannelLine } from '@/lib/live-channels';
import { api } from '@/lib/client-api';
import { copyToClipboard } from '@/lib/clipboard';
import { Header } from '@/components/header';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
import dynamic from 'next/dynamic';
const LivePlayer = dynamic(() => import('@/components/live-player').then((m) => m.LivePlayer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center rounded-3xl bg-black">
      <Spinner size="lg" />
    </div>
  ),
});
import { LiveChannelList, type LiveChannelItem } from '@/components/live-channel-list';
import { LiveEpgPanel } from '@/components/live-epg-panel';
import { Spinner } from '@/components/states';
import { useAuth } from '@/components/auth';
import { allLiveSources, useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from '@/components/smart-image';

/**
 * 直播页：左侧播放器 + 频道信息 + 节目单；右侧频道侧栏。
 * 状态由 URL 驱动（?url=&name=&group=&tvgId=&epg=），支持频道深链与刷新保持。
 * 换台路径：侧栏点击、全局 ↑↓ 键盘、播放器控制条上一台/下一台（全屏可用）。
 * 移动端侧栏为底部抽屉（右下角 FAB 呼出，选中频道后自动收起）。
 */
export default function LivePage() {
  return (
    <Suspense>
      <LiveContent />
    </Suspense>
  );
}

function LiveContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // 精确订阅所需字段：任何其他 store 变化（如测活写回）不应触发本组件重渲染
  const liveSelectedUrls = useAppStore((s) => s.liveSelectedUrls);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const { verified } = useAuth();
  const [copied, setCopied] = useState(false);
  // 移动端频道抽屉开合
  const [listOpen, setListOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  /** 侧栏上报的筛选排序结果（键盘换台沿此列表顺序）；ref 存储，不触发重渲染 */
  const filteredRef = useRef<LiveChannelItem[]>([]);
  /** 当前频道镜像：selectChannel 内读取最近一次播放的频道，用于记录"上一个频道" */
  const currentChannelRef = useRef<LiveChannelItem | undefined>(undefined);
  /** 上一个频道：退格键/按钮一键切回（电视遥控器 back 键习惯） */
  const lastChannelRef = useRef<LiveChannelItem | null>(null);

  const forceRefreshRef = useRef(false);
  // 精选频道优先；同 URL 订阅只请求一次。
  const sources = useMemo(() => {
    const selected = new Set(liveSelectedUrls);
    const unique = [...new Map(allLiveSources({ liveEnvSources, liveSubscriptions })
      .filter((source) => selected.has(source.url)).map((source) => [source.url, source])).values()];
    const priority = new Map(BUILTIN_LIVE_SOURCES.map((source, i) => [source.url, i]));
    return unique.sort((a, b) => (priority.get(a.url) ?? 100) - (priority.get(b.url) ?? 100));
  }, [liveSelectedUrls, liveEnvSources, liveSubscriptions]);

  const playlistQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: ['livePlaylist', source.url],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.livePlaylist(source.url, forceRefreshRef.current, signal),
      enabled: verified,
      staleTime: 10 * 60_000,
      refetchInterval: 10 * 60_000,
      retry: 1,
    })),
  });
  const isLoading = playlistQueries.some((query) => query.isPending);
  const isRefreshing = playlistQueries.some((query) => query.isFetching);
  const failedSources = sources.filter((_, i) => playlistQueries[i].isError);
  const failedCount = failedSources.length;
  const lines: LiveChannelLine[] = playlistQueries.flatMap((query, i) =>
    (query.data?.channels ?? []).map((channel) => ({
      ...channel,
      epg: sources[i].epg || query.data?.epg,
      sourceUrl: sources[i].url,
      sourceName: sources[i].name,
    }))
  );
  const channels = mergeLiveChannels(lines);
  const groups = [...new Set(channels.map((channel) => channel.group).filter((group): group is string => Boolean(group)))].sort(
    (a, b) => a.localeCompare(b, 'zh')
  );
  const refreshPlaylists = async () => {
    forceRefreshRef.current = true;
    try {
      await Promise.all(playlistQueries.map((query) => query.refetch()));
    } finally {
      forceRefreshRef.current = false;
    }
  };

  // 当前频道：优先取列表内完整对象（含台标），否则由 URL 参数重建
  const currentUrl = searchParams.get('url') || '';
  const currentChannel = useMemo(() => {
    const found = channels.find((channel) => channelHasUrl(channel, currentUrl));
    if (found) return selectLiveLine(found, currentUrl);
    if (!currentUrl) return undefined;
    return mergeLiveChannels([{
      id: searchParams.get('tvgId') || currentUrl,
      url: currentUrl,
      name: searchParams.get('name') || '未知频道',
      group: searchParams.get('group') || undefined,
      tvgId: searchParams.get('tvgId') || undefined,
      epg: searchParams.get('epg') || undefined,
      sourceUrl: searchParams.get('source') || undefined,
    }])[0];
  }, [channels, currentUrl, searchParams]);

  useEffect(() => {
    setLogoFailed(false);
  }, [currentChannel?.url]);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const selectChannel = useCallback(
    (c: LiveChannelItem) => {
      const cur = currentChannelRef.current;
      if (cur && cur.channelKey !== c.channelKey) lastChannelRef.current = cur;
      const sp = new URLSearchParams({ url: c.url, name: c.name });
      if (c.group) sp.set('group', c.group);
      if (c.tvgId) sp.set('tvgId', c.tvgId);
      if (c.epg) sp.set('epg', c.epg);
      if (c.sourceUrl) sp.set('source', c.sourceUrl);
      router.replace(`/live?${sp.toString()}`, { scroll: false });
      useAppStore.getState().addLiveRecent({
        channelKey: c.channelKey,
        url: c.url,
        name: c.name,
        logo: c.logo,
        group: c.group,
        tvgId: c.tvgId,
        epg: c.epg,
        sourceUrl: c.sourceUrl,
      });
    },
    [router]
  );

  const switchNextLine = useCallback(() => {
    const channel = currentChannelRef.current;
    if (!channel || channel.lines.length < 2) return;
    const index = channel.lines.findIndex((line) => line.url === channel.url);
    selectChannel(selectLiveLine(channel, channel.lines[(index + 1) % channel.lines.length].url));
  }, [selectChannel]);

  const handleFilteredChange = useCallback((list: LiveChannelItem[]) => {
    filteredRef.current = list;
  }, []);

  /** 沿侧栏当前筛选排序的列表顺序切上一台/下一台（循环） */
  const switchChannelByOffset = useCallback(
    (delta: 1 | -1) => {
      const list = filteredRef.current;
      if (list.length === 0) return;
      const nowUrl = new URLSearchParams(window.location.search).get('url') || '';
      const idx = list.findIndex((c) => channelHasUrl(c, nowUrl));
      const next =
        idx === -1 ? (delta === 1 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
      selectChannel(list[next]);
    },
    [selectChannel]
  );

  const goPrevChannel = useCallback(() => switchChannelByOffset(-1), [switchChannelByOffset]);
  const goNextChannel = useCallback(() => switchChannelByOffset(1), [switchChannelByOffset]);

  /** 切回上一个频道（Backspace / 信息条按钮） */
  const backToPrevChannel = useCallback(() => {
    const prev = lastChannelRef.current;
    if (!prev) return;
    lastChannelRef.current = null;
    selectChannel(prev);
  }, [selectChannel]);

  // 全局键盘：↑↓ 直接切台，Backspace 切回上一个频道。
  // 输入框/列表光标导航场景让位（列表聚焦时由列表内 ↑↓ 管理光标）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isChannelKey = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Backspace';
      if (!isChannelKey) return;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.closest('[data-channel-list], [data-player-ui]')) return;
      }
      e.preventDefault();
      if (e.key === 'Backspace') backToPrevChannel();
      else switchChannelByOffset(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switchChannelByOffset, backToPrevChannel]);

  const handleSelect = useCallback(
    (c: LiveChannelItem) => {
      selectChannel(c);
      // 移动端抽屉：选中即收起
      setListOpen(false);
    },
    [selectChannel]
  );

  if (!verified) {
    return (
      <div className="tv-live-page min-h-screen min-w-0 bg-page text-content flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-faint text-sm">等待访问验证...</p>
        </div>
      </div>
    );
  }

  const logo = currentChannel?.logo;
  const isFavorite = currentChannel ? isLiveFavorite(currentChannel, new Set(liveFavorites)) : false;

  return (
    <div className="tv-live-page min-h-screen min-w-0 bg-page text-content flex flex-col">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1 w-full min-w-0 max-w-[1536px] mx-auto px-4 pb-24 pt-8 sm:px-8 sm:pt-10 lg:pb-12 lg:pt-12">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4 sm:mb-9">
          <div className="min-w-0">
            <h1 className="text-[32px] font-semibold tracking-tight leading-tight sm:text-4xl">TV 直播</h1>
            <p className="mt-2 text-sm text-muted sm:text-[15px]">好节目，正在发生。</p>
            <p className="mt-2 text-xs text-faint" aria-live="polite">
              {channels.length} 个频道 · {channels.reduce((count, channel) => count + channel.lines.length, 0)} 条线路
              {isRefreshing ? ' · 正在更新频道…' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-sm !rounded-full" disabled={isRefreshing || sources.length === 0} onClick={() => void refreshPlaylists()}>
              {isRefreshing ? '更新中…' : '刷新频道'}
            </button>
            <button className="btn-ghost btn-sm !rounded-full" onClick={() => window.dispatchEvent(new CustomEvent('kongwotv:open-settings', { detail: { section: 'live' } }))}>
              管理直播源
            </button>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_352px] xl:gap-8">
          {/* 主栏：播放器 + 信息条 + 节目单 */}
          <div className="min-w-0">
            <div className="aspect-video w-full overflow-hidden rounded-3xl bg-black shadow-[0_16px_48px_rgba(0,0,0,0.18)] ring-1 ring-line/60">
              {currentUrl ? (
                <LivePlayer
                  url={currentUrl}
                  title={currentChannel?.name || '直播'}
                  onPrevChannel={channels.length > 1 ? goPrevChannel : undefined}
                  onNextChannel={channels.length > 1 ? goNextChannel : undefined}
                  onNextLine={currentChannel && currentChannel.lines.length > 1 ? switchNextLine : undefined}
                  items={channels.map((channel) => channel.name)}
                  currentItem={channels.findIndex((channel) => channelHasUrl(channel, currentUrl))}
                  onSelectItem={(index) => { if (channels[index]) handleSelect(channels[index]); }}
                  onBack={() => router.push('/')}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-black">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    LIVE
                  </span>
                  <p className="max-w-sm px-6 text-center text-sm leading-relaxed text-white/55">
                    {sources.length === 0
                      ? liveEnvSources.length + liveSubscriptions.length > 0
                        ? '所有直播源均已停用，请在设置中勾选启用'
                        : '请先在设置中添加直播源（M3U 订阅）'
                      : isLoading
                        ? '频道列表加载中...'
                        : '选择一个频道，开始观看'}
                  </p>
                </div>
              )}
            </div>

            {/* 频道信息条 */}
            {currentChannel && (
              <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3 rounded-3xl border border-line/60 bg-surface p-4 sm:gap-4 sm:p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-chip p-1.5">
                  {logo && !logoFailed ? (
                    <SmartImage
                      url={logo}
                      mode={imageProxyMode}
                      customProxy={customImageProxy}
                      alt=""
                      className="w-full h-full object-contain"
                      onExhausted={() => setLogoFailed(true)}
                    />
                  ) : (
                    <span className="text-xs text-faint">{currentChannel.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h2 className="max-w-full truncate text-lg font-semibold tracking-tight text-content sm:text-xl">{currentChannel.name}</h2>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-semibold tracking-[0.14em] text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      LIVE
                    </span>
                    {currentChannel.group && (
                      <span className="max-w-full truncate rounded-full bg-chip px-2.5 py-1 text-[10px] text-muted">{currentChannel.group}</span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-faint">
                    {currentChannel.sourceName || '自定义直播源'} · 线路 {Math.max(1, currentChannel.lines.findIndex((line) => line.url === currentChannel.url) + 1)}
                  </p>
                </div>
                <div className="flex w-full shrink-0 items-center justify-end gap-1 border-t border-line/60 pt-3 sm:w-auto sm:border-0 sm:pt-0">
                  <button
                    className={cn(
                      'rounded-full p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      lastChannelRef.current
                        ? 'text-muted hover:text-content hover:bg-hover'
                        : 'text-faint/40 cursor-default'
                    )}
                    aria-label="上一个频道"
                    title={lastChannelRef.current ? `上一个频道：${lastChannelRef.current.name}（Backspace）` : '暂无上一个频道'}
                    onClick={backToPrevChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 15L4 10l5-5m-5 5h10.5a5.5 5.5 0 015.5 5.5V17"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-full p-2.5 text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label="上一台"
                    title="上一台（↑）"
                    onClick={goPrevChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-full p-2.5 text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label="下一台"
                    title="下一台（↓）"
                    onClick={goNextChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                  <button
                    className={cn(
                      'rounded-full p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      isFavorite ? 'text-warning' : 'text-muted hover:text-warning hover:bg-hover'
                    )}
                    aria-label={isFavorite ? '取消收藏' : '收藏'}
                    title={isFavorite ? '取消收藏' : '收藏'}
                    onClick={() => useAppStore.getState().toggleLiveFavorite(currentChannel.channelKey, currentChannel.lines.map((line) => line.url))}
                  >
                    <svg
                      className="w-4 h-4"
                      fill={isFavorite ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-full p-2.5 text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label="复制播放地址"
                    title="复制播放地址"
                    onClick={async () => {
                      const ok = await copyToClipboard(currentChannel.url);
                      if (ok) {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }
                    }}
                  >
                    {copied ? (
                      <span className="text-[10px] text-success">已复制</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {currentChannel && (
              <section className="mt-5 min-w-0 rounded-3xl border border-line/60 bg-surface p-4 sm:p-5" aria-label="播放线路">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-content">播放线路 <span className="ml-1 text-xs font-normal text-faint">{currentChannel.lines.length} 条</span></h2>
                  <p className="text-[11px] text-faint">卡顿或加载失败时，可尝试其他线路</p>
                </div>
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                  {currentChannel.lines.map((line, index) => (
                    <button
                      key={line.url}
                      type="button"
                      aria-pressed={line.url === currentUrl}
                      aria-label={`线路 ${index + 1} · ${line.sourceName || '自定义源'}`}
                      title={line.rawName || line.name}
                      className={cn('max-w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        line.url === currentUrl ? 'border-accent bg-accent text-on-accent' : 'border-line/60 bg-chip text-muted hover:bg-hover hover:text-content')}
                      onClick={() => selectChannel(selectLiveLine(currentChannel, line.url))}
                    >
                      <span className="block truncate">线路 {index + 1}</span>
                      <span className={cn('mt-1 block max-w-44 truncate text-[10px]', line.url === currentUrl ? 'text-on-accent/70' : 'text-faint')}>
                        {line.sourceName || '自定义源'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 节目单 */}
            {currentChannel && (
              <section className="mt-7 min-w-0 rounded-3xl border border-line/60 bg-surface p-4 sm:p-6">
                <h2 className="mb-5 text-lg font-semibold tracking-tight text-content">节目单</h2>
                <LiveEpgPanel epgUrl={currentChannel.epg} tvgId={currentChannel.tvgId} />
              </section>
            )}
          </div>

          {/* 移动端抽屉遮罩 */}
          {listOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
              onClick={() => setListOpen(false)}
            />
          )}

          {/* 侧栏：桌面常驻 sticky；移动端底部抽屉 */}
          <aside
            className={cn(
              'min-w-0 flex flex-col overflow-hidden border border-line/60 bg-surface',
              listOpen
                ? 'fixed inset-x-2 bottom-2 z-40 h-[78dvh] rounded-3xl shadow-2xl'
                : 'relative h-[min(680px,78dvh)] rounded-3xl',
              'lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-28 lg:z-auto lg:h-[calc(100dvh-9rem)] lg:min-h-[520px] lg:max-h-[880px] lg:rounded-3xl lg:shadow-none'
            )}
          >
            {/* 抽屉把手栏（仅移动端） */}
            <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-5 lg:hidden">
              <span className="text-base font-semibold tracking-tight text-content">频道列表</span>
              <button
                className={cn("rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-content", !listOpen && "hidden")}
                aria-label="关闭频道列表"
                onClick={() => setListOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {isLoading && channels.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <Spinner size="lg" />
                </div>
              ) : (
                <LiveChannelList
                  channels={channels}
                  groups={groups}
                  currentUrl={currentUrl}
                  onSelect={handleSelect}
                  onFilteredChange={handleFilteredChange}
                />
              )}
              {(failedCount > 0 || sources.length === 0 || (channels.length === 0 && !isLoading)) && (
                <p className="shrink-0 border-t border-line/60 px-5 py-3 text-[10px] leading-relaxed text-faint">
                  {sources.length === 0
                    ? liveEnvSources.length + liveSubscriptions.length > 0
                      ? '所有直播源均已停用，请在设置中勾选启用'
                      : '暂无直播源，请在设置 → 直播源中添加'
                    : failedCount > 0
                      ? `加载失败：${failedSources.map((source) => source.name).join('、')}。可刷新重试或在管理中检查源地址。`
                      : '直播源未返回频道，可刷新重试或在管理中更换源。'}
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* 移动端呼出频道列表的悬浮按钮 */}
        {!listOpen && channels.length > 0 && (
          <button
            className="fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-on-accent shadow-[0_8px_28px_rgba(0,0,0,0.24)] transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:hidden"
            onClick={() => setListOpen(true)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            频道
          </button>
        )}
      </main>
    </div>
  );
}
