import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDiscoveryFilters, type DiscoveryFilters } from './discovery-model';
import { discoveryUpstreamPath, fetchDiscoveryPage, parseDiscoveryPage } from './discovery';
import { fetchDoubanJson } from './douban-weekly';

const { cache } = vi.hoisted(() => ({ cache: new Map<string, unknown>() }));
vi.mock('./fetch-utils', async (original) => ({
  ...await original<typeof import('./fetch-utils')>(),
  getCache: vi.fn((key: string) => cache.get(key)),
  setCache: vi.fn((key: string, value: unknown) => { cache.set(key, value); }),
}));
vi.mock('./douban-weekly', async (original) => ({
  ...await original<typeof import('./douban-weekly')>(),
  fetchDoubanJson: vi.fn(),
}));
const upstream = vi.mocked(fetchDoubanJson);
const subject = (id = '1292052', type = 'movie') => ({
  id, type, title: `影片 ${id}`, cover_url: `https://img3.doubanio.com/${id}.jpg`,
  card_subtitle: '2024 / 中国大陆 / 科幻 剧情 / 导演 / 演员', rating: { value: 8.7, count: 1234 },
});

beforeEach(() => { cache.clear(); upstream.mockReset(); });

describe('真实上游筛选请求', () => {
  it.each([
    ['movies', 'movie', '电影'], ['tv', 'tv', '电视剧'], ['shows', 'tv', '综艺'],
  ] as const)('分类 %s 的标签实际区分作品类型', (category, endpoint, tag) => {
    const path = discoveryUpstreamPath(defaultDiscoveryFilters(category), 24, 24);
    const url = new URL(path, 'https://m.douban.com/rexxar/api/v2/');
    expect(url.pathname).toBe(`/rexxar/api/v2/${endpoint}/recommend`);
    expect(url.searchParams.get('tags')).toBe(tag);
    expect(url.searchParams.get('start')).toBe('24');
    expect(url.searchParams.get('count')).toBe('24');
  });

  it('年份必须作为实际标签，不能用上游忽略的 year_range', () => {
    const filters: DiscoveryFilters = { category: 'shows', genre: '真人秀', region: '中国大陆', year: '2024', sort: 'new' };
    const url = new URL(discoveryUpstreamPath(filters, 0, 24), 'https://m.douban.com/');
    expect(url.searchParams.get('tags')).toBe('综艺,真人秀,中国大陆,2024');
    expect(url.searchParams.has('year_range')).toBe(false);
    expect(url.searchParams.get('sort')).toBe('R');
    expect(JSON.parse(url.searchParams.get('selected_categories')!)).toMatchObject({ 形式: '真人秀', 地区: '中国大陆' });
  });

  it.each([['recommend', 'T'], ['new', 'R'], ['rating', 'S']] as const)('排序 %s 使用上游实际排序 %s', (sort, raw) => {
    const path = discoveryUpstreamPath({ ...defaultDiscoveryFilters(), sort }, 0, 24);
    expect(new URL(path, 'https://m.douban.com/').searchParams.get('sort')).toBe(raw);
  });
});

describe('发现页响应解析与分页', () => {
  it('跳过数字 id 的片单、广告和图表，保持原始游标而不是电影数', () => {
    const page = parseDiscoveryPage({ items: [
      { ...subject(), type: 'playlist' }, subject(), { type: 'ad' },
      { ...subject('1292053'), type: 'chart' }, subject('1292054'),
    ], start: 24, total: 100 }, defaultDiscoveryFilters(), 24, 24);
    expect(page.items.map((item) => item.id)).toEqual(['1292052', '1292054']);
    expect(page).toMatchObject({ nextStart: 48, hasMore: true, total: 100 });
  });

  it('保留真实作品元数据，不把综艺误分类为电视剧', () => {
    const page = parseDiscoveryPage({ items: [subject('1292052', 'tv')], total: 1 }, defaultDiscoveryFilters('shows'), 0, 24);
    expect(page.items[0]).toMatchObject({ kind: 'show', isTv: true, year: '2024', countries: ['中国大陆'], genres: ['科幻', '剧情'], rating: '8.7', ratingCount: 1234 });
    expect(page.nextStart).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('过滤错误大类、无效条目和同页重复 id', () => {
    const page = parseDiscoveryPage({ items: [subject(), subject(), subject('1292053', 'tv'), { id: '123' }, null] }, defaultDiscoveryFilters(), 0, 24);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe('1292052');
  });

  it('最后一页和空页正确结束，不不断请求空页', () => {
    expect(parseDiscoveryPage({ items: [subject()], start: 24, total: 25 }, defaultDiscoveryFilters(), 24, 24)).toMatchObject({ hasMore: false, nextStart: null });
    expect(parseDiscoveryPage({ items: [], total: 500 }, defaultDiscoveryFilters(), 48, 24)).toMatchObject({ hasMore: false, nextStart: null });
  });

  it('没有可靠 total 时依据原始页是否装满决定继续，不伪造总数', () => {
    const page = parseDiscoveryPage({ items: Array.from({ length: 24 }, (_, i) => subject(String(1292052 + i))) }, defaultDiscoveryFilters(), 0, 24);
    expect(page).toMatchObject({ hasMore: true, nextStart: 24 });
    expect(page.total).toBeUndefined();
  });

  it('上游忽略起点时拒绝重复第一页', () => {
    expect(() => parseDiscoveryPage({ items: [subject()], start: 0, total: 500 }, defaultDiscoveryFilters(), 24, 24)).toThrow('分页位置');
  });

  it.each([null, [], { error: 'blocked' }, { items: {} }])('拒绝异常响应：%j', (value) => {
    expect(() => parseDiscoveryPage(value, defaultDiscoveryFilters(), 0, 24)).toThrow('数据格式异常');
  });
});

describe('发现页获取和缓存', () => {
  it('成功页面缓存，筛选和分页互不混用', async () => {
    upstream.mockResolvedValue({ items: [subject()], total: 100 });
    await fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24);
    await fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24);
    expect(upstream).toHaveBeenCalledTimes(1);
    await fetchDiscoveryPage(defaultDiscoveryFilters(), 24, 24);
    await fetchDiscoveryPage({ ...defaultDiscoveryFilters(), year: '2024' }, 0, 24);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('同一页并发请求只发起一次上游请求', async () => {
    let finish!: (value: unknown) => void;
    upstream.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24);
    const second = fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24);
    expect(upstream).toHaveBeenCalledTimes(1);
    finish({ items: [subject()], total: 100 });
    expect(await first).toEqual(await second);
  });

  it('上游失败不缓存且清理在途状态，用户重试能重新获取', async () => {
    upstream.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ items: [subject()], total: 100 });
    await expect(fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24)).rejects.toThrow('temporary');
    expect((await fetchDiscoveryPage(defaultDiscoveryFilters(), 0, 24)).items).toHaveLength(1);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it.each([[-1, 24], [0, 0], [0, 49], [1.5, 24], [10_001, 24]])('非法页界限在出网前拒绝：%s/%s', async (start, count) => {
    await expect(fetchDiscoveryPage(defaultDiscoveryFilters(), start, count)).rejects.toThrow('无效的影视分页');
    expect(upstream).not.toHaveBeenCalled();
  });
});
