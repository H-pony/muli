'use client';

import { useBodyScrollLock } from './use-body-scroll-lock';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '@/lib/client-api';
import type { DoubanItem, SearchResultItem } from '@/lib/types';
import { buildWatchUrl, cn, validateSourceUrl } from '@/lib/utils';
import { prepareWatchNavigation, readNavigationLayer, updateNavigationLayerUi } from '@/lib/navigation';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { addSearchHistory, db } from '@/lib/db';
import { copyToClipboard } from '@/lib/clipboard';
import { SmartImage } from './smart-image';
import { DetailBackdrop, useBackdropArtwork } from './detail-backdrop';
import { artworkYear, inferArtworkMediaType } from '@/lib/artwork';
import { detailPlaybackAction, matchingPlaybackCandidates } from '@/lib/detail-playback';
import { useToast } from './toast';
import { isTopFocusLayer, useFocusTrap } from './use-focus-trap';
import { ContentRail } from './content-rail';
import { RankingCard } from './video-card';
import { Icon } from './icon';

interface DetailModalProps {
  item: SearchResultItem | null;
  catalogItem?: DoubanItem | null;
  relatedItems?: DoubanItem[];
  onClose: () => void;
  onPickRelated?: (item: DoubanItem, related: DoubanItem[]) => void;
  onSearch?: (title: string) => void;
  navigationId?: string;
}

interface DetailViewState {
  selected?: SearchResultItem | null;
  searchEnabled?: boolean;
  reversed?: boolean;
  fullCast?: boolean;
  expandedDescription?: boolean;
}

function catalogIdentity(item: DoubanItem) {
  return item.id.startsWith('baidu_') ? `baidu:${item.title}` : item.id;
}

/** 榜单与搜索共用沉浸式详情，播放源和集数仍走原有播放接口。 */
export function DetailModal(props: DetailModalProps) {
  if (!props.item && !props.catalogItem) return null;
  const key = props.navigationId || (props.catalogItem ? `catalog:${catalogIdentity(props.catalogItem)}` : `${props.item!.sourceKey}:${props.item!.vodId}`);
  return <DetailView key={key} {...props} />;
}

function cleanText(value?: string) {
  return value?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() || '';
}

function names(value?: string) {
  return value?.split(/[,，、/|;；]+/).map((name) => name.trim()).filter(Boolean) ?? [];
}

