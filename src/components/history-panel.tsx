'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { NavigationWatchLink } from './navigation-watch-link';
import { readNavigationLayer, updateNavigationLayerUi } from '@/lib/navigation';
import { useNavigationLayer, useNavigationScrollRestoration } from '@/lib/navigation-hooks';
import { Drawer } from './drawer';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState, LoadingState } from './states';
import { Icon } from './icon';
import { SmartImage } from './smart-image';
import {
  db,
  clearAllHistory,
  removeHistory,
  upsertHistory,
  MAX_HISTORY,
  type HistoryEntry,
} from '@/lib/db';
import { buildWatchUrl, cn, formatRelativeTime, formatTime } from '@/lib/utils';
import { useToast } from './toast';
import { resolveSource, useAppStore } from '@/lib/store';
import { detailPlaybackAction } from '@/lib/detail-playback';

/**
 * 观看历史面板（IndexedDB 实时查询）。
 * 与旧版的区别：播放前按需重新拉取剧集详情，不再依赖历史记录里冗余存储的全集 URL。
 * 破坏性操作分级：清空全部走确认弹窗，删除单条支持撤销。
 */

/** 未搜索时列表默认展示的条数（DB 实存 MAX_HISTORY 条，其余靠搜索查阅） */
const VISIBLE_LIMIT = 50;

export function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 全量读取（上限即 DB 淘汰上限）：默认只渲染最近若干条，搜索时覆盖更早的记录
  const history = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(MAX_HISTORY).toArray(),
    [open]
  );
  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState('');
  const { layer, open: openHistory, close: closeHistory } = useNavigationLayer<Record<string, never>>('history');
  const hadLayer = useRef(false);
  useNavigationScrollRestoration();

  useEffect(() => {
    if (open && !readNavigationLayer('history')) openHistory({});
  }, [open, openHistory]);
  useEffect(() => {
    if (layer) {
      hadLayer.current = true;
      setQuery(typeof layer.ui?.query === 'string' ? layer.ui.query : '');
    } else if (hadLayer.current) {
      hadLayer.current = false;
      setQuery('');
      setConfirmClear(false);
      onClose();
    }
  }, [layer, onClose]);
  const close = useCallback(() => {
    setConfirmClear(false);
    closeHistory();
    onClose();
  }, [closeHistory, onClose]);
  const changeQuery = (value: string) => {
    setQuery(value);
    updateNavigationLayerUi('history', { query: value });
  };

  const keyword = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = history ?? [];
    if (!keyword) return all.slice(0, VISIBLE_LIMIT);
    return all.filter((h) => h.title.toLowerCase().includes(keyword));
  }, [history, keyword]);

  const total = history?.length ?? 0;

  return (
    <Drawer
      open={Boolean(layer)}
      onClose={close}
      title="资料库"
      width="max-w-xl"
      // 搜索框放在固定副标题栏：历史较长时滚动列表仍可随时改关键字
      subheader={
        <div className="tv-history__toolbar space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-muted">观看历史</p>
            {history && <span className="text-xs text-faint">{total} 条记录</span>}
          </div>
          {total > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                />
                <input
                  type="text"
                  className="h-11 w-full rounded-2xl border border-line/70 bg-chip/70 pl-10 pr-10 text-sm text-content placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/50"
                  placeholder="搜索观看历史..."
                  value={query}
                  onChange={(e) => changeQuery(e.target.value)}
                  aria-label="搜索观看历史"
                />
                {query && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-faint transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60"
                    onClick={() => changeQuery('')}
                    aria-label="清空搜索"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-3 text-xs font-medium text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60"
                onClick={() => setConfirmClear(true)}
              >
                清空历史
              </button>
            </div>
          )}
        </div>
      }
    >
      {!history ? (
        <LoadingState />
      ) : total === 0 ? (
        <EmptyState variant="plain" title="暂无观看记录" />
      ) : visible.length === 0 ? (
        <EmptyState variant="plain" title={`没有匹配「${query.trim()}」的观看记录`} />
      ) : (
        <>
          {!keyword && total > VISIBLE_LIMIT && (
            <p className="mb-4 text-xs leading-relaxed text-faint">
              共 {total} 条记录，仅显示最近 {VISIBLE_LIMIT} 条，可用上方搜索查找更早的记录
            </p>
          )}
          <ul className="tv-history__list space-y-3">
            {visible.map((item) => (
              <HistoryItem key={`${item.sourceKey}_${item.vodId}`} item={item} />
            ))}
          </ul>
        </>
      )}

      {/* 重操作：清空不可撤销，先确认并说明数量 */}
      <ConfirmDialog
        open={confirmClear}
        danger
        title="清空全部观看历史？"
        message={history ? `将删除 ${history.length} 条观看记录，此操作不可撤销。` : undefined}
        confirmLabel="清空"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          void clearAllHistory().then(() => toast('观看历史已清空', 'success')).catch(() => toast('清空失败，请重试', 'error'));
          setConfirmClear(false);
        }}
      />
    </Drawer>
  );
}

