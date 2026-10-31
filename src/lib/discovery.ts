import { getCache, setCache } from './fetch-utils';
import { doubanSubjectToItem, fetchDoubanJson } from './douban-weekly';
import { discoveryFilterKey, type DiscoveryFilters, type DiscoveryResponse } from './discovery-model';
import type { DoubanItem } from './types';

export const DISCOVERY_PAGE_SIZE = 24;
export const DISCOVERY_MAX_COUNT = 48;
export const DISCOVERY_MAX_START = 10_000;
const CACHE_TTL = 10 * 60 * 1000;
const pending = new Map<string, Promise<DiscoveryResponse>>();

const CATEGORY_TAG = { movies: '电影', tv: '电视剧', shows: '综艺' } as const;
const SORT = { recommend: 'T', new: 'R', rating: 'S' } as const;

/** tags 是服务端真实过滤条件；selected_categories 只负责上游控件信息，单独使用会被忽略。 */
export function discoveryUpstreamPath(filters: DiscoveryFilters, start: number, count: number): string {
  const tags = [CATEGORY_TAG[filters.category], filters.genre, filters.region, filters.year].filter(Boolean);
  const selected = filters.category === 'movies'
    ? { 类型: filters.genre || '全部', 地区: filters.region || '全部' }
    : { 类型: filters.category === 'shows' ? '综艺' : '电视剧', 形式: filters.genre || (filters.category === 'shows' ? '全部综艺' : '全部剧集'), 地区: filters.region || '全部' };
  const params = new URLSearchParams({
    refresh: '0',
    start: String(start),
    count: String(count),
    uncollect: 'false',
    sort: SORT[filters.sort],
    tags: tags.join(','),
    selected_categories: JSON.stringify(selected),
  });
  return `${filters.category === 'movies' ? 'movie' : 'tv'}/recommend?${params.toString()}`;
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}

function nonnegativeInteger(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
}

/** 原始游标包括广告/片单/榜单卡，过滤这些卡时不能用“实际电影数”当下一页偏移量。 */
export function parseDiscoveryPage(raw: unknown, filters: DiscoveryFilters, start: number, count: number): DiscoveryResponse {
  const data = record(raw);
  if (!data || !Array.isArray(data.items)) throw new Error('影视发现数据格式异常');
  const upstreamStart = nonnegativeInteger(data.start);
  if (upstreamStart !== undefined && upstreamStart !== start) throw new Error('影视来源未返回请求的分页位置');
  const total = nonnegativeInteger(data.total);
  const seen = new Set<string>();
  const items: DoubanItem[] = [];
  for (const rawItem of data.items) {
    const subject = record(rawItem);
    // 豆瓣推荐流会混入数字 id 的 playlist；它不是可打开 movie/{id} 的影视作品。
    if (!subject || (subject.type !== 'movie' && subject.type !== 'tv')) continue;
    if (filters.category === 'movies' ? subject.type !== 'movie' : subject.type !== 'tv') continue;
    const item = doubanSubjectToItem(subject);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    // recommend 条目通常不带 is_show，可信的“综艺”查询标签决定此处的类型。
    item.kind = filters.category === 'shows' ? 'show' : filters.category === 'tv' ? 'tv' : 'movie';
    item.isTv = filters.category !== 'movies';
    items.push(item);
  }
  const next = start + count;
  const hasMore = data.items.length > 0 && next <= DISCOVERY_MAX_START && (total === undefined ? data.items.length >= count : next < total);
  return { items, nextStart: hasMore ? next : null, hasMore, ...(total === undefined ? {} : { total }) };
}

export async function fetchDiscoveryPage(filters: DiscoveryFilters, start = 0, count = DISCOVERY_PAGE_SIZE): Promise<DiscoveryResponse> {
  if (!Number.isSafeInteger(start) || start < 0 || start > DISCOVERY_MAX_START ||
      !Number.isSafeInteger(count) || count < 1 || count > DISCOVERY_MAX_COUNT) {
    throw new Error('无效的影视分页参数');
  }
  const key = `discovery:v1:${discoveryFilterKey(filters)}:${start}:${count}`;
  const cached = getCache<DiscoveryResponse>(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const raw = await fetchDoubanJson(discoveryUpstreamPath(filters, start, count));
    const response = parseDiscoveryPage(raw, filters, start, count);
    setCache(key, response, CACHE_TTL);
    return response;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}
