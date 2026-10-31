'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { SwitchSourceModal } from '@/components/switch-source';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore } from '@/lib/store';
import {
  completeEpisode,
  progressKeyOf,
  saveProgress,
  upsertHistory,
  db,
} from '@/lib/db';
import { cn } from '@/lib/utils';
import { useWatchReturn } from '@/lib/navigation-hooks';

/**
 * 播放页（唯一入口，替代旧版 watch.html → player.html 跳转链）。
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchContent />
    </Suspense>
  );
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = useAppStore();
  const { verified } = useAuth();
  const returnToPrevious = useWatchReturn(searchParams.toString());

  const rawId = searchParams.get('id') || '';
  const legacyDirectUrl = /^https?:\/\//.test(rawId) ? rawId : '';
  const directUrl = searchParams.get('url') || legacyDirectUrl;
  const sourceKey = searchParams.get('source') || (directUrl ? 'direct' : '');
  const vodId = legacyDirectUrl ? '' : rawId;
  const playbackId = vodId || directUrl;
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;

  const [reversed, setReversed] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const lastPosition = useRef({ key: '', position: 0 });

  const source = resolveSource(store, sourceKey, {
    url: searchParams.get('sourceUrl') || undefined,
    detail: searchParams.get('detail') || undefined,
  });

  // 详情查询：无 id（纯直连链接分享）时跳过
  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url, source?.detail],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && vodId && verified),
    staleTime: 5 * 60_000,
  });

  const episodes = useMemo(() => detailQuery.data?.episodes ?? [], [detailQuery.data]);
  const videoTitle = titleParam || detailQuery.data?.videoInfo?.title || '未知视频';

  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const currentUrl = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(Math.max(indexParam, 0), episodes.length - 1);
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) return Math.min(Math.max(indexParam, 0), episodes.length - 1);
    return Math.max(0, indexParam);
  }, [episodes, indexParam]);

  const goEpisode = useCallback(
    (index: number) => {
      if (index < 0 || index >= episodes.length) return;
      if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams, episodes, directUrl]
  );

  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async () => {
    const urlPos = Number(searchParams.get('position'));
    if (searchParams.has('position') && Number.isFinite(urlPos) && urlPos >= 0) return urlPos;
    if (!playbackId) return 0;
    const entry = await db.progress.get(progressKeyOf(sourceKey, playbackId, currentIndex));
    if (entry) return entry.position;
    const history = await db.history.get(`${sourceKey}_${playbackId}`);
    return history?.episodeIndex === currentIndex ? history.playbackPosition : 0;
  }, [searchParams, sourceKey, playbackId, currentIndex]);

  // 真实开始播放后才进入历史，加载失败或仅打开页面不会覆盖原续播集数。
  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (!verified || !Number.isFinite(position) || !Number.isFinite(duration) || position < 1 || duration <= 0) return;
      lastPosition.current = { key: `${sourceKey}:${vodId}:${currentIndex}`, position };
      if (playbackId) {
        saveProgress(sourceKey, playbackId, currentIndex, position, duration).catch(() => {});
        upsertHistory({ sourceKey, sourceUrl: source?.url, vodId: playbackId, directUrl: vodId ? undefined : directUrl, title: videoTitle,
          pic: detailQuery.data?.videoInfo?.cover, episodeIndex: currentIndex,
          totalEpisodes: episodes.length, playbackPosition: position, duration,
          completed: false, timestamp: Date.now() }).catch(() => {});
      }
    },
    [verified, sourceKey, source?.url, vodId, playbackId, directUrl, currentIndex, videoTitle, detailQuery.data?.videoInfo?.cover, episodes.length]
  );

  // 自动连播的 800ms 延迟切集要在卸载时取消，避免离开页面后跳转
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    autoNextTimer.current = null;
  }, [sourceKey, vodId, currentIndex, store.autoplayNext]);

  const handleEnded = useCallback(() => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (playbackId) completeEpisode(sourceKey, playbackId, currentIndex).catch(() => {});
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      autoNextTimer.current = setTimeout(() => goEpisode(currentIndex + 1), 800);
    }
  }, [store.autoplayNext, currentIndex, episodes.length, goEpisode, sourceKey, playbackId]);

  // Alt+Shift+←/→ switches episodes; Alt+←/→ remains browser Back/Forward.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < episodes.length - 1) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, episodes.length, goEpisode]);

  const orderedEpisodes = reversed ? [...episodes].map((_, i) => episodes.length - 1 - i) : episodes.map((_, i) => i);

  if (!verified) {
    return (
      <div className="tv-watch-page tv-watch-fallback min-h-screen">
        <p className="text-faint text-sm">等待访问验证...</p>
      </div>
    );
  }

  if (!source && !directUrl) {
    return (
      <div className="tv-watch-page tv-watch-fallback min-h-screen">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">点播源不存在</h1>
          <p className="text-sm text-muted mb-4">
            该视频来自点播源「{sourceKey}」，但它可能已被删除。请在设置中重新添加后重试。
          </p>
          <button type="button" className="btn-primary" onClick={returnToPrevious}>返回上一页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-watch-page min-h-screen flex flex-col tv-cinema-root">
      <header className="tv-watch-header">
        <div className="tv-watch-header__inner">
          <BackButton onClick={returnToPrevious} />
          <HomeButton />
          <div className="tv-watch-header__title">
            <h1>{videoTitle}</h1>
            <p>
              {source?.name || '直连视频'}
              {episodes.length > 0 && ` · 第 ${currentIndex + 1}/${episodes.length} 集`}
            </p>
          </div>
          <div className="tv-watch-header__actions">
            <button
              className="tv-watch-action"
              aria-label="下载本集"
              disabled={!currentUrl}
              onClick={() => {
                if (!currentUrl) return;
                enqueueDownload({
                  url: currentUrl,
                  // 多集才带集数后缀；单集影片（含电影）文件名就是纯标题
                  title: `${videoTitle}${episodes.length > 1 ? ` 第${currentIndex + 1}集` : ''}`,
                  format: 'MP4',
                });
                // 「已加入下载队列」由 DownloadManager 在真正入队后提示：
                // 这里先提示的话，用户随后取消保存位置会出现「已加入→已取消」的矛盾
              }}
            >
              <Icon name="download" className="w-4 h-4" /><span className="hidden sm:inline">下载本集</span>
            </button>
            <button className="tv-watch-action" aria-label="切换资源" onClick={() => setSwitchOpen(true)}>
              <Icon name="refresh" className="w-4 h-4" /><span className="hidden sm:inline">切换资源</span>
            </button>
          </div>
        </div>
      </header>

      <main className="tv-watch-shell flex-1 mx-auto">
        <div className="tv-watch-layout">
          <div className="tv-watch-screen">
            <div className="tv-watch-stage aspect-video bg-black">
              {currentUrl ? (
                <PlayerShell
                  url={currentUrl}
                  title={videoTitle}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  episodeKey={`${sourceKey}:${playbackId}:${currentIndex}`}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={handleProgress}
                  onPause={handleProgress}
                  onEnded={handleEnded}
                  onRequestSwitchSource={() => setSwitchOpen(true)}
                  items={episodes.map((_, index) => `第 ${index + 1} 集`)}
                  currentItem={currentIndex}
                  onSelectItem={goEpisode}
                  onNext={currentIndex + 1 < episodes.length ? () => goEpisode(currentIndex + 1) : undefined}
                  onBack={returnToPrevious}
                  onAutoplayChange={(enabled) => store.updateSettings({ autoplayNext: enabled })}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {detailQuery.isLoading ? (
                    <Spinner size="lg" />
                  ) : (
                    <p className="text-faint text-sm">
                      {detailQuery.isError ? '视频加载失败，请重试或切换资源' : '无可用播放地址'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 操作栏 */}
            <div className="tv-watch-transport">
              <button
                className="tv-watch-action"
                disabled={episodes.length === 0 || currentIndex <= 0}
                onClick={() => goEpisode(currentIndex - 1)}
              >
                上一集
              </button>
              <button
                className="tv-watch-action"
                disabled={episodes.length === 0 || currentIndex >= episodes.length - 1}
                onClick={() => goEpisode(currentIndex + 1)}
              >
                下一集
              </button>
              <label className="tv-watch-autoplay">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-current"
                  checked={store.autoplayNext}
                  onChange={(e) => store.updateSettings({ autoplayNext: e.target.checked })}
                />
                自动连播
              </label>
            </div>
          </div>

          {/* 剧集侧栏 */}
          <aside className="tv-watch-episodes" aria-label="剧集列表">
            <div className="tv-watch-episodes__header">
              <h2>
                剧集列表{episodes.length > 0 && `（${episodes.length}）`}
              </h2>
              {/* 排列开关紧贴它所作用的列表：放在这里才看得出它管的是这一栏的顺序 */}
              {episodes.length > 1 && (
                <button
                  className="tv-watch-action tv-watch-action--sort"
                  onClick={() => setReversed((v) => !v)}
                  aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                  title="调整剧集列表的排列顺序"
                >
                  <Icon
                    name="arrowDown"
                    className={cn('w-3.5 h-3.5 transition-transform', reversed && 'rotate-180')}
                  />
                  {reversed ? '正序排列' : '倒序排列'}
                </button>
              )}
            </div>
            {episodes.length === 0 ? (
              detailQuery.isLoading ? (
                <LoadingState />
              ) : (
                <div>
                  <EmptyState variant="plain" title={detailQuery.isError ? '获取剧集失败' : '暂无剧集信息'} />
                  {detailQuery.isError && <button type="button" className="tv-watch-action" onClick={() => void detailQuery.refetch()}>重试加载</button>}
                </div>
              )
            ) : (
              <div className="tv-watch-episodes__grid scrollbar-thin">
                {orderedEpisodes.map((realIndex) => (
                  <EpisodeButton
                    key={realIndex}
                    index={realIndex}
                    active={realIndex === currentIndex}
                    onClick={() => goEpisode(realIndex)}
                  />
                ))}
              </div>
            )}
            <p className="tv-watch-episodes__hint">
              快捷键：空格 播放/暂停 · ←/→ 快退/快进 5s · ↑/↓ 音量 · F 全屏 · Alt+Shift+←/→ 切换集数
            </p>
          </aside>
        </div>
      </main>

      {switchOpen && (
        <SwitchSourceModal
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          currentYear={detailQuery.data?.videoInfo?.year}
          getCurrentPosition={() => lastPosition.current.key === `${sourceKey}:${vodId}:${currentIndex}` ? lastPosition.current.position : 0}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}

/** 集数按钮：激活时自动滚动进可视区（长剧列表） */
function EpisodeButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      className={cn('tv-watch-episode', active && 'episode-active')}
      onClick={onClick}
    >
      {index + 1}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="tv-watch-action tv-watch-action--icon"
      onClick={onClick}
      aria-label="返回"
      title="返回上一页"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

/** 首页按钮：直达首页，避免从外链进入时逐级 back */
function HomeButton() {
  return (
    <Link
      href="/"
      className="tv-watch-action tv-watch-action--icon"
      aria-label="回首页"
      title="回首页"
    >
      <Icon name="home" className="w-5 h-5" />
    </Link>
  );
}
