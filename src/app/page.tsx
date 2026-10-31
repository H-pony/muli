'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { RecommendSection } from '@/components/douban-section';
import { DetailModal } from '@/components/detail-modal';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { DoubanItem, SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { cn, formatDisableTtl, validateSourceUrl } from '@/lib/utils';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/states';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';
import { ContinueWatchingSection, FeaturedPremiere, LiveRibbon, WatchlistSection } from '@/components/cinematic-home';
import { RankingSection, type CatalogCategory } from '@/components/ranking-section';
import { DiscoveryFeed } from '@/components/discovery-feed';
import { defaultDiscoveryFilters } from '@/lib/discovery-model';
import { readNavigationEntry, rememberNavigationEntry } from '@/lib/navigation';
import { useNavigationLayer, useNavigationScrollRestoration } from '@/lib/navigation-hooks';

/**
 * 首页：搜索（URL ?s= 驱动，可后退/分享）+ 豆瓣推荐。
 * 搜索状态由 React Query 管理，失败源在结果区顶部以非阻塞方式展示。
 */
/** 搜索结果分批渲染的批大小：一次挂载上千张卡片会明显掉帧 */
const RESULT_PAGE_SIZE = 60;

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const urlQuery = searchParams.get('s') || '';
  const view = searchParams.get('view');
  const category: CatalogCategory = view === 'movies' || view === 'tv' || view === 'shows' ? view : 'all';
  const browsing = category !== 'all';
  // 精确订阅所需字段（对齐 live 页的做法）：搜索流式期间逐源写健康度、
  // 打开设置抽屉/历史面板等无关 store 变化，都不应触发首页整树重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const [input, setInput] = useState(urlQuery);
  const detailNavigation = useNavigationLayer<{ item: SearchResultItem | null; catalogItem: DoubanItem | null; relatedItems: DoubanItem[] }>('detail');
  const detailItem = detailNavigation.layer?.data.item ?? null;
  const catalogItem = detailNavigation.layer?.data.catalogItem ?? null;
  const relatedItems = detailNavigation.layer?.data.relatedItems ?? [];
  useNavigationScrollRestoration();
  const supplementalEnabled = useAppStore((s) => s.doubanEnabled && s.recommendSource !== 'hot-list');
  const openCatalog = (item: DoubanItem, related: DoubanItem[]) => {
    rememberNavigationEntry({ homeVisibleCount: visibleCount });
    detailNavigation.open({ item: null, catalogItem: item, relatedItems: related });
  };
  const openResult = (item: SearchResultItem) => {
    rememberNavigationEntry({ homeVisibleCount: visibleCount });
    detailNavigation.open({ item, catalogItem: null, relatedItems: [] });
  };
  /** 流式搜索中已结算的源（data 就绪前用于增量渲染） */
  const [streamed, setStreamed] = useState<{ key: string; outcomes: SourceSearchOutcome[] }>({ key: '', outcomes: [] });
  const inputRef = useRef<HTMLInputElement>(null);

  // URL 驱动搜索：?s= 变化时回填输入框
  useEffect(() => {
    setInput(urlQuery);
  }, [urlQuery]);

  // 源名回显：失败/停用提示里显示友好名称而非裸 key
  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ??
    envSources.find((a) => a.key === key)?.name ??
    key;

  const selectedSources = useMemo(() => {
    // selectedKeys 可能含历史残留的重复 key：按 key 去重，避免同源重复搜索
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      // 自动停用期内的源不参与搜索（到期自动恢复）
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      // 所属订阅被整体停用的源同样跳过（无损：各源勾选状态保留，重新启用即恢复）
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
  const disabledSources = useMemo(
    () => selectedKeys.filter((key) => isSourceDisabled({ sourceHealth }, key)),
    [selectedKeys, sourceHealth]
  );
  // 来自已关闭订阅的源：勾选状态还在，但本次搜索用不到，必须明确告知
  const offSubscriptionSources = useMemo(
    () =>
      selectedKeys.filter(
        (key) => !isSourceDisabled({ sourceHealth }, key) && isInDisabledSubscription({ subscriptions }, key)
      ),
    [selectedKeys, sourceHealth, subscriptions]
  );

  // Include configuration identity, but not health updates produced by this request itself.
  const searchIdentity = JSON.stringify([urlQuery, selectedKeys, customAPIs, envSources, subscriptions.map((item) => [item.url, item.enabled]), yellowFilter]);
  const streamedOutcomes = useMemo(() => streamed.key === searchIdentity ? streamed.outcomes : [], [streamed, searchIdentity]);
  const searchQuery = useQuery({
    queryKey: ['search', searchIdentity],
    // 与 runSearch 的截断规则保持一致：顶栏搜索 / 手动构造长链接不会绕过上限
    queryFn: ({ signal }) => {
      setStreamed({ key: searchIdentity, outcomes: [] });
      return api.search(urlQuery.slice(0, 100), selectedSources, yellowFilter, {
        signal,
        // 逐源结算即更新：结果边搜边渲染，同时滚动健康度
        onSource: (outcome) => {
          if (signal.aborted) return;
          setStreamed((prev) => ({ key: searchIdentity, outcomes: [...(prev.key === searchIdentity ? prev.outcomes : []), outcome] }));
          for (const ev of useAppStore.getState().recordSourceHealth([outcome])) {
            toast(
              ev.permanent
                ? `「${sourceName(ev.key)}」多次失败，已停止参与搜索，可在设置中恢复`
                : `「${sourceName(ev.key)}」连续超时/失败，已停用 ${formatDisableTtl(ev.ttlMs ?? 0)}`,
              'warning'
            );
          }
        },
      });
    },
    enabled: Boolean(urlQuery) && selectedSources.length > 0,
    // 5 分钟内从播放页返回时直接使用缓存，不重新搜索（服务端另有 60s 结果缓存兜底）
    staleTime: 300_000,
    retry: false,
  });

  // 最近搜索改为搜索框下拉（聚焦展开、按输入过滤），不再常驻首屏
  const searchHistory = useSearchHistory(input);

  const runSearch = (q: string) => {
    const query = q.trim().slice(0, 100);
    if (!query) {
      toast('请输入搜索内容', 'info');
      inputRef.current?.focus();
      return;
    }
    if (selectedSources.length === 0) {
      toast('请先在设置中添加并勾选点播源', 'warning');
      window.dispatchEvent(new CustomEvent('kongwotv:open-settings'));
      return;
    }
    if (query === urlQuery) {
      void searchQuery.refetch();
      return;
    }
    router.push(`/?s=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  const isSearching = Boolean(urlQuery) && searchQuery.isFetching && !searchQuery.data;
  // 聚合数据未就绪时，用已结算源的结果增量渲染（健康源不再等坏源超时）
  const streamedList = useMemo(
    () => streamedOutcomes.flatMap((o) => o.list),
    [streamedOutcomes]
  );
  const list = useMemo(
    () => searchQuery.data?.list ?? streamedList,
    [searchQuery.data, streamedList]
  );
  const failures =
    searchQuery.data?.failures ??
    streamedOutcomes
      .filter((o) => !o.ok)
      .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));
  // 跨源同名聚合：同名影片合并为一张卡片，展开后可选择具体来源
  const groups = useMemo(() => aggregateResults(list), [list]);

  // 分批渲染：新一次搜索（groups 变化）时重置回首批
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  // A history entry remembers how many search cards were loaded; Back must not collapse to page one.
  useEffect(() => {
    const saved = readNavigationEntry()?.data.homeVisibleCount;
    setVisibleCount(typeof saved === 'number' && saved >= RESULT_PAGE_SIZE ? saved : RESULT_PAGE_SIZE);
  }, [urlQuery]);

  return (
    <div className="tv-cinema-root tv-catalog-root min-h-screen flex flex-col">
      <Header activePage={urlQuery ? null : category === 'all' ? 'home' : category} />
      <main id="main-content" tabIndex={-1} className="tv-home-main tv-catalog-main flex-1">
        {urlQuery && (
          <div className="tv-page-heading">
            <div className="tv-page-heading__eyebrow">发现你的下一部好故事</div>
            <h1>搜索结果</h1>
          </div>
        )}

        {urlQuery && <section className={cn('tv-search-dock', 'tv-search-dock--browse')} aria-label="影视搜索">
          <div ref={searchHistory.containerRef} className="relative w-full min-w-0">
            <form className="w-full" onSubmit={(event) => { event.preventDefault(); runSearch(input); }}>
              <div className={cn('tv-search-field', searchHistory.visible && 'tv-search-field--open')}>
                <Icon name="search" className="tv-search-field__icon" />
                <input
                  ref={inputRef}
                  className="flex-1 min-w-0 pr-2 bg-transparent text-sm text-content placeholder:text-faint focus:outline-none"
                  placeholder="搜索电影、电视剧或纪录片"
                  value={input}
                  maxLength={100}
                  onChange={(event) => { setInput(event.target.value); searchHistory.resetActive(); }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(event) => searchHistory.onKeyDown(event, pickHistory)}
                  role="combobox"
                  aria-label="搜索影片"
                  aria-expanded={searchHistory.visible}
                  aria-controls="home-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={searchHistory.visible && searchHistory.activeIndex >= 0 ? `home-search-history-${searchHistory.activeIndex}` : undefined}
                />
                {input && (
                  <button type="button" className="shrink-0 self-center mr-1 p-1.5 rounded-full text-faint hover:text-content hover:bg-hover transition-colors" onClick={() => { setInput(''); searchHistory.resetActive(); inputRef.current?.focus(); }} aria-label="清空">
                    <Icon name="close" className="w-4 h-4" />
                  </button>
                )}
                <button type="submit" className="tv-search-field__submit">搜索</button>
              </div>
            </form>
            {searchHistory.visible && (
              <SearchHistoryDropdown id="home-search-history" matches={searchHistory.matches} activeIndex={searchHistory.activeIndex} onPick={pickHistory} onRemove={searchHistory.remove} onClearAll={searchHistory.clearAll} />
            )}
          </div>
        </section>}

        {urlQuery && (
          <section aria-label="搜索结果" className="mb-12">
            <div className="tv-results-heading">
              <h2>
                “{urlQuery}”
                <span className="tv-results-summary">
                  {isSearching
                    ? `正在搜索 · ${streamedOutcomes.length}/${selectedSources.length} 个来源已就绪`
                    : searchQuery.data ? `${groups.length} 部影片 · ${list.length} 个播放结果` : ''}
                </span>
              </h2>
            </div>
            {failures.length > 0 && (
              <div className="tv-source-notice mb-4 text-xs px-4 py-3 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-muted">{isSearching ? '以下来源暂时无响应：' : '部分来源暂不可用：'}</span>
                {failures.map((failure) => <span key={failure.sourceKey} className={failure.timedOut ? 'text-warning' : 'text-faint'}>{sourceName(failure.sourceKey)}{failure.timedOut ? ' · 超时' : ''}</span>)}
              </div>
            )}
            {disabledSources.length > 0 && (
              <div className="tv-source-notice mb-4 text-xs text-muted px-4 py-3 leading-relaxed">
                {disabledSources.length} 个来源因连续超时或失败已暂停搜索：{disabledSources.map((key) => sourceName(key)).join('、')}。临时停用的会自动恢复，也可以在设置中恢复。
              </div>
            )}
            {offSubscriptionSources.length > 0 && (
              <div className="tv-source-notice mb-4 text-xs text-muted px-4 py-3 leading-relaxed">
                {offSubscriptionSources.length} 个来源的订阅已关闭，未参与这次搜索：{offSubscriptionSources.map((key) => sourceName(key)).join('、')}。可以在设置中重新启用。
              </div>
            )}
            {searchQuery.isError && selectedSources.length > 0 && (
              <div className="tv-source-notice mb-5 px-5 py-4" role="alert">
                <p className="text-sm text-content">搜索未完成{list.length ? '，已找到的结果仍可使用' : ''}。</p>
                <p className="mt-1 text-sm text-muted">请检查网络后重试，或在设置中检查播放来源。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => void searchQuery.refetch()} disabled={searchQuery.isFetching}>重新搜索</button>
                  <button type="button" className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('kongwotv:open-settings'))}>管理播放源</button>
                </div>
              </div>
            )}
            {selectedSources.length === 0 ? (
              <NoSourceGuide hasSources={customAPIs.length > 0 || envSources.length > 0} />
            ) : list.length > 0 ? (
              <>
                <div className="tv-results-grid">
                  {visibleGroups.map((group) => <AggregatedCard key={group.key} group={group} onOpen={openResult} />)}
                </div>
                {groups.length > visibleCount && (
                  <div className="flex justify-center mt-9">
                    <button className="btn-ghost" onClick={() => setVisibleCount((value) => value + RESULT_PAGE_SIZE)}>加载更多 · 还有 {groups.length - visibleCount} 部</button>
                  </div>
                )}
              </>
            ) : isSearching ? <ResultsSkeleton /> : !searchQuery.isError && (
              <EmptyState icon="search" title={failures.length >= selectedSources.length ? '播放来源暂不可用' : '没有找到这个故事'} description={failures.length >= selectedSources.length ? '本次来源均未成功响应，请重试或检查来源设置。' : '试试完整片名，或换个关键词再找找。'} className="!py-16" action={<><button type="button" className="btn-ghost" onClick={() => void searchQuery.refetch()}>重新搜索</button><button type="button" className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('kongwotv:open-settings'))}>管理播放源</button></>} />
            )}
          </section>
        )}

        {!urlQuery && (
          <>
            {browsing ? <DiscoveryFeed filters={defaultDiscoveryFilters(category)} onOpen={openCatalog} /> : (
              <>
                <div className="tv-home-heading"><div><p>幕里</p><h1>立即观看</h1></div><span>总有一个故事，值得此刻。</span></div>
                <FeaturedPremiere onOpen={openCatalog} />
                <ContinueWatchingSection />
                <RankingSection onOpen={openCatalog} />
                <WatchlistSection onOpen={openCatalog} />
                <LiveRibbon />
              </>
            )}
            {!browsing && supplementalEnabled && <div className="tv-catalog-supplemental"><RecommendSection onPick={(title) => { setInput(title); runSearch(title); }} /></div>}
          </>
        )}
      </main>
      <SiteFooter />
      <DetailModal
        item={detailItem}
        catalogItem={catalogItem}
        relatedItems={relatedItems}
        navigationId={detailNavigation.layer?.id}
        onPickRelated={openCatalog}
        onClose={detailNavigation.close}
        onSearch={(title) => { setInput(title); router.push(`/?s=${encodeURIComponent(title)}`, { scroll: false }); searchHistory.record(title); }}
      />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="tv-results-grid" aria-label="正在加载搜索结果" aria-busy="true">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className="aspect-[2/3] rounded-2xl bg-chip animate-pulse" />
          <div className="h-3.5 w-3/4 rounded bg-chip animate-pulse" />
          <div className="h-2.5 w-1/2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/** 无点播源 / 未勾选点播源时的引导（替代旧版首屏静默空白） */
function NoSourceGuide({ hasSources = false }: { hasSources?: boolean }) {
  return (
    <div className="border border-dashed border-line rounded-xl p-10 text-center max-w-lg mx-auto">
      <h3 className="text-content font-medium mb-2">{hasSources ? '当前没有可用的点播源' : '先添加一个点播源'}</h3>
      <p className="text-sm text-muted leading-relaxed">
        {hasSources ? (
          <>在设置中勾选播放源，或恢复已暂停的来源及订阅，再重新搜索。</>
        ) : (
          <>
            在「设置 → 源管理」添加播放源或导入订阅，勾选后即可搜索影片。
          </>
        )}
      </p>
      <button type="button" className="btn-ghost mt-5" onClick={() => window.dispatchEvent(new CustomEvent('kongwotv:open-settings'))}>{hasSources ? '管理播放源' : '添加播放源'}</button>
    </div>
  );
}
