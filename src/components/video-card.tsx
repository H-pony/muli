'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { SearchResultItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';

// —— 跨源同名聚合 ——

export interface AggregatedGroup {
  key: string;
  name: string;
  year?: string;
  typeName?: string;
  pic?: string;
  remarks?: string;
  items: SearchResultItem[];
}

function buildGroup(name: string, year: string | undefined, items: SearchResultItem[]): AggregatedGroup {
  return {
    key: `${name}|${year ?? ''}|${items.map((i) => `${i.sourceKey}_${i.vodId}`).join(',')}`,
    name,
    year,
    typeName: items.find((i) => i.typeName)?.typeName,
    pic: items.find((i) => i.pic)?.pic,
    remarks: items.find((i) => i.remarks)?.remarks,
    items,
  };
}

/**
 * 把扁平的跨源搜索结果按「同名影片」聚合：
 * - 以名称分桶；桶内年份不一致时（同名翻拍）按年份拆分，无年份的条目并入年份桶；
 * - 保持传入顺序（搜索结果已按名称排序）。
 */
export function aggregateResults(list: SearchResultItem[]): AggregatedGroup[] {
  const byName = new Map<string, SearchResultItem[]>();
  for (const item of list) {
    const k = (item.name || '').trim();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(item);
  }
  const groups: AggregatedGroup[] = [];
  for (const [name, items] of byName) {
    const years = [...new Set(items.map((i) => i.year).filter(Boolean))] as string[];
    if (years.length > 1) {
      for (const y of years) {
        groups.push(buildGroup(name, y, items.filter((i) => i.year === y)));
      }
      const noYear = items.filter((i) => !i.year);
      if (noYear.length) groups.push(buildGroup(name, undefined, noYear));
    } else {
      groups.push(buildGroup(name, years[0], items));
    }
  }
  return groups;
}

const POSTER_CARD_CLASS = 'tv-poster-card group relative block w-full min-w-0 self-start rounded-[20px] border border-transparent bg-transparent text-left text-content transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:border-white/15 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)] focus-within:-translate-y-1 focus-within:scale-[1.02] focus-within:border-white/25 focus-within:ring-2 focus-within:ring-accent/60 motion-reduce:transform-none motion-reduce:transition-none';

