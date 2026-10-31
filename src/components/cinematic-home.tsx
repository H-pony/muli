'use client';

import Link from 'next/link';
import { NavigationWatchLink } from './navigation-watch-link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useLiveQuery } from 'dexie-react-hooks';
import { ContentRail } from './content-rail';
import { RankingCard } from './video-card';
import { SmartImage } from './smart-image';
import { useAppStore } from '@/lib/store';
import { db, type HistoryEntry } from '@/lib/db';
import type { DoubanItem } from '@/lib/types';
import { buildImageUrl } from '@/lib/utils';
import { detailPlaybackAction } from '@/lib/detail-playback';

export function FeaturedPremiere({ onOpen }: { onOpen: (item: DoubanItem, related: DoubanItem[]) => void }) {
  const query = useQuery({
    queryKey: ['hot-list', 'douban_movie_weekly'],
    queryFn: ({ signal }) => api.hotList('douban_movie_weekly', signal),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const items = query.data?.items.slice(0, 5) ?? [];
  const [index, setIndex] = useState(0);
  const featured = items[index % Math.max(items.length, 1)];
  const detail = useQuery({
    queryKey: ['catalog', featured?.id],
    queryFn: ({ signal }) => api.catalog(featured!.id, signal),
    enabled: Boolean(featured && /^\d{1,12}$/.test(featured.id)),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const film = featured ? { ...featured, ...detail.data?.item } : null;
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const coverBackground = buildImageUrl(film?.cover, imageProxyMode, customImageProxy);
  const description = film?.description?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();

  return (
    <section className="tv-premiere" aria-roledescription="轮播" aria-label="为你精选" onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) return;
      const firstCard = event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-tv-shelf] [data-tv-card]');
      if (firstCard) { event.preventDefault(); firstCard.focus({ preventScroll: true }); firstCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
    }}>
      <div className="tv-premiere__art" key={film?.id ?? 'atmosphere'} aria-hidden="true" style={coverBackground ? { backgroundImage: `url(${JSON.stringify(coverBackground)})` } : undefined}>
        {film ? <SmartImage url={film.backdrop || film.cover} mode={imageProxyMode} customProxy={customImageProxy} alt="" loading="eager" /> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/artwork/atmosphere-mountains.jpg" alt="" width={1920} height={1080} loading="eager" />
        )}
      </div>
      <div className="tv-premiere__shade" />
      <div className="tv-premiere__content">
        <p className="tv-premiere__eyebrow"><span />{film ? '本周精选' : '幕里 · 你的专属影院'}</p>
        <h2 className="tv-premiere__title">{film?.title || <>好故事，<br />就在此刻。</>}</h2>
        <div className="tv-premiere__meta">
          {film ? <><span>{film.year || '电影'}</span>{film.genres?.slice(0, 2).map((genre) => <span key={genre}>{genre}</span>)}{film.rating && <span className="tv-premiere__rating">豆瓣 {film.rating}</span>}</> : <span>电影 · 剧集 · 电视直播</span>}
        </div>
        <p className="tv-premiere__description line-clamp-2">{description || (film ? '从本周口碑佳作开始，发现下一部值得沉浸的好故事。' : '从喜欢的电影到正在热播的剧集，留一点时间，给一段好故事。')}</p>
        <div className="tv-premiere__actions">
          {film ? <button type="button" className="tv-premiere__play" onClick={() => onOpen(film, items)}><PlayMark />查看影片</button> : <Link href="/?view=movies" className="tv-premiere__play"><PlayMark />探索电影</Link>}
          <Link href="/?view=tv" className="tv-premiere__explore">探索剧集 <span aria-hidden="true">›</span></Link>
        </div>
      </div>
      <span className="tv-premiere__signature" aria-hidden="true">幕里</span>
      {items.length > 1 && <div className="tv-premiere__pagination" role="group" aria-label="切换精选影片">
        {items.map((item, itemIndex) => <button type="button" key={item.id} className={itemIndex === index % items.length ? 'is-active' : undefined} onClick={() => setIndex(itemIndex)} aria-label={`精选 ${itemIndex + 1}：${item.title}`} aria-pressed={itemIndex === index % items.length}><span /></button>)}
        <span className="tv-premiere__count">{String(index % items.length + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
      </div>}
    </section>
  );
}

function historyHref(entry: HistoryEntry) {
  const action = detailPlaybackAction(entry, Math.max(1, entry.totalEpisodes));
  const params = new URLSearchParams({
    source: entry.sourceKey,
    index: String(action.index),
    title: entry.title,
  });
  const directUrl = entry.directUrl || (/^https?:\/\//i.test(entry.vodId) ? entry.vodId : undefined);
  if (directUrl) params.set('url', directUrl);
  else params.set('id', entry.vodId);
  if (entry.sourceUrl) params.set('sourceUrl', entry.sourceUrl);
  if (action.restart) params.set('position', '0');
  else if (entry.playbackPosition > 0) params.set('position', String(Math.floor(entry.playbackPosition)));
  return `/watch?${params.toString()}`;
}

export function ContinueWatchingSection() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(10).toArray().catch(() => []), []);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  if (!history?.length) return null;

  return (
    <ContentRail title="继续观看" subtitle="接着上次的故事" className="tv-rail--continue">
      {history.map((entry) => {
        const progress = entry.duration > 0 ? Math.min(100, Math.max(0, entry.playbackPosition / entry.duration * 100)) : 0;
        const action = detailPlaybackAction(entry, Math.max(1, entry.totalEpisodes));
        const episode = action.label;
        const minutes = Math.floor(entry.playbackPosition / 60);
        return (
          <NavigationWatchLink key={entry.id} href={historyHref(entry)} className="tv-continue-card" data-tv-card aria-label={`${action.label} ${entry.title}`}>
            <div className="tv-continue-card__art">
              <SmartImage url={entry.pic} mode={imageProxyMode} customProxy={customImageProxy} alt="" />
              <div className="tv-continue-card__veil" />
              <span className="tv-continue-card__play"><PlayMark /></span>
            </div>
            <div className="tv-continue-card__body">
              <h3 className="tv-continue-card__title">{entry.title}</h3>
              <p className="tv-continue-card__meta">{episode}{!action.restart && minutes > 0 ? ` · 已看 ${minutes} 分钟` : ''}</p>
            </div>
            <div className="tv-continue-card__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          </NavigationWatchLink>
        );
      })}
    </ContentRail>
  );
}

export function WatchlistSection({ onOpen }: { onOpen: (item: DoubanItem, related: DoubanItem[]) => void }) {
  const entries = useLiveQuery(() => db.watchlist.orderBy('addedAt').reverse().toArray().catch(() => []), []);
  const items = entries?.map((entry) => entry.item) ?? [];
  return (
    <div id="my-watchlist" className="tv-watchlist-section">
      {entries?.length ? <ContentRail title="我的片单" subtitle="留给下一次的好故事" className="tv-rail--watchlist">
        {entries.map((entry) => <RankingCard key={entry.id} item={entry.item} onClick={() => onOpen(entry.item, items)} />)}
      </ContentRail> : <div className="tv-watchlist-empty"><span aria-hidden="true">＋</span><div><h2>你的下一部，先放进片单。</h2><p>在影片详情中点按“加入片单”，喜欢的故事就会出现在这里。</p></div><Link href="/?view=movies">发现好电影 <span aria-hidden="true">›</span></Link></div>}
    </div>
  );
}

export function LiveRibbon() {
  return (
    <Link href="/live" className="tv-live-ribbon" aria-label="打开电视直播">
      <span className="tv-live-ribbon__mark"><ScreenMark className="h-6 w-6" /></span>
      <div className="tv-live-ribbon__body">
        <h2>打开电视，遇见此刻。</h2>
        <p>新闻、纪录片与地方频道，换一种方式享受大屏时光。</p>
      </div>
      <span className="tv-live-ribbon__live"><span className="h-1.5 w-1.5 rounded-full bg-current" />LIVE</span>
      <svg className="h-4 w-4 text-muted ml-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Link>
  );
}

function PlayMark({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.5-.86l12 7.5a1 1 0 0 1 0 1.72l-12 7.5A1 1 0 0 1 7 19.5Z" /></svg>;
}

function ScreenMark({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true"><rect x="3" y="4.5" width="18" height="13.5" rx="2.5" strokeWidth="1.6" /><path d="M9 21h6M10 8.5l5.5 3-5.5 3Z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
