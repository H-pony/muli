'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from './header';
import { SiteFooter } from './site-footer';
import { DetailModal } from './detail-modal';
import { DiscoveryFeed } from './discovery-feed';
import {
  DISCOVERY_GENRES, DISCOVERY_REGIONS, DISCOVERY_SORTS, DISCOVERY_YEARS,
  defaultDiscoveryFilters, discoveryCategoryLabel, discoverySearchParams, parseDiscoveryFilters,
  type DiscoveryCategory, type DiscoveryFilters, type DiscoveryOption,
} from '@/lib/discovery-model';
import { useNavigationLayer, useNavigationScrollRestoration, usePageReturn } from '@/lib/navigation-hooks';
import { rememberNavigationEntry } from '@/lib/navigation';
import type { DoubanItem } from '@/lib/types';

export function CatalogBrowser({ category }: { category: DiscoveryCategory }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const filters = useMemo(() => parseDiscoveryFilters(new URLSearchParams(query), category), [query, category]);
  const label = discoveryCategoryLabel(category);
  const back = usePageReturn(query, `/?view=${category}`);
  const detail = useNavigationLayer<{ catalogItem: DoubanItem; relatedItems: DoubanItem[] }>('detail');
  useNavigationScrollRestoration();

  const changeFilters = (next: DiscoveryFilters) => {
    const params = discoverySearchParams(next);
    params.delete('category');
    // 筛选仍属于同一次浏览，保留进入页面的真实来路。
    for (const key of ['returnTo', 'returnEntry']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const suffix = params.toString();
    router.replace(`/browse/${category}${suffix ? `?${suffix}` : ''}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const update = (key: 'genre' | 'region' | 'year' | 'sort', value: string) => {
    const params = discoverySearchParams(filters);
    params.set(key, value);
    changeFilters(parseDiscoveryFilters(params, category));
  };
  const reset = () => changeFilters(defaultDiscoveryFilters(category));
  const open = (item: DoubanItem, relatedItems: DoubanItem[]) => detail.open({ catalogItem: item, relatedItems });
  const active = Boolean(filters.genre || filters.region || filters.year || filters.sort !== 'recommend');

  return (
    <div className="tv-cinema-root tv-catalog-root min-h-screen flex flex-col">
      <Header activePage={category} />
      <main id="main-content" tabIndex={-1} className="tv-home-main tv-catalog-main flex-1">
        <div className="tv-browse__heading">
          <button type="button" className="tv-browse__back" onClick={back} aria-label="返回上一页" title="返回上一页">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div><h1>{label}筛选</h1><p>按类型、地区和年份，找到此刻想看的故事。</p></div>
        </div>
        <section className="tv-browse__filters" aria-label={`${label}筛选条件`}>
          <div className="tv-browse__filter-grid">
            <FilterSelect label="类型" value={filters.genre} options={DISCOVERY_GENRES[category]} onChange={(value) => update('genre', value)} />
            <FilterSelect label="地区" value={filters.region} options={DISCOVERY_REGIONS} onChange={(value) => update('region', value)} />
            <FilterSelect label="年份" value={filters.year} options={DISCOVERY_YEARS} onChange={(value) => update('year', value)} />
            <FilterSelect label="排序" value={filters.sort} options={DISCOVERY_SORTS.map((option) => option.value === 'new' && category !== 'movies' ? { ...option, label: '最新开播' } : option)} onChange={(value) => update('sort', value)} />
          </div>
          <button type="button" className="tv-browse__reset" disabled={!active} onClick={reset}>重置筛选</button>
        </section>
        <DiscoveryFeed filters={filters} onOpen={open} showHeading={false} onReset={reset} />
      </main>
      <SiteFooter />
      <DetailModal item={null} catalogItem={detail.layer?.data.catalogItem ?? null} relatedItems={detail.layer?.data.relatedItems ?? []}
        navigationId={detail.layer?.id} onPickRelated={open} onClose={detail.close}
        onSearch={(title) => { rememberNavigationEntry(); router.push(`/?s=${encodeURIComponent(title)}`, { scroll: false }); }} />
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly DiscoveryOption[];
  onChange: (value: string) => void;
}) {
  return <label className="tv-browse__field"><span>{label}</span><div className="tv-browse__select-wrap">
    <select className="tv-browse__select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  </div></label>;
}
