'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { Dropdown } from './dropdown';
import { useAppStore } from '@/lib/store';
import {
  isSlowSource,
  matchesAlive,
  matchesKeyword,
  normalizeForSearch,
  probeRank,
  sortChannels,
  type AliveFilter,
  type LiveSortMode,
} from '@/lib/live-channel-filter';
import { useLiveProbe, type ProbeResult } from './use-live-probe';
import { EmptyState } from './states';
import { channelHasUrl, findRecentChannel, isLiveFavorite, type LiveChannelItem } from '@/lib/live-channels';
export type { LiveChannelItem } from '@/lib/live-channels';

/**
 * 直播频道侧栏：全部/收藏/最近三个视图 + 分组横向标签条 + 关键字搜索 + 排序。
 * - 搜索对分隔符归一化（cctv1 命中 CCTV-1），并匹配分组名；输入防抖后过滤；
 * - 可用性两档筛选（绿点=分片级验证 / 可播=含弱验证）；
 * - 支持批量测活：频道名前显示可达性状态点；
 * - 虚拟列表（@tanstack/react-virtual）：仅渲染可视区内的频道行，数千频道下 DOM 恒定，
 *   电视盒子 / 低端设备滑动不掉帧；行高动态测量（有无分组名两档）；
 * - 键盘：容器聚焦后 ↑↓ 移动光标、Enter 播放；
 * - 性能：本组件与 ChannelRow 均精确订阅 store，探测节流写回不会全列表重渲染。
 */

const SEARCH_DEBOUNCE_MS = 200;

/** 测活进度文案：按已完成均速估算剩余时间（长尾在途期间由每秒 tick 重渲染保持走动） */
function formatProbeProgress(p: { done: number; total: number; startedAt: number }): string {
  const base = `${p.done}/${p.total}`;
  const remaining = p.total - p.done;
  if (remaining <= 0) return base;
  if (p.done <= 0) return `${base} · 估算中…`;
  const remainMin = Math.ceil(((Date.now() - p.startedAt) / p.done) * remaining / 60000);
  return `${base} · 预计剩余 ${Math.max(1, remainMin)} 分钟`;
}

interface ChannelListProps {
  channels: LiveChannelItem[];
  groups: string[];
  currentUrl: string;
  onSelect: (channel: LiveChannelItem) => void;
  /** 筛选+排序结果变化时上报（页面级键盘换台沿此列表顺序切换） */
  onFilteredChange?: (list: LiveChannelItem[]) => void;
}