function DetailView({ item, catalogItem, relatedItems = [], onClose, onPickRelated, onSearch }: DetailModalProps) {
  const store = useAppStore();
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<HTMLElement>(null);
  const restored = readNavigationLayer<unknown>('detail')?.ui as DetailViewState | undefined;
  const [selected, setSelected] = useState<SearchResultItem | null>(restored?.selected ?? item);
  const [searchEnabled, setSearchEnabled] = useState(restored?.searchEnabled ?? false);
  const [reversed, setReversed] = useState(restored?.reversed ?? false);
  const [fullCast, setFullCast] = useState(restored?.fullCast ?? false);
  const [expandedDescription, setExpandedDescription] = useState(restored?.expandedDescription ?? false);
  useEffect(() => {
    updateNavigationLayerUi('detail', { selected, searchEnabled, reversed, fullCast, expandedDescription });
  }, [selected, searchEnabled, reversed, fullCast, expandedDescription]);
  const [posterFailed, setPosterFailed] = useState(false);
  const title = catalogItem?.title || item?.name || '';
  useFocusTrap(true, panelRef);
  useBodyScrollLock(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopFocusLayer(panelRef.current)) { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const catalogQuery = useQuery({
    queryKey: ['catalog', catalogItem?.id],
    queryFn: ({ signal }) => api.catalog(catalogItem!.id, signal),
    enabled: Boolean(catalogItem && /^\d{1,12}$/.test(catalogItem.id)),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const film = { ...catalogItem, ...catalogQuery.data?.item };
  const watchlistId = catalogItem ? catalogIdentity(catalogItem) : undefined;
  const saved = useLiveQuery(() => watchlistId ? db.watchlist.get(watchlistId).catch(() => undefined) : undefined, [watchlistId]);
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return store.selectedKeys
      .map((key) => resolveSource(store, key))
      .filter((source): source is NonNullable<typeof source> => {
        if (!source || seen.has(source.key) || !validateSourceUrl(source.url)) return false;
        seen.add(source.key);
        return !(store.yellowFilter && source.isAdult)
          && !isSourceDisabled(store, source.key)
          && !isInDisabledSubscription(store, source.key);
      });
  }, [store]);

  const searchQuery = useQuery({
    queryKey: ['catalog-playback', title, sources.map((source) => [source.key, source.name, source.url, source.detail]), store.yellowFilter],
    queryFn: ({ signal }) => api.search(title, sources, store.yellowFilter, { signal }),
    enabled: searchEnabled && sources.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const playbackCandidates = useMemo(() => matchingPlaybackCandidates(searchQuery.data?.list ?? [], {
    title, year: film.year || item?.year, kind: film.kind || inferArtworkMediaType(item?.typeName), doubanId: catalogItem && /^\d+$/.test(catalogItem.id) ? catalogItem.id : item?.doubanId,
  }), [searchQuery.data, title, film.year, film.kind, catalogItem, item]);

  useEffect(() => {
    if (!searchQuery.data || selected || catalogQuery.isFetching) return;
    const year = artworkYear(film.year);
    const years = new Set(playbackCandidates.map((result) => artworkYear(result.year)).filter(Boolean));
    // Unknown years remain explicit choices; never automatically pick an unverified remake.
    const exact = year ? playbackCandidates.find((result) => artworkYear(result.year) === year)
      : years.size <= 1 ? playbackCandidates[0] : undefined;
    if (exact) setSelected(exact);
  }, [searchQuery.data, selected, film.year, catalogQuery.isFetching, playbackCandidates]);

  const selectedSource = selected ? resolveSource(store, selected.sourceKey, { url: selected.sourceUrl, name: selected.sourceName }) : undefined;
  const detailQuery = useQuery({
    queryKey: ['video-detail', selected?.sourceKey, selected?.vodId, selectedSource?.url, selectedSource?.detail],
    queryFn: ({ signal }) => api.detail(selected!.vodId, selectedSource!, signal),
    enabled: Boolean(selected && selectedSource),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const detail = detailQuery.data;
  const info = detail?.videoInfo;
  const cover = film.cover || info?.cover || item?.pic;
  const artwork = useBackdropArtwork({
    title, year: film.year || info?.year || item?.year,
    mediaType: film.kind ? (film.kind === 'movie' ? 'movie' : 'tv') : film.isTv ? 'tv' : inferArtworkMediaType(info?.typeName || item?.typeName),
    doubanId: catalogItem && /^\d+$/.test(catalogItem.id) ? catalogItem.id : info?.doubanId || item?.doubanId,
    tmdbId: info?.tmdbId || item?.tmdbId, imdbId: info?.imdbId || item?.imdbId,
  });
  const description = cleanText(film.description || info?.desc);
  const genres = film.genres?.length ? film.genres : (info?.typeName || item?.typeName ? [info?.typeName || item!.typeName!] : []);
  const directors = film.directors?.length ? film.directors : names(info?.director);
  const actors = film.actors?.length ? film.actors : names(info?.actor);
  const kind = film.kind === 'show' ? '综艺' : film.kind === 'tv' || film.isTv ? '剧集' : '电影';
  const meta = [film.countries?.join(' / ') || info?.area || item?.area, film.year || info?.year || item?.year, film.duration || (detail?.episodes.length && detail.episodes.length > 1 ? `${detail.episodes.length} 集` : '')].filter(Boolean);
  const related = relatedItems.filter((candidate) => !catalogItem || catalogIdentity(candidate) !== catalogIdentity(catalogItem));
  const episodeCount = detail?.episodes.length ?? 0;
  const history = useLiveQuery(() => selected ? db.history.get(`${selected.sourceKey}_${selected.vodId}`).catch(() => undefined) : undefined, [selected?.sourceKey, selected?.vodId]);
  const playbackAction = detailPlaybackAction(history, episodeCount);
  const playbackPending = searchQuery.isFetching || detailQuery.isFetching;
  const primaryLabel = detailQuery.isFetching ? '正在获取剧集…' : searchQuery.isFetching ? '正在查找播放源…'
    : episodeCount ? playbackAction.label : detailQuery.isError ? '重新加载剧集' : searchQuery.isError ? '重新查找播放源' : '查找播放源';
  const episodes = Array.from({ length: episodeCount }, (_, index) => index);
  if (reversed) episodes.reverse();

  const play = (index: number, restart = false) => {
    if (!selected || !detail?.episodes[index]) return;
    void addSearchHistory(title).catch(() => {});
    router.push(prepareWatchNavigation(buildWatchUrl({ sourceKey: selected.sourceKey, vodId: selected.vodId, index, title: selected.name, sourceUrl: selected.sourceUrl, position: restart ? 0 : undefined })));
  };
  const scrollToPlayback = () => {
    if (sources.length > 0 && (searchQuery.isError || (searchQuery.data && playbackCandidates.length === 0)) && !searchQuery.isFetching) void searchQuery.refetch();
    setSearchEnabled(true);
    window.requestAnimationFrame(() => playbackRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  };
  const toggleWatchlist = async () => {
    if (!catalogItem || !watchlistId) return;
    try {
      if (saved) await db.watchlist.delete(watchlistId);
      else await db.watchlist.put({ id: watchlistId, item: { ...catalogItem, ...film }, addedAt: Date.now() });
      toast(saved ? '已从片单移除' : '已加入我的片单', 'success');
    } catch {
      toast('片单保存失败，请检查浏览器存储权限', 'error');
    }
  };
  const configureSources = () => {
    onClose();
    window.dispatchEvent(new CustomEvent('kongwotv:open-settings'));
  };

  return (
    <div className="tv-film-detail" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title} 详情`}>
      <div className="tv-film-detail__backdrop" aria-hidden="true">
        <DetailBackdrop key={`${title}|${film.year || info?.year || item?.year || ''}`} artwork={artwork} backdrop={film.backdrop} cover={cover}
          mode={store.imageProxyMode} customProxy={store.customImageProxy} />
      </div>
      <div className="tv-film-detail__inner">
        <div className="tv-film-detail__topbar">
          <button type="button" className="tv-film-detail__icon" onClick={onClose} aria-label="返回上一页"><Icon name="back" /></button>
          <span className="tv-film-detail__wordmark">幕里<span>影片详情</span></span>
          <div className="tv-film-detail__tools">
            {onSearch && <button type="button" className="tv-film-detail__icon" onClick={() => onSearch(title)} aria-label={`搜索《${title}》`}><Icon name="search" /></button>}
            <button type="button" className="tv-film-detail__icon" onClick={configureSources} aria-label="播放源设置"><Icon name="gear" /></button>
          </div>
        </div>

        <section className="tv-film-detail__overview" aria-label="影片信息">
          <div className="tv-film-detail__poster">
            {cover && !posterFailed ? <SmartImage url={cover} mode={store.imageProxyMode} customProxy={store.customImageProxy} alt={`${title}海报`} loading="eager" onExhausted={() => setPosterFailed(true)} /> : <span className="tv-film-detail__poster-placeholder"><Icon name="film" /><span>{title}</span></span>}
          </div>
          <div className="tv-film-detail__info">
            <div className="tv-film-detail__genres">{(genres.length ? genres.slice(0, 4) : [kind]).map((genre) => <span key={genre}>{genre}</span>)}</div>
            <h1>{title}</h1>
            <p className="tv-film-detail__meta">{meta.length ? meta.join(' · ') : kind}{film.rank ? <span>榜单第 {film.rank} 名</span> : null}</p>
            <div className="tv-film-detail__synopsis">
              {description ? <><p className={cn(!expandedDescription && 'line-clamp-5')}>{description}</p>{description.length > 180 && <button type="button" onClick={() => setExpandedDescription((value) => !value)}>{expandedDescription ? '收起剧情' : '展开剧情'}</button>}</> : <p className="tv-film-detail__muted">{catalogQuery.isFetching || detailQuery.isFetching ? '正在载入影片介绍…' : '暂无剧情介绍，播放源可用时会补充更多影片信息。'}</p>}
            </div>
            <div className="tv-film-detail__actions">
              <button type="button" className="tv-film-detail__play" disabled={playbackPending} aria-busy={playbackPending} onClick={() => episodeCount ? play(playbackAction.index, playbackAction.restart) : detailQuery.isError ? void detailQuery.refetch() : scrollToPlayback()}><Icon name="play" />{primaryLabel}</button>
              {catalogItem && <button type="button" className={cn('tv-film-detail__save', saved && 'is-saved')} onClick={() => void toggleWatchlist()} aria-pressed={Boolean(saved)}><BookmarkIcon saved={Boolean(saved)} />{saved ? '已加入片单' : '加入片单'}</button>}
            </div>
          </div>
          <aside className="tv-film-detail__sidebar" aria-label="评分与演职员">
            <div className="tv-film-detail__score">
              {film.rating ? <><div><strong>{film.rating}</strong><span>/10</span></div><p>豆瓣评分{film.ratingCount ? ` · ${new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(film.ratingCount)} 人评价` : ''}</p></> : <><div><strong className="tv-film-detail__unrated">暂无评分</strong></div><p>发现下一部好故事</p></>}
            </div>
            {(directors.length > 0 || actors.length > 0) ? <>
              <div className="tv-film-detail__cast">
                {directors.length > 0 && <div><h2>导演</h2>{directors.map((name) => <PersonRow key={name} name={name} />)}</div>}
                {actors.length > 0 && <div><h2>主演</h2>{(fullCast ? actors : actors.slice(0, 3)).map((name, index) => <PersonRow key={`${name}:${index}`} name={name} />)}</div>}
              </div>
              {actors.length > 3 && <button type="button" className="tv-film-detail__cast-toggle" onClick={() => setFullCast((value) => !value)} aria-expanded={fullCast}>{fullCast ? '收起演职员' : `查看全部 ${actors.length} 位主演`}</button>}
            </> : <div className="tv-film-detail__cast tv-film-detail__cast--empty"><h2>演职员</h2><p>{catalogQuery.isFetching ? '正在加载…' : '暂无演职员信息'}</p></div>}
          </aside>
        </section>

        {(selected || searchEnabled) && <section className="tv-detail-playback" ref={playbackRef} aria-label="播放来源与剧集">
          <div className="tv-detail-playback__heading"><div><h2>{episodeCount ? '选择剧集' : selected ? '剧集信息' : '查找播放来源'}</h2><p>{selected ? `${selected.sourceName}${episodeCount ? ` · 共 ${episodeCount} 集` : ''}` : '按片名与年份匹配，确认后播放'}</p></div>{selected && !searchEnabled && <button type="button" className="tv-detail-playback__tool" onClick={() => setSearchEnabled(true)}>查找其他来源</button>}</div>
          {searchEnabled && sources.length === 0 && <div className="tv-detail-playback__notice"><p>添加并勾选播放源后，就能搜索这部影片的播放资源。</p><button type="button" onClick={configureSources}>添加播放源 <span aria-hidden="true">↗</span></button></div>}
          {searchEnabled && searchQuery.isFetching && <p className="tv-detail-playback__status" role="status">正在搜索播放来源…</p>}
          {searchEnabled && searchQuery.isError && <div className="tv-detail-playback__notice" role="status"><p>播放来源搜索失败，请稍后重试。</p><button type="button" onClick={() => void searchQuery.refetch()}>重试</button></div>}
          {searchEnabled && searchQuery.data && <>
            {playbackCandidates.length > 0 ? <div className="tv-detail-playback__sources" role="group" aria-label="选择播放来源">{playbackCandidates.map((result) => <button type="button" key={`${result.sourceKey}:${result.vodId}`} className={cn(selected?.sourceKey === result.sourceKey && selected?.vodId === result.vodId && 'is-active')} onClick={() => setSelected(result)} aria-pressed={selected?.sourceKey === result.sourceKey && selected?.vodId === result.vodId}><span>{result.sourceName}</span>{result.name !== title && <small>{result.name}</small>}<small>{result.year || '年份待核对'}</small>{result.remarks && <small>{result.remarks}</small>}</button>)}</div> : <div className="tv-detail-playback__notice" role="status"><p>{searchQuery.data.list.length > 0 && playbackCandidates.length === 0 ? `只找到同名或相关的其他作品，尚未找到《${title}》${film.year ? `（${film.year}）` : ''}的匹配播放源。` : searchQuery.data.failures.length >= sources.length && sources.length > 0 ? '播放源暂时没有响应，请稍后重新搜索，或在设置中检查播放源。' : `当前播放源没有找到《${title}》，可以重新搜索或换个来源再试试。`}</p><button type="button" onClick={() => void searchQuery.refetch()} disabled={searchQuery.isFetching}>重新搜索</button></div>}
            {playbackCandidates.some((result) => !artworkYear(result.year)) && <p className="tv-detail-playback__status">部分来源未提供年份，请核对片名与内容后选择。</p>}
            {searchQuery.data.failures.length > 0 && <p className="tv-detail-playback__status">{searchQuery.data.failures.length} 个来源暂不可用，其余搜索结果仍可选择。</p>}
          </>}
          {detailQuery.isFetching && <p className="tv-detail-playback__status" role="status">正在获取剧集信息…</p>}
          {selected && !selectedSource && <div className="tv-detail-playback__notice"><p>这个播放源的配置已移除，请重新添加或选择其他来源。</p><button type="button" onClick={configureSources}>管理播放源</button></div>}
          {detailQuery.isError && <div className="tv-detail-playback__notice" role="status"><p>{detailQuery.error instanceof Error ? detailQuery.error.message : '剧集加载失败'}</p><button type="button" onClick={() => void detailQuery.refetch()}>重新加载</button></div>}
          {episodeCount > 0 && <>
            <div className="tv-detail-playback__toolbar"><span>{selected?.name !== title ? selected?.name : '全部剧集'}</span><div><button type="button" onClick={() => setReversed((value) => !value)} aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}><Icon name="arrowDown" className={cn('h-3.5 w-3.5', reversed && 'rotate-180')} />{reversed ? '正序排列' : '倒序排列'}</button><button type="button" onClick={async () => { const ok = await copyToClipboard(detail!.episodes.join('\n')); toast(ok ? '播放链接已复制' : '复制失败，请检查浏览器权限', ok ? 'success' : 'error'); }}>复制链接</button></div></div>
            <div className="tv-detail-playback__episodes">{episodes.map((index) => <button type="button" key={index} onClick={() => play(index)} aria-label={`播放第 ${index + 1} 集`}>{episodeCount === 1 ? <><Icon name="play" />正片</> : String(index + 1).padStart(2, '0')}</button>)}</div>
          </>}
          {detail && episodeCount === 0 && <p className="tv-detail-playback__status" role="status">这个来源暂时没有可播放的剧集，请选择其他来源。</p>}
        </section>}

        {related.length > 0 && onPickRelated && <div className="tv-film-detail__related"><ContentRail title="更多值得看" subtitle="同榜好片，为下一次观影留一点期待">{related.map((candidate) => <RankingCard key={catalogIdentity(candidate)} item={candidate} onClick={() => onPickRelated(candidate, relatedItems)} />)}</ContentRail></div>}
      </div>
    </div>
  );
}

function PersonRow({ name }: { name: string }) {
  return <div className="tv-film-detail__person"><span aria-hidden="true">{Array.from(name)[0]}</span><p>{name}</p></div>;
}

function BookmarkIcon({ saved }: { saved: boolean }) {
  return <svg viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" /></svg>;
}
