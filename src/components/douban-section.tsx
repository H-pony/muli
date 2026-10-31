'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { ContentRail } from './content-rail';
import { DoubanCard } from './video-card';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const EMPTY_ITEMS: readonly DoubanItem[] = [];

export interface RecommendSectionProps {
  onPick: (title: string) => void;
  onFeaturedChange?: (item: DoubanItem | null) => void;
}

/**
 * 仅在实际首项变化时回报；callback 用 ref 接收最新引用，父级内联 callback 不会触发循环。
 * undefined 表示由当前来源视图负责回报，null 表示当前没有可展示的推荐。
 */
function useFeaturedItem(item: DoubanItem | null | undefined, onFeaturedChange: RecommendSectionProps['onFeaturedChange']) {
  const callbackRef = useRef(onFeaturedChange);
  const hasCallback = Boolean(onFeaturedChange);
  useEffect(() => { callbackRef.current = onFeaturedChange; }, [onFeaturedChange]);
  useEffect(() => {
    if (item !== undefined) callbackRef.current?.(item);
  }, [item, hasCallback]);
}

/** 首页推荐区：尊重豆瓣 / Bangumi / 影视热榜偏好，关闭推荐时清除 Hero 数据。 */
export function RecommendSection({ onPick, onFeaturedChange }: RecommendSectionProps) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);
  useFeaturedItem(doubanEnabled ? undefined : null, onFeaturedChange);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} onFeaturedChange={onFeaturedChange} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} onFeaturedChange={onFeaturedChange} />;
  return <DoubanView onPick={onPick} onFeaturedChange={onFeaturedChange} />;
}

/** 豆瓣影视切换和完整标签筛选；全部结果按原始顺序放入横排。 */
function DoubanView({ onPick, onFeaturedChange }: RecommendSectionProps) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');
  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });
  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? EMPTY_ITEMS;
  const typeLabel = type === 'movie' ? '电影' : '剧集';
  const allHref = `/browse/${type === 'movie' ? 'movies' : tag === '综艺' ? 'shows' : 'tv'}`;
  useFeaturedItem(query.isError || query.isLoading ? null : items[0] ?? null, onFeaturedChange);

  const switchType = (next: 'movie' | 'tv') => {
    if (next === type) return;
    setType(next);
    setTag('热门');
  };

  return (
    <section className="tv-recommendation min-w-0 max-w-full" aria-label="影视推荐">
      <RecommendationHeader title="发现好故事" description="来自豆瓣的电影与剧集，从熟悉的热门到意外的惊喜。">
        <div className="tv-recommendation__type flex shrink-0 rounded-full border border-line bg-chip p-1" role="group" aria-label="推荐类型">
          <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>电影</TypeButton>
          <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>剧集</TypeButton>
        </div>
      </RecommendationHeader>
      <div className="tv-recommendation__filters mb-7 flex flex-wrap gap-2" role="group" aria-label={`${typeLabel}标签`}>
        {tags.map((name) => <ChipButton key={name} active={name === tag} onClick={() => setTag(name)}>{name}</ChipButton>)}
      </div>
      {query.isError ? (
        <RecommendationMessage>推荐内容加载失败，可稍后重试或在设置中关闭</RecommendationMessage>
      ) : query.isLoading ? (
        <RailSkeleton allHref={allHref} />
      ) : items.length === 0 ? (
        <RecommendationMessage>该分类暂无推荐内容</RecommendationMessage>
      ) : (
        <RecommendationRails items={items} onPick={onPick} title={`${tag}${typeLabel}`} sourceLabel={`豆瓣 · ${tag}${typeLabel}`} allHref={allHref} />
      )}
    </section>
  );
}