/** 所有海报共用用户设置与 SmartImage 降级链；修改图片设置后可重新尝试。 */
function PosterArtwork({ url, title, children, eager = false }: { url?: string; title: string; children?: ReactNode; eager?: boolean }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const handleExhausted = useCallback(() => setImgFailed(true), []);
  useEffect(() => setImgFailed(false), [url, imageProxyMode, customImageProxy]);

  return (
    <span className="tv-poster-card__artwork relative block aspect-[2/3] w-full overflow-hidden rounded-[18px] bg-chip">
      {url && !imgFailed ? (
        <SmartImage
          url={url}
          mode={imageProxyMode}
          customProxy={customImageProxy}
          alt={title}
          className="tv-poster-card__image absolute inset-0 h-full w-full object-cover"
          loading={eager ? 'eager' : 'lazy'}
          onExhausted={handleExhausted}
        />
      ) : (
        <span className="tv-poster-card__placeholder absolute inset-0 flex flex-col items-center justify-center gap-3 bg-chip text-faint" aria-hidden="true">
          <svg className="h-10 w-10 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="3" width="16" height="18" rx="3" strokeWidth="1.25" />
            <path d="M8 3v18M16 3v18M4 8h4m8 0h4M4 16h4m8 0h4" strokeWidth="1.25" />
          </svg>
          <span className="text-[11px]">暂无海报</span>
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/[0.04]" aria-hidden="true" />
      {children}
    </span>
  );
}

function AgeBadge() {
  return <span className="tv-poster-card__age absolute right-2.5 top-2.5 rounded-md border border-white/20 bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">18+</span>;
}

function PosterMetadata({ year, typeName, remarks }: { year?: string; typeName?: string; remarks?: string }) {
  return (
    <>
      {(year || typeName) && (
        <span className="tv-poster-card__meta mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-5 text-muted sm:text-xs">
          {year && <span className="shrink-0">{year}</span>}
          {year && typeName && <span aria-hidden="true">·</span>}
          {typeName && <span className="truncate">{typeName}</span>}
        </span>
      )}
      {remarks && <span className="tv-poster-card__remarks mt-0.5 block truncate text-[11px] leading-5 text-muted sm:text-xs" title={remarks}>{remarks}</span>}
    </>
  );
}

/** 单源打开详情；多源的主按钮与来源按钮互为兄弟，展开区域自然撑高卡片。 */
export function AggregatedCard({
  group,
  onOpen,
}: {
  group: AggregatedGroup;
  onOpen: (item: SearchResultItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourcesId = useId();
  const multi = group.items.length > 1;
  const adult = useMemo(() => group.items.some((i) => i.isAdult), [group.items]);

  const activate = () => {
    if (multi) setExpanded((value) => !value);
    else if (group.items[0]) onOpen(group.items[0]);
  };

  return (
    <article className={cn(POSTER_CARD_CLASS, 'tv-poster-card--aggregated', multi && expanded && 'tv-poster-card--expanded z-10 bg-surface shadow-xl')}>
      <button
        type="button"
        className="tv-poster-card__trigger block w-full cursor-pointer rounded-[20px] text-left focus-visible:outline-none"
        data-tv-card=""
        aria-label={multi
          ? `${expanded ? '收起' : '展开'}《${group.name}》的 ${group.items.length} 个来源${adult ? '，18岁以上' : ''}`
          : `查看《${group.name}》详情${adult ? '，18岁以上' : ''}`}
        aria-expanded={multi ? expanded : undefined}
        aria-controls={multi ? sourcesId : undefined}
        onClick={activate}
      >
        <PosterArtwork url={group.pic} title={group.name}>
          {multi && <span className="tv-poster-card__source-count absolute left-2.5 top-2.5 rounded-md border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-medium text-white">{group.items.length} 个来源</span>}
          {adult && <AgeBadge />}
        </PosterArtwork>
        <span className="tv-poster-card__body block min-w-0 px-1.5 pb-2.5 pt-3">
          <span className="tv-poster-card__title line-clamp-2 text-[13px] font-semibold leading-5 tracking-tight text-content sm:text-sm" title={group.name}>{group.name}</span>
          <PosterMetadata year={group.year} typeName={group.typeName} remarks={group.remarks} />
          <span className="tv-poster-card__source mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] leading-5 text-muted">
            <span className="truncate">{multi ? (expanded ? '收起来源' : '选择播放来源') : group.items[0]?.sourceName}</span>
            {multi && (
              <svg className={cn('h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="m6 9 6 6 6-6" />
              </svg>
            )}
          </span>
        </span>
      </button>

      {multi && expanded && (
        <div id={sourcesId} className="tv-poster-card__sources border-t border-line px-2.5 py-3" role="group" aria-label={`《${group.name}》的播放来源`}>
          <p className="mb-2 text-[10px] text-faint">选择来源播放</p>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <button
                type="button"
                key={`${item.sourceKey}_${item.vodId}`}
                className={cn(
                  'tv-poster-card__source-button flex w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-chip px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none',
                  item.isAdult && 'border-pink-500/30'
                )}
                onClick={() => onOpen(item)}
                aria-label={`使用 ${item.sourceName} 播放《${group.name}》${item.isAdult ? '，18岁以上' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs font-medium leading-5 text-content">{item.sourceName}{item.isAdult && <span className="ml-1 text-[10px] text-muted">18+</span>}</span>
                  {item.remarks && <span className="block break-words text-[11px] leading-4 text-muted">{item.remarks}</span>}
                </span>
                <svg className="h-3.5 w-3.5 shrink-0 text-content" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

/** 未聚合的单一结果保留原有 prop API。原生 button 支持 Enter / Space。 */
export function VideoCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(POSTER_CARD_CLASS, 'tv-poster-card--video cursor-pointer focus-visible:outline-none')}
      data-tv-card=""
      aria-label={`查看《${item.name}》详情${item.isAdult ? '，18岁以上' : ''}`}
      onClick={onClick}
    >
      <PosterArtwork url={item.pic} title={item.name}>{item.isAdult && <AgeBadge />}</PosterArtwork>
      <span className="tv-poster-card__body block min-w-0 px-1.5 pb-2.5 pt-3">
        <span className="tv-poster-card__title line-clamp-2 text-[13px] font-semibold leading-5 tracking-tight text-content sm:text-sm" title={item.name}>{item.name}</span>
        <PosterMetadata year={item.year} typeName={item.typeName} remarks={item.remarks} />
        <span className="tv-poster-card__source mt-2 block truncate text-[11px] leading-5 text-muted">{item.sourceName}</span>
      </span>
    </button>
  );
}

/** 榜单海报：排名遵循上游顺序，评分仅显示真实值。 */
export function RankingCard({ item, rank, onClick, eager = false }: {
  item: import('@/lib/types').DoubanItem;
  rank?: number;
  onClick: () => void;
  eager?: boolean;
}) {
  return (
    <button
      type="button"
      className="tv-ranking-card"
      data-tv-card=""
      aria-label={`查看《${item.title}》详情${rank ? `，榜单第 ${rank} 名` : ''}${item.rating ? `，评分 ${item.rating}` : ''}`}
      onClick={onClick}
    >
      <PosterArtwork url={item.cover} title={item.title} eager={eager}>
        {rank !== undefined && <span className="tv-ranking-card__rank" aria-hidden="true">{String(rank).padStart(2, '0')}</span>}
        {item.rating && <span className="tv-ranking-card__rating"><span aria-hidden="true">★</span> {item.rating}</span>}
      </PosterArtwork>
      <span className="tv-ranking-card__caption">
        <span className="tv-ranking-card__title">{item.title}</span>
        <span className="tv-ranking-card__hint">{[item.year, item.genres?.[0] || (item.isTv ? '剧集' : '电影')].filter(Boolean).join(' · ')}<span aria-hidden="true">›</span></span>
      </span>
    </button>
  );
}

/** 纵向片库海报：保持加载顺序，片名与年份始终可见。 */
export function DiscoveryCard({ item, onClick, eager = false }: {
  item: import('@/lib/types').DoubanItem;
  onClick: () => void;
  eager?: boolean;
}) {
  const metadata = [item.year, item.countries?.[0], item.genres?.[0]].filter(Boolean).join(' · ');
  return (
    <button type="button" className="tv-discovery-card" data-tv-card="" data-subject-id={item.id}
      aria-label={`查看《${item.title}》详情${item.rating ? `，评分 ${item.rating}` : ''}`} onClick={onClick}>
      <PosterArtwork url={item.cover} title={item.title} eager={eager}>
        {item.rating && <span className="tv-ranking-card__rating"><span aria-hidden="true">★</span> {item.rating}</span>}
        <span className="tv-discovery-card__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="m9 5 11 7-11 7V5Z" /></svg>
        </span>
      </PosterArtwork>
      <span className="tv-discovery-card__body">
        <span className="tv-discovery-card__title" title={item.title}>{item.title}</span>
        {metadata && <span className="tv-discovery-card__meta" title={metadata}>{metadata}</span>}
      </span>
    </button>
  );
}

/** 推荐海报保留实际评分，点击仍以原始标题搜索。 */
export function DoubanCard({ item, onClick }: { item: { title: string; cover: string; rating?: string }; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(POSTER_CARD_CLASS, 'tv-poster-card--recommendation cursor-pointer focus-visible:outline-none')}
      data-tv-card=""
      aria-label={`搜索《${item.title}》${item.rating ? `，评分 ${item.rating}` : ''}`}
      onClick={onClick}
    >
      <PosterArtwork url={item.cover} title={item.title} />
      <span className="tv-poster-card__body block min-w-0 px-1.5 pb-2.5 pt-3">
        <span className="tv-poster-card__title line-clamp-2 text-[13px] font-semibold leading-5 tracking-tight text-content sm:text-sm" title={item.title}>{item.title}</span>
        {item.rating && (
          <span className="tv-poster-card__meta tv-poster-card__rating mt-1 flex items-center gap-1.5 text-[11px] leading-5 text-muted sm:text-xs">
            <span className="text-rating" aria-hidden="true">★</span>
            <span>{item.rating}</span>
          </span>
        )}
      </span>
    </button>
  );
}
