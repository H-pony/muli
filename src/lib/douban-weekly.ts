import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 真实影视热榜：60s 社区实例优先，豆瓣 rexxar 移动端直连降级，最后尝试 60s 官方实例。
 * 60S_API_BASE 可指定自部署实例。所有来源都在服务端请求，成功结果缓存一小时。
 */
const CACHE_TTL = 60 * 60 * 1000;
const STALE_TTL = 24 * CACHE_TTL;
const FAILURE_CACHE_TTL = 60 * 1000;
const UA = 'Muli/2.16.12';
const FALLBACK_BASE = 'https://60s.viki.moe';
const DOUBAN_ORIGIN = 'https://m.douban.com';
const DOUBAN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

type MediaKind = 'movie' | 'tv' | 'show';

function apiBase(): string {
  return (process.env['60S_API_BASE'] || 'https://60s.crystelf.top').replace(/\/+$/, '');
}

/** 榜单标识保持兼容：豆瓣五个周榜 + 百度热播剧榜。 */
export const HOT_LIST_IDS = [
  'douban_movie_weekly',
  'douban_tv_chinese',
  'douban_tv_global',
  'douban_show_chinese',
  'douban_show_global',
  'baidu_teleplay',
] as const;

export type HotListId = (typeof HOT_LIST_IDS)[number];

export function isHotListId(id: string): id is HotListId {
  return (HOT_LIST_IDS as readonly string[]).includes(id);
}

const DOUBAN_LISTS: Partial<Record<HotListId, { category: string; collection: string; kind: MediaKind }>> = {
  douban_movie_weekly: { category: 'movie', collection: 'movie_weekly_best', kind: 'movie' },
  douban_tv_chinese: { category: 'tv_chinese', collection: 'tv_chinese_best_weekly', kind: 'tv' },
  douban_tv_global: { category: 'tv_global', collection: 'tv_global_best_weekly', kind: 'tv' },
  douban_show_chinese: { category: 'show_chinese', collection: 'show_chinese_best_weekly', kind: 'show' },
  douban_show_global: { category: 'show_global', collection: 'show_global_best_weekly', kind: 'show' },
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function texts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(text).filter((entry): entry is string => entry !== undefined);
  return values.length ? values : undefined;
}

function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return texts(value.map((entry: unknown) => typeof entry === 'string' ? entry : record(entry)?.name));
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 统一 60s 周榜、豆瓣原生榜单与详情；缺失字段保持缺失，不填充虚构剧情或演职员。 */
export function doubanWeeklyToItem(raw: unknown, isTv: boolean, kind: MediaKind = isTv ? 'tv' : 'movie'): DoubanItem | undefined {
  const data = record(raw);
  if (!data) return undefined;
  const id = typeof data.id === 'number' && Number.isSafeInteger(data.id) && data.id > 0
    ? String(data.id)
    : text(data.id);
  const title = text(data.title);
  const pic = record(data.pic);
  // 原生 doubanio 封面优先，避免依赖公共图片镜像的可用性。
  const cover = text(data.cover) || text(data.cover_url) || text(pic?.large) || text(pic?.normal) || text(data.cover_proxy);
  if (!id || !/^[1-9]\d{0,11}$/.test(id) || !title || !cover) return undefined;

  const rating = record(data.rating);
  const score = typeof data.rating === 'number' ? data.rating : rating?.value;
  const item: DoubanItem = {
    id,
    title,
    cover,
    rating: typeof score === 'number' && Number.isFinite(score) && score > 0 && score <= 10 ? String(score) : undefined,
    isTv,
    kind,
  };

  const rank = count(data.rank);
  if (rank && rank > 0) item.rank = rank;
  const ratingCount = count(data.rating_count) ?? count(rating?.count);
  if (ratingCount !== undefined) item.ratingCount = ratingCount;
  const description = text(data.intro) || text(data.description);
  if (description) item.description = description;
  const url = text(data.url);
  if (url) item.url = url;
  const backdrop = texts(data.photos)?.[0];
  if (backdrop) item.backdrop = backdrop;

  // card_subtitle 是豆瓣返回的“年份 / 国家 / 类型 / 导演 / 演员”。
  // 部分条目缺演职员段落；只有完整五段时才解析演职员，避免将演员误作导演。
  const subtitle = text(data.card_subtitle)?.split(/\s*\/\s*/);
  const hasSubtitle = subtitle && /^\d{4}$/.test(subtitle[0]) && subtitle.length >= 3;
  const year = text(data.year) || (typeof data.year === 'number' && Number.isSafeInteger(data.year) ? String(data.year) : undefined)
    || (hasSubtitle ? subtitle[0] : undefined);
  if (year) item.year = year;
  const genres = texts(data.genres) || (hasSubtitle ? texts(subtitle[2].split(/\s+/)) : undefined);
  const countries = texts(data.countries) || (hasSubtitle ? texts(subtitle[1].split(/\s+/)) : undefined);
  const directors = names(data.directors) || (hasSubtitle && subtitle.length === 5 ? texts(subtitle[3].split(/\s+/)) : undefined);
  const actors = names(data.actors) || (hasSubtitle && subtitle.length === 5 ? texts(subtitle[4].split(/\s+/)) : undefined);
  const duration = texts(data.durations)?.join(' / ');
  if (genres) item.genres = genres;
  if (countries) item.countries = countries;
  if (directors) item.directors = directors;
  if (actors) item.actors = actors;
  if (duration) item.duration = duration;
  return item;
}

