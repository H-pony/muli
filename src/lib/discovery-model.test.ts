import { describe, expect, it } from 'vitest';
import { defaultDiscoveryFilters, discoveryFilterKey, discoverySearchParams, isDiscoveryCategory, parseDiscoveryFilters } from './discovery-model';

describe('影视发现筛选 URL', () => {
  it.each(['movies', 'tv', 'shows'] as const)('各分类有独立默认筛选：%s', (category) => {
    expect(defaultDiscoveryFilters(category)).toEqual({ category, genre: '', region: '', year: '', sort: 'recommend' });
    expect(parseDiscoveryFilters(new URLSearchParams(`category=${category}`))).toEqual(defaultDiscoveryFilters(category));
  });

  it('筛选序列化往返保留所有选项，忽略详情和历史面板参数', () => {
    const filters = { category: 'shows', genre: '真人秀', region: '中国大陆', year: '2024', sort: 'rating' } as const;
    const params = discoverySearchParams(filters);
    params.set('detail', 'nav_test');
    params.set('history', 'nav_history');
    expect(parseDiscoveryFilters(params)).toEqual(filters);
    expect(discoveryFilterKey(filters)).toBe('category=shows&genre=%E7%9C%9F%E4%BA%BA%E7%A7%80&region=%E4%B8%AD%E5%9B%BD%E5%A4%A7%E9%99%86&year=2024&sort=rating');
  });

  it('分类路由优先于不一致的查询分类，且不会沿用另一分类专属类型', () => {
    expect(parseDiscoveryFilters(new URLSearchParams('category=shows&genre=真人秀'), 'movies')).toEqual(defaultDiscoveryFilters('movies'));
  });

  it('不认可的选项回到默认值，不转发任意筛选值', () => {
    expect(parseDiscoveryFilters(new URLSearchParams('category=unknown&genre=https://evil.example&region=private&year=9999&sort=unknown'))).toEqual(defaultDiscoveryFilters('movies'));
  });

  it.each(['../movies', 'movie', '', null])('不认可未知分类：%s', (value) => {
    expect(isDiscoveryCategory(value)).toBe(false);
  });

  it('默认 URL 省略空筛选和默认排序', () => {
    expect(discoverySearchParams(defaultDiscoveryFilters('tv')).toString()).toBe('category=tv');
  });
});
