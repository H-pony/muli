'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { discoveryCategoryLabel, discoveryFilterKey, type DiscoveryFilters } from '@/lib/discovery-model';
import { readNavigationEntry, rememberNavigationEntry, restoreNavigationEntry } from '@/lib/navigation';
import { useNavigationLocation } from '@/lib/navigation-hooks';
import type { DoubanItem } from '@/lib/types';
import { useAuth } from './auth';
import { DiscoveryCard } from './video-card';
import { NavigationPageLink } from './navigation-page-link';
import { EmptyState, Spinner } from './states';

const PAGE_SIZE = 24;

interface DiscoveryFeedProps {
  filters: DiscoveryFilters;
  onOpen: (item: DoubanItem, related: DoubanItem[]) => void;
  showHeading?: boolean;
  onReset?: () => void;
}

/** 真实分页的纵向海报流；追加内容保持 DOM 顺序，详情返回不重新折叠已加载的页面。 */
export function DiscoveryFeed({ filters, onOpen, showHeading = true, onReset }: DiscoveryFeedProps) {
  const { checked, verified, openLogin } = useAuth();
  const label = discoveryCategoryLabel(filters.category);
  const filterKey = discoveryFilterKey(filters);
  const location = useNavigationLocation();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const restorationRef = useRef<{ pages: number; applied: boolean } | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['discovery', filterKey],
    queryFn: ({ pageParam, signal }) => api.discover(filters, pageParam, PAGE_SIZE, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages, lastOffset, offsets) => {
      const next = lastPage.nextStart;
      if (!lastPage.hasMore || next === null || next <= lastOffset || offsets.includes(next)) return undefined;
      if (lastPage.items.length > 0 && allPages.length > 1) {
        const seen = new Set(allPages.slice(0, -1).flatMap((page) => page.items.map((item) => item.id)));
        if (lastPage.items.every((item) => seen.has(item.id))) return undefined;
      }
      return next;
    },
    enabled: verified,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const { fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isFetchNextPageError } = query;
  const pageCount = query.data?.pages.length ?? 0;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) => page.items).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [query.data]);

  // 刷新/缓存回收后也能补回此前加载的页数，再恢复原来的纵向位置。
  useEffect(() => {
    const saved = readNavigationEntry()?.data;
    restorationRef.current = saved?.discoveryQuery === filterKey && typeof saved.discoveryPageCount === 'number'
      ? { pages: Math.min(100, Math.max(1, saved.discoveryPageCount)), applied: false }
      : null;
  }, [filterKey, location]);

  useEffect(() => {
    const restore = restorationRef.current;
    if (!verified || !restore || restore.applied || pageCount === 0 || query.isError) return;
    if (pageCount < restore.pages && hasNextPage) {
      if (!isFetching) void fetchNextPage();
      return;
    }
    restore.applied = true;
    return restoreNavigationEntry();
  }, [verified, pageCount, hasNextPage, isFetching, fetchNextPage, query.isError, location, filterKey]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!verified || !target || !hasNextPage || isFetching || isFetchNextPageError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
    }, { rootMargin: '0px 0px 600px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [verified, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, items.length, filterKey]);

  const rememberFeed = () => rememberNavigationEntry({ discoveryQuery: filterKey, discoveryPageCount: pageCount });
  const openItem = (item: DoubanItem) => {
    rememberFeed();
    onOpen(item, items);
  };

  return (
    <section className="tv-discovery" aria-label={`${label}片库`} data-discovery-category={filters.category}>
      {showHeading && (
        <div className="tv-discovery__heading">
          <div>
            <p className="tv-discovery__eyebrow">发现下一部好故事</p>
            <h1>{label}</h1>
            <p className="tv-discovery__description">向下浏览，让喜欢的故事慢慢出现。</p>
          </div>
          <NavigationPageLink href={`/browse/${filters.category}`} className="tv-discovery__all" onClick={() => { rememberFeed(); }} aria-label={`全部${label}，进入筛选页`}>
            全部<span aria-hidden="true">↗</span>
          </NavigationPageLink>
        </div>
      )}

      {!checked || (verified && query.isPending) ? (
        <div className="tv-discovery-grid" aria-busy="true" aria-label={`正在加载${label}`}>
          {Array.from({ length: PAGE_SIZE }, (_, index) => <div className="tv-discovery-skeleton" key={index}><div className="tv-ranking-skeleton" /><span /><span /></div>)}
        </div>
      ) : !verified ? (
        <EmptyState title="验证后即可浏览片库"
          description="通过访问验证后，继续挑选喜欢的影片。"
          action={<button type="button" className="btn-primary" onClick={openLogin}>访问验证</button>} />
      ) : query.isError && items.length === 0 ? (
        <EmptyState title={`${label}片库暂时未能加载`} description="请稍后重试。"
          action={<button type="button" className="btn-ghost" onClick={() => void query.refetch()} disabled={isFetching}>{isFetching ? '正在加载…' : '重新加载'}</button>} />
      ) : (
        <>
          <div className="tv-discovery__status" role="status" aria-live="polite">
            {items.length > 0 ? `已展示 ${items.length} 部${label}` : hasNextPage ? '正在查找更多内容…' : ''}
          </div>
          {items.length > 0 ? (
            <div className="tv-discovery-grid" role="list" aria-label={`${label}海报列表`}>
              {items.map((item, index) => <div role="listitem" key={item.id}><DiscoveryCard item={item} eager={index < 6} onClick={() => openItem(item)} /></div>)}
            </div>
          ) : !hasNextPage && (
            <EmptyState title="没有找到符合条件的内容" description="试试其他类型、地区或年份。"
              action={onReset ? <button type="button" className="btn-ghost" onClick={onReset}>重置筛选</button> : undefined} />
          )}
          <div ref={sentinelRef} className="tv-discovery__more" data-discovery-sentinel="" aria-live="polite">
            {isFetchingNextPage ? <span className="inline-flex items-center gap-2"><Spinner size="sm" />正在加载更多…</span>
              : hasNextPage ? <>
                {isFetchNextPageError && <p role="alert">下一页暂时未能加载，已展示的内容仍可浏览。</p>}
                <button type="button" className="btn-ghost" onClick={() => void fetchNextPage()} disabled={isFetching}>
                  {isFetchNextPageError ? '重试加载' : '加载更多'}
                </button>
                {!isFetchNextPageError && <span className="tv-discovery__scroll-hint">继续下滑，自动加载</span>}
              </> : items.length > 0 ? <span>已经看到当前片库的最后一部了</span> : null}
          </div>
        </>
      )}
    </section>
  );
}