/** Bangumi 每日放送：保留全部 / 星期筛选，一次拉全量无分页。 */
function BangumiView({ onPick, onFeaturedChange }: RecommendSectionProps) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');
  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });
  const items = useMemo(() => {
    if (!query.data) return EMPTY_ITEMS;
    return weekday === 'all'
      ? query.data.days.flatMap((day) => day.items)
      : query.data.days.find((day) => day.weekday === weekday)?.items ?? EMPTY_ITEMS;
  }, [query.data, weekday]);
  const weekdayLabel = weekday === 'all' ? '全部放送' : `${WEEKDAYS[weekday - 1]}放送`;
  useFeaturedItem(query.isError || query.isLoading ? null : items[0] ?? null, onFeaturedChange);

  return (
    <section className="tv-recommendation min-w-0 max-w-full" aria-label="新番放送推荐">
      <RecommendationHeader title="新番放送" description="跟随 Bangumi 每日放送，按星期发现正在播出的动画。" />
      <div className="tv-recommendation__filters mb-7 flex flex-wrap gap-2" role="group" aria-label="放送星期">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>全部</ChipButton>
        {WEEKDAYS.map((name, index) => (
          <ChipButton key={name} active={weekday === index + 1} onClick={() => setWeekday(index + 1)}>{name}</ChipButton>
        ))}
      </div>
      {query.isError ? (
        <RecommendationMessage>推荐内容加载失败，可稍后重试或在设置中关闭</RecommendationMessage>
      ) : query.isLoading ? (
        <RailSkeleton />
      ) : items.length === 0 ? (
        <RecommendationMessage>该放送日暂无推荐内容</RecommendationMessage>
      ) : (
        <RecommendationRails items={items} onPick={onPick} title={weekdayLabel} sourceLabel={`Bangumi · ${weekdayLabel}`} />
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜', category: 'movies' },
  { id: 'douban_tv_chinese', label: '国产剧周榜', category: 'tv' },
  { id: 'douban_tv_global', label: '海外剧周榜', category: 'tv' },
  { id: 'douban_show_chinese', label: '国内综艺', category: 'shows' },
  { id: 'douban_show_global', label: '海外综艺', category: 'shows' },
  { id: 'baidu_teleplay', label: '百度热播剧', category: 'tv' },
];

/** 影视热榜（60s API）：保留豆瓣五个周榜和百度热播剧。 */
function HotListView({ onPick, onFeaturedChange }: RecommendSectionProps) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);
  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });
  const items = query.data?.items ?? EMPTY_ITEMS;
  const selectedList = HOT_LISTS.find((list) => list.id === listId)!;
  const listLabel = selectedList.label;
  const allHref = `/browse/${selectedList.category}`;
  useFeaturedItem(query.isError || query.isLoading ? null : items[0] ?? null, onFeaturedChange);

  return (
    <section className="tv-recommendation min-w-0 max-w-full" aria-label="影视榜单推荐">
      <RecommendationHeader title="此刻热门" description="电影、剧集与综艺，从当前榜单发现大家正在看的故事。" />
      <div className="tv-recommendation__filters mb-7 flex flex-wrap gap-2" role="group" aria-label="影视榜单">
        {HOT_LISTS.map((list) => (
          <ChipButton key={list.id} active={listId === list.id} onClick={() => setListId(list.id)}>{list.label}</ChipButton>
        ))}
      </div>
      {query.isError ? (
        <RecommendationMessage>推荐内容加载失败，可稍后重试或在设置中关闭</RecommendationMessage>
      ) : query.isLoading ? (
        <RailSkeleton allHref={allHref} />
      ) : items.length === 0 ? (
        <RecommendationMessage>该榜单暂无推荐内容</RecommendationMessage>
      ) : (
        <RecommendationRails items={items} onPick={onPick} title={listLabel} sourceLabel={listLabel} allHref={allHref} />
      )}
    </section>
  );
}

function RecommendationHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="tv-recommendation__header mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="tv-section-title text-2xl font-semibold tracking-tight text-content sm:text-3xl">{title}</h2>
        <p className="tv-section-description mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** 50 条数据分为三个横排，不截断数据、不改动原始推荐次序。 */
function RecommendationRails({ items, onPick, title, sourceLabel, allHref }: {
  items: readonly DoubanItem[];
  onPick: (title: string) => void;
  title: string;
  sourceLabel: string;
  allHref?: string;
}) {
  const shelfCount = items.length > 32 ? 3 : items.length > 16 ? 2 : 1;
  const shelfSize = Math.ceil(items.length / shelfCount);
  return (
    <div className="tv-recommendation__shelves min-w-0 space-y-5 sm:space-y-7">
      {Array.from({ length: shelfCount }, (_, index) => {
        const start = index * shelfSize;
        const shelf = items.slice(start, start + shelfSize);
        const shelfTitle = index === 0 ? title : index === 1 ? '继续探索' : '更多值得发现';
        return (
          <ContentRail
            key={`${sourceLabel}:${index}`}
            title={shelfTitle}
            subtitle={`${sourceLabel} · 第 ${start + 1}–${start + shelf.length} 部，共 ${items.length} 部`}
            allHref={allHref}
          >
            {shelf.map((item, itemIndex) => (
              <DoubanCard key={`${item.id}:${start + itemIndex}`} item={item} onClick={() => onPick(item.title)} />
            ))}
          </ContentRail>
        );
      })}
    </div>
  );
}

function RecommendationMessage({ children }: { children: ReactNode }) {
  return <p className="tv-recommendation__message rounded-2xl border border-line bg-surface/40 px-6 py-12 text-center text-sm text-muted" role="status">{children}</p>;
}

function RailSkeleton({ allHref }: { allHref?: string }) {
  return (
    <div className="tv-recommendation__loading" role="status" aria-label="正在加载推荐" aria-busy="true">
      <ContentRail title="正在加载推荐" allHref={allHref}>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} aria-hidden="true" className="motion-safe:animate-pulse">
            <div className="aspect-[2/3] rounded-[18px] bg-chip" />
            <div className="mt-3 h-3 w-4/5 rounded-full bg-chip" />
            <div className="mt-2 h-2.5 w-2/5 rounded-full bg-chip" />
          </div>
        ))}
      </ContentRail>
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'tv-filter-chip rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none',
        active ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-transparent text-muted hover:bg-hover hover:text-content'
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'tv-type-button rounded-full px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none',
        active ? 'bg-accent text-on-accent shadow-sm' : 'text-muted hover:text-content'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