function HistoryItem({ item }: { item: HistoryEntry }) {
  // 精确订阅：整份 useAppStore() 会让每条历史在任意 store 变化（搜索健康度、测活写回等）时重渲染
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const { toast } = useToast();
  const [imgFailed, setImgFailed] = useState(false);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey, { url: item.sourceUrl });

  const hasPercent =
    item.playbackPosition > 10 && item.duration > 0 && item.playbackPosition < item.duration * 0.95;
  const percent = hasPercent ? Math.round((item.playbackPosition / item.duration) * 100) : 0;

  const playback = detailPlaybackAction(item, item.totalEpisodes);
  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.directUrl ? undefined : item.vodId,
    episodeUrl: item.directUrl,
    index: playback.index,
    position: playback.restart ? 0 : undefined,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });

  const remove = () => {
    void removeHistory(item.sourceKey, item.vodId).then(() => {
      // 轻操作：给撤销窗口，恢复时写回原记录
      toast('已删除该记录', 'info', {
        action: {
          label: '撤销',
          onClick: () => {
            void upsertHistory({
              sourceKey: item.sourceKey,
              sourceUrl: item.sourceUrl,
              vodId: item.vodId,
              directUrl: item.directUrl,
              title: item.title,
              pic: item.pic,
              episodeIndex: item.episodeIndex,
              totalEpisodes: item.totalEpisodes,
              playbackPosition: item.playbackPosition,
              duration: item.duration,
              completed: item.completed,
              timestamp: item.timestamp,
            }).then(() => toast('已恢复', 'success'));
          },
        },
      });
    });
  };

  return (
    <li className="tv-history__item group relative">
      <NavigationWatchLink
        href={href}
        className="block rounded-2xl border border-line/60 bg-card/70 p-3.5 pr-12 transition-colors hover:border-content/20 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <div className="flex items-center gap-3.5">
          {item.pic && !imgFailed ? (
            <SmartImage
              url={item.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt=""
              className="h-20 w-14 shrink-0 rounded-xl bg-chip object-cover shadow-md shadow-black/10"
              onExhausted={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-xl bg-chip">
              <svg className="h-5 w-5 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M7 4v16m10-16v16M7 8h10M7 12h10" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold tracking-tight text-content">{item.title}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-5 text-faint">
              {item.totalEpisodes > 0 && <span>第 {item.episodeIndex + 1}/{item.totalEpisodes} 集</span>}
              {hasPercent && <span>· {formatTime(item.playbackPosition)}</span>}
              <span>· {formatRelativeTime(item.timestamp)}</span>
            </div>
            {hasPercent && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        </div>
      </NavigationWatchLink>
      <button
        type="button"
        className={cn(
          'absolute right-2.5 top-2.5 inline-flex h-9 w-9 items-center justify-center rounded-full text-faint hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60',
          'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
        aria-label={`删除《${item.title}》的观看记录`}
        title="删除记录（可在提示中撤销）"
        onClick={remove}
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
    </li>
  );
}
