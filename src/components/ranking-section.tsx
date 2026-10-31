'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import type { DoubanItem } from '@/lib/types';
import { ContentRail } from './content-rail';
import { RankingCard } from './video-card';

export type CatalogCategory = 'all' | 'movies' | 'tv' | 'shows';

export const RANKING_LISTS = [
  { id: 'douban_movie_weekly', title: '本周电影榜', label: '豆瓣口碑榜', category: 'movies' },
  { id: 'douban_tv_chinese', title: '热门电视剧', label: '豆瓣华语剧集榜', category: 'tv' },
  { id: 'douban_show_chinese', title: '综艺热播榜', label: '豆瓣国内综艺榜', category: 'shows' },
  { id: 'douban_tv_global', title: '海外好剧', label: '豆瓣全球剧集榜', category: 'tv' },
  { id: 'douban_show_global', title: '海外综艺', label: '豆瓣全球综艺榜', category: 'shows' },
  { id: 'baidu_teleplay', title: '大家都在追', label: '百度热播剧榜', category: 'tv' },
] as const;

export interface RankingSectionProps {
  category?: CatalogCategory;
  onOpen: (item: DoubanItem, related: DoubanItem[]) => void;
  afterFirst?: ReactNode;
}

/** 每个榜单独立请求：一个来源失败不会挡住其他海报横排。 */
export function RankingSection({ category = 'all', onOpen, afterFirst }: RankingSectionProps) {
  const lists = RANKING_LISTS.filter((list) => category === 'all' || list.category === category);
  return (
    <div className="tv-ranking-section" aria-label="影视排行榜">
      {lists.map((list, index) => (
        <div className="tv-ranking-section__row" key={list.id}>
          <RankingRail list={list} onOpen={onOpen} priority={index === 0} />
          {index === 0 && afterFirst}
        </div>
      ))}
    </div>
  );
}

function RankingRail({ list, onOpen, priority }: {
  list: (typeof RANKING_LISTS)[number];
  onOpen: RankingSectionProps['onOpen'];
  priority: boolean;
}) {
  const query = useQuery({
    queryKey: ['hot-list', list.id],
    queryFn: ({ signal }) => api.hotList(list.id, signal),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const items = query.data?.items ?? [];

  return (
    <ContentRail title={list.title} subtitle={list.label} className={priority ? 'tv-rail--ranking tv-rail--featured' : 'tv-rail--ranking'} allHref={`/browse/${list.category}`}>
      {query.isLoading ? Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="tv-ranking-skeleton" aria-hidden="true" />
      )) : query.isError || items.length === 0 ? (
        <div className="tv-ranking-error" role="status">
          <span>{query.isError ? '榜单暂时未能加载' : '这个榜单暂时没有内容'}</span>
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? '正在加载…' : '重新加载'}
          </button>
        </div>
      ) : items.map((item, index) => (
        <RankingCard
          key={item.id}
          item={item}
          rank={item.rank ?? index + 1}
          eager={priority && index < 7}
          onClick={() => onOpen(item, items)}
        />
      ))}
    </ContentRail>
  );
}