type View = 'all' | 'fav' | 'recent';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function LiveChannelList({ channels, groups, currentUrl, onSelect, onFilteredChange }: ChannelListProps) {
  // 精确订阅：避免任何 store 字段变化（尤其测活节流写回）引发本组件重渲染
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const liveRecent = useAppStore((s) => s.liveRecent);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  const [view, setView] = useState<View>('all');
  const [group, setGroup] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebouncedValue(keyword, SEARCH_DEBOUNCE_MS);
  const [sortMode, setSortMode] = useState<LiveSortMode>('default');
  const [aliveFilter, setAliveFilter] = useState<AliveFilter>('off');
  /** 键盘光标（filtered 的下标），与"正在播放"高亮独立 */
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const {
    results: probeResults,
    progress: probeProgress,
    probe,
    cancel: cancelProbe,
    clear: clearProbe,
    isProbing,
    hint: probeHint,
  } = useLiveProbe();

  // 测活 ETA 每秒刷新：探测长尾（在途请求未返回）期间进度不推进，剩余时间也要走动
  const [, setProbeTick] = useState(0);
  useEffect(() => {
    if (!isProbing) return;
    const timer = setInterval(() => setProbeTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isProbing]);

  const favSet = useMemo(() => new Set(liveFavorites), [liveFavorites]);
  const recentChannels = useMemo(() => {
    const seen = new Set<string>();
    return liveRecent.flatMap((recent) => {
      const channel = findRecentChannel(channels, recent);
      if (!channel || seen.has(channel.channelKey)) return [];
      seen.add(channel.channelKey);
      return [channel];
    });
  }, [channels, liveRecent]);
  const recentOrder = useMemo(() => {
    const order = new Map(recentChannels.map((channel, i) => [channel.channelKey, i]));
    return new Map(channels.map((channel) => [channel.url, order.get(channel.channelKey) ?? Infinity]));
  }, [channels, recentChannels]);
  const favoriteCount = useMemo(() => channels.filter((channel) => isLiveFavorite(channel, favSet)).length, [channels, favSet]);
  const normalizedKeyword = useMemo(() => normalizeForSearch(debouncedKeyword.trim()), [debouncedKeyword]);
  // 任一线路通过即可让频道进入可用列表；测活本身仍逐条检查各线路。
  const channelProbes = useMemo(() => {
    const grouped = new Map<string, ProbeResult>();
    for (const channel of channels) {
      let best: ProbeResult | undefined;
      for (const line of channel.lines) {
        const probe = probeResults.get(line.url);
        if (probe && (!best || probeRank(probe) < probeRank(best) ||
          (probeRank(probe) === probeRank(best) && (probe.ms ?? Infinity) < (best.ms ?? Infinity)))) best = probe;
      }
      if (best) for (const line of channel.lines) grouped.set(line.url, best);
    }
    return grouped;
  }, [channels, probeResults]);

  // 可用性计数基于未应用可用性筛选的列表，避免按钮数量随筛选收缩。
  const matched = useMemo(() => {
    let list = view === 'fav'
      ? channels.filter((channel) => isLiveFavorite(channel, favSet))
      : view === 'recent' ? recentChannels : channels;
    if (view !== 'recent' && group) list = list.filter((channel) => channel.group === group);
    if (normalizedKeyword) list = list.filter((channel) => matchesKeyword(channel, normalizedKeyword));
    return sortChannels(list, sortMode, { recentOrder, probeOf: (url) => channelProbes.get(url) });
  }, [channels, favSet, recentChannels, view, group, normalizedKeyword, sortMode, recentOrder, channelProbes]);

  const filtered = useMemo(
    () => aliveFilter === 'off' ? matched : matched.filter((channel) => matchesAlive(channelProbes.get(channel.url), aliveFilter)),
    [matched, aliveFilter, channelProbes]
  );

  // 上报筛选排序结果给页面（键盘换台用）；列表存父组件 ref，不触发父组件重渲染
  useEffect(() => {
    onFilteredChange?.(filtered);
  }, [filtered, onFilteredChange]);

  // 口径与两个筛选按钮一致：绿点=分片级验证且吞吐达标（排除限速源），可播=任何验证级别通过
  const aliveCounts = useMemo(() => {
    let ok = 0;
    let green = 0;
    for (const c of matched) {
      const p = channelProbes.get(c.url);
      if (!p?.ok) continue;
      ok++;
      if (matchesAlive(p, 'green')) green++;
    }
    return { ok, green };
  }, [matched, channelProbes]);

  // 键盘/锚定滚动需要按 URL 反查索引；filtered 随测活结果变化（排序含可用性），
  // 用 ref 读取最新值，避免测活写回触发重新锚定打断用户滚动
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    // 行高两档：带分组名的双行 / 无分组名单行（含 4px 行距），measureElement 会修正估值
    estimateSize: (i) => (filtered[i].group ? 51 : 47),
    overscan: 10,
    getItemKey: (i) => filtered[i].channelKey,
  });

  // 切换筛选/排序/频道时：重置键盘光标，并把当前播放频道锚定到可视区（找不到则回顶部）
  useEffect(() => {
    setCursor(-1);
    if (!currentUrl) {
      virtualizer.scrollToOffset(0);
      return;
    }
    const idx = filteredRef.current.findIndex((c) => channelHasUrl(c, currentUrl));
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    else virtualizer.scrollToOffset(0);
  }, [view, group, sortMode, debouncedKeyword, aliveFilter, currentUrl, virtualizer]);

  const scrollToChannelRow = useCallback(
    (url: string) => {
      const idx = filteredRef.current.findIndex((c) => channelHasUrl(c, url));
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    },
    [virtualizer]
  );

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const base = cursor === -1 ? (delta === 1 ? -1 : 0) : cursor;
      const next = Math.min(Math.max(base + delta, 0), filtered.length - 1);
      setCursor(next);
      virtualizer.scrollToIndex(next, { align: 'auto' });
      return;
    }
    if (e.key === 'Enter' && cursor >= 0 && cursor < filtered.length) {
      // 焦点在行内按钮（收藏/删除）上时，Enter 交给按钮自身
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      onSelect(filtered[cursor]);
    }
  };

  const removeRecent = useCallback((url: string) => {
    useAppStore.getState().removeLiveRecent(url);
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* 视图 tab */}
      <div className="mx-4 mb-1 mt-4 flex shrink-0 items-center gap-1 rounded-2xl bg-chip p-1">
        {(
          [
            ['all', `全部${channels.length ? ` ${channels.length}` : ''}`],
            ['fav', `收藏${favoriteCount ? ` ${favoriteCount}` : ''}`],
            ['recent', '最近'],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            className={cn(
              'min-w-0 flex-1 rounded-xl px-2 py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              view === v ? 'bg-accent text-on-accent font-semibold shadow-sm' : 'text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 px-4 py-3">
        <input
          className="input min-w-0 w-full !rounded-xl !border-line/60 !px-3.5 !py-2.5 !text-xs"
          placeholder="搜索频道 / tvg-id / 分组..."
          value={keyword}
          maxLength={60}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            // 搜索框内按 ↓ 进入列表光标导航
            if (e.key === 'ArrowDown' && filtered.length > 0) {
              e.preventDefault();
              setCursor(0);
              scrollToChannelRow(filtered[0].url);
              listRef.current?.focus();
            }
          }}
        />
        <Dropdown
          className="shrink-0 [&>button]:!rounded-xl [&>button]:!border-line/60 [&>button]:!py-2.5 [&>button]:!px-3 [&>button]:!text-xs"
          value={sortMode}
          ariaLabel="排序方式"
          onChange={(v) => setSortMode(v as LiveSortMode)}
          options={[
            { value: 'default', label: '默认' },
            { value: 'name', label: '名称' },
            { value: 'group', label: '分组' },
            { value: 'probe', label: '可用优先' },
            { value: 'recent', label: '最近看' },
          ]}
        />
      </div>

      {/* 测活 + 可用性筛选工具条 */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
        <button
          className="btn-ghost btn-sm !rounded-full !border-line/60 !px-3 !py-1.5"
          disabled={isProbing || filtered.length === 0}
          onClick={() => void probe(filtered.flatMap((channel) => channel.lines))}
          title="探测当前列表频道是否可播（分片级校验；量大时自动分批排队跑完，结果 6 小时内有效）"
        >
          测活
        </button>
        {/* 同一操作位按时机切换：测活中=取消（保留已完成结果）；空闲且有结果=清除全部 */}
        {isProbing ? (
          <button
            className="btn-ghost btn-sm !rounded-full !border-line/60 !px-3 !py-1.5"
            onClick={cancelProbe}
            title="中止本次测活，已完成的结果会保留"
          >
            取消
          </button>
        ) : (
          probeResults.size > 0 && (
            <button
              className="btn-ghost btn-sm !rounded-full !border-line/60 !px-3 !py-1.5"
              onClick={() => {
                clearProbe();
                setAliveFilter('off');
              }}
              title="清除全部测活结果，并取消可用性筛选"
            >
              清除
            </button>
          )
        )}
        {isProbing && probeProgress && (
          <span className="max-w-full break-words text-[10px] leading-relaxed text-faint">
            探测中 {formatProbeProgress(probeProgress)}
          </span>
        )}
        {probeHint && (
          <span className="text-[10px] text-faint">{probeHint}</span>
        )}
        {probeResults.size > 0 && !isProbing && (
          <>
            <button
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1.5 text-[10px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                aliveFilter === 'green'
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
              )}
              onClick={() => setAliveFilter((v) => (v === 'green' ? 'off' : 'green'))}
              title="只看分片级验证通过的频道"
            >
              绿点 {aliveCounts.green}
            </button>
            <button
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1.5 text-[10px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                aliveFilter === 'ok'
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
              )}
              onClick={() => setAliveFilter((v) => (v === 'ok' ? 'off' : 'ok'))}
              title="看所有验证通过（含直链/清单级弱验证）的频道"
            >
              可播 {aliveCounts.ok}
            </button>
          </>
        )}
      </div>

      {/* 分组标签条（横向可滑动） */}
      {view === 'all' && groups.length > 0 && (
        <div className="min-w-0 shrink-0 px-4 pb-3">
          <div className="scrollbar-thin flex min-w-0 gap-2 overflow-x-auto pb-1">
            <GroupChip active={!group} label="全部分组" onClick={() => setGroup('')} />
            {groups.map((g) => (
              <GroupChip key={g} active={group === g} label={g} onClick={() => setGroup(g === group ? '' : g)} />
            ))}
          </div>
        </div>
      )}

      {/* 频道列表（容器可聚焦，↑↓/Enter 光标导航） */}
      <div
        ref={listRef}
        data-channel-list
        tabIndex={0}
        onKeyDown={onListKeyDown}
        className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {filtered.length === 0 ? (
          <EmptyState
            variant="plain"
            className="!py-10"
            title={
              view === 'fav'
                ? '暂无收藏频道，点击频道右侧星标即可收藏'
                : view === 'recent'
                  ? '暂无观看记录'
                  : channels.length === 0
                    ? '暂无频道，请先在设置中添加直播源'
                    : aliveFilter !== 'off' && probeResults.size > 0
                      ? '没有匹配该可用性的频道，可放宽或清除筛选'
                      : '没有匹配的频道'
            }
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  // 原 space-y-1 的 4px 行距；padding 计入 measureElement 量得的高度
                  paddingBottom: 4,
                }}
              >
                <ChannelRow
                  channel={filtered[vi.index]}
                  active={channelHasUrl(filtered[vi.index], currentUrl)}
                  cursor={cursor === vi.index}
                  isFav={isLiveFavorite(filtered[vi.index], favSet)}
                  probe={channelProbes.get(filtered[vi.index].url)}
                  logo={filtered[vi.index].logo}
                  imageProxyMode={imageProxyMode}
                  customProxy={customImageProxy}
                  onSelect={onSelect}
                  onRemoveRecent={view === 'recent' ? removeRecent : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-accent text-on-accent border-accent'
          : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const ChannelRow = memo(function ChannelRow({
  channel,
  active,
  cursor,
  isFav,
  probe,
  logo,
  imageProxyMode,
  customProxy,
  onSelect,
  onRemoveRecent,
}: {
  channel: LiveChannelItem;
  active: boolean;
  cursor: boolean;
  isFav: boolean;
  probe?: ProbeResult;
  logo?: string;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customProxy: string;
  onSelect: (channel: LiveChannelItem) => void;
  /** 仅最近视图传入：删除该条观看记录 */
  onRemoveRecent?: (url: string) => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  // 虚拟列表会复用行实例：换台（logo 变化）时重置失败态，避免下一个频道误显首字母
  useEffect(() => setLogoFailed(false), [logo]);
  // H.265/HEVC：国内 IPTV 常见，测活通过但 Chromium 内核通常无法软解
  const isHevc = Boolean(probe?.codec && /hvc1|hev1|hevc/i.test(probe.codec));
  // 源限速：分片可达但吞吐不足，绿点却播不了的主因
  const slow = isSlowSource(probe);
  // 状态点语义：绿=分片级验证且吞吐达标；琥珀=限速/弱验证（直链/清单级）或超时；红=不可达
  const weakLevel = probe?.ok && probe.level !== 'segment';
  const amber = Boolean(probe && (weakLevel || (!probe.ok && probe.timedOut) || slow));
  const dotClass = amber ? 'bg-warning' : probe?.ok ? 'bg-success' : 'bg-danger';
  const levelText =
    probe?.level === 'segment'
      ? '分片可用'
      : probe?.level === 'head'
        ? '直链可达（未验证可播性）'
        : '播放列表可达（无分片，未验证可播）';
  const speedText =
    probe?.kbps != null && probe.level === 'segment'
      ? ` · ≈${probe.kbps >= 1000 ? `${(probe.kbps / 1000).toFixed(1)}Mbps` : `${probe.kbps}kbps`}`
      : '';
  const probeTitle = probe
    ? probe.ok
      ? slow
        ? `源限速${speedText.replace(' · ', ' ')}，缓冲跟不上，可能无法流畅播放`
        : `${levelText}${speedText}${probe.ms != null && probe.level === 'segment' ? ` · 延迟 ${probe.ms}ms` : ''}${isHevc ? ' · H.265 编码，需 Edge/Safari' : ''}`
      : probe.timedOut
        ? `${probe.error || '探测超时'} · 源可能只是慢，可直接试播确认`
        : probe.error || '不可用'
    : undefined;

  return (
    <div data-url={channel.url}>
      {/* 不用 role="button"：行内含收藏/删除等真实按钮，嵌套 button 角色语义非法；
          键盘操作由外层列表容器的 ↑↓ 导航提供 */}
      <div
        className={cn(
          'group relative flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 transition-colors',
          active ? 'bg-accent text-on-accent' : 'text-content hover:bg-chip',
          cursor && 'ring-2 ring-inset ring-accent/70'
        )}
        onClick={() => onSelect(channel)}
      >
        {/* 当前播放高亮竖条 */}
        <span
          className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full bg-on-accent/50 transition-all duration-200',
            active ? 'h-5 opacity-100' : 'h-0 opacity-0'
          )}
        />
        {/* 台标 */}
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl p-1", active ? "bg-on-accent/10" : "bg-chip")}>
          {logo && !logoFailed ? (
            <SmartImage
              url={logo}
              mode={imageProxyMode}
              customProxy={customProxy}
              alt=""
              className="w-full h-full object-contain"
              onExhausted={() => setLogoFailed(true)}
            />
          ) : (
            <span className={cn("text-xs", active ? "text-on-accent/70" : "text-faint")}>{channel.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {probe && (
              <span
                className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClass)}
                title={probeTitle}
              />
            )}
            <span className={cn('truncate text-[13px]', active ? 'font-semibold text-on-accent' : 'font-medium text-content')}>
              {channel.name}
            </span>
            {channel.lines.length > 1 && (
              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px]', active ? 'bg-on-accent/10 text-on-accent/75' : 'bg-chip text-faint')}>
                {channel.lines.length} 线路
              </span>
            )}
            {isHevc && (
              <span
                className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium", active ? "bg-on-accent/10 text-on-accent/80" : "bg-warning/15 text-warning")}
                title="H.265 编码：测活通过但 Chromium 内核通常无法解码，建议用 Edge/Safari"
              >
                H.265
              </span>
            )}
          </div>
          {channel.group && (
            <div className={cn("mt-0.5 truncate text-[11px]", active ? "text-on-accent/65" : "text-faint")}>{channel.group}</div>
          )}
        </div>
        {/* 最近观看单条删除（仅最近视图；移动端常显） */}
        {onRemoveRecent && (
          <button
            className={cn(
              'shrink-0 rounded-full p-1.5 transition-colors opacity-60 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 hover:opacity-100',
              active ? 'text-on-accent/60 hover:text-on-accent' : 'text-faint hover:text-danger'
            )}
            aria-label="删除该观看记录"
            title="删除该观看记录"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRecent(channel.channelKey);
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* 收藏星标（移动端常显，桌面 hover 出现） */}
        <button
          className={cn(
            'shrink-0 rounded-full p-1.5 transition-transform active:scale-125 focus-visible:opacity-100',
            isFav
              ? active ? 'text-on-accent' : 'text-warning'
              : active
                ? 'text-on-accent/60 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 hover:text-on-accent'
                : 'text-faint/60 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 hover:text-warning'
          )}
          aria-label={isFav ? '取消收藏' : '收藏'}
          title={isFav ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            // 点击时读取最新状态：行组件不订阅 store，保证探测期间的重渲染隔离
            useAppStore.getState().toggleLiveFavorite(channel.channelKey, channel.lines.map((line) => line.url));
          }}
        >
          <svg className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
});