/** 豆瓣详情中综艺的 type/subtype 同样是 tv，必须优先检查 is_show。 */
export function doubanSubjectToItem(raw: unknown): DoubanItem | undefined {
  const data = record(raw);
  if (!data) return undefined;
  const kind = data.is_show === true ? 'show'
    : data.is_tv === true || data.type === 'tv' || data.subtype === 'tv' ? 'tv' : 'movie';
  return doubanWeeklyToItem(data, kind !== 'movie', kind);
}

/** 百度热播剧没有豆瓣评分或豆瓣 id；热度 score 不能当作评分。 */
export function baiduTeleplayToItem(raw: unknown, index: number): DoubanItem | undefined {
  const data = record(raw);
  const title = text(data?.title);
  const cover = text(data?.cover);
  if (!data || !title || !cover) return undefined;
  const item: DoubanItem = { id: `baidu_${index}`, title, cover, isTv: true, kind: 'tv' };
  const rank = count(data.rank);
  if (rank && rank > 0) item.rank = rank;
  const description = text(data.desc);
  const url = text(data.url);
  if (description) item.description = description;
  if (url) item.url = url;
  return item;
}

/** 固定 HTTPS 豆瓣域名；仅允许同源 API 内部跳转（movie/{id} 会 301 至 tv/{id}）。 */
export async function fetchDoubanJson(path: string, timeoutMs = 8000): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = `${DOUBAN_ORIGIN}/rexxar/api/v2/${path}`;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetchUpstream(url, {
      timeoutMs,
      signal,
      safeRedirects: false,
      redirect: 'manual',
      headers: { 'User-Agent': DOUBAN_UA, Referer: `${DOUBAN_ORIGIN}/`, Accept: 'application/json' },
    });
    const location = res.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      const next = new URL(location, url);
      if (next.origin !== DOUBAN_ORIGIN || next.username || next.password || !next.pathname.startsWith('/rexxar/api/v2/')) {
        throw new Error('豆瓣跳转目标被拒绝');
      }
      await res.body?.cancel();
      url = next.href;
      continue;
    }
    if (!res.ok) throw new Error(`豆瓣响应异常 (${res.status})`);
    return res.json();
  }
  throw new Error('豆瓣重定向次数过多');
}

async function fetchSixtyItems(base: string, path: string, convert: (entry: unknown, index: number) => DoubanItem | undefined): Promise<DoubanItem[]> {
  const res = await fetchUpstream(`${base}${path}`, {
    timeoutMs: 8000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`60s API 响应异常 (${res.status})`);
  const raw = record(await res.json());
  if (!raw || (raw.code !== undefined && raw.code !== 200)) throw new Error('60s API 返回错误');
  return convertItems(raw.data, convert);
}

function convertItems(value: unknown, convert: (entry: unknown, index: number) => DoubanItem | undefined): DoubanItem[] {
  if (!Array.isArray(value)) throw new Error('榜单数据异常');
  const items = value.map(convert).filter((item): item is DoubanItem => item !== undefined);
  if (!items.length) throw new Error('榜单数据为空');
  return items;
}

async function loadHotList(id: HotListId): Promise<DoubanItem[]> {
  const primary = apiBase();
  const list = DOUBAN_LISTS[id];
  const path = list ? `/v2/douban/weekly/${list.category}` : '/v2/baidu/teleplay';
  const convert = list
    ? (entry: unknown) => doubanWeeklyToItem(entry, list.kind !== 'movie', list.kind)
    : baiduTeleplayToItem;
  const sources: (() => Promise<DoubanItem[]>)[] = [() => fetchSixtyItems(primary, path, convert)];
  if (list) {
    sources.push(async () => {
      const raw = record(await fetchDoubanJson(`subject_collection/${list.collection}/items?start=0&count=20`));
      return convertItems(raw?.subject_collection_items, convert);
    });
  }
  if (primary !== FALLBACK_BASE) sources.push(() => fetchSixtyItems(FALLBACK_BASE, path, convert));

  let lastError: unknown;
  for (const source of sources) {
    try {
      return await source();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('榜单获取失败');
}

const pending = new Map<HotListId, Promise<DoubanItem[]>>();

export async function fetchHotList(id: HotListId): Promise<DoubanItem[]> {
  const cacheKey = `hot-list:v2:${id}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;
  const existing = pending.get(id);
  if (existing) return existing;

  const request = (async () => {
    try {
      const items = await loadHotList(id);
      setCache(cacheKey, items, CACHE_TTL);
      setCache(`${cacheKey}:stale`, items, STALE_TTL);
      return items;
    } catch (err) {
      // 仅保留此前成功获取的真实榜单；短暂故障不让首页整片消失。
      const stale = getCache<DoubanItem[]>(`${cacheKey}:stale`);
      if (!stale) throw err;
      setCache(cacheKey, stale, FAILURE_CACHE_TTL);
      return stale;
    }
  })();
  pending.set(id, request);
  try {
    return await request;
  } finally {
    pending.delete(id);
  }
}
