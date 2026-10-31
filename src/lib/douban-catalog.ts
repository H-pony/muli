import type { DoubanItem } from './types';
import { getCache, setCache } from './fetch-utils';
import { doubanSubjectToItem, fetchDoubanJson } from './douban-weekly';

const CACHE_TTL = 60 * 60 * 1000;
const pending = new Map<string, Promise<DoubanItem>>();

/** 只接受数字豆瓣 subject id，禁止路径、URL、查询参数和无限长输入。 */
export function isDoubanId(id: string): boolean {
  return /^[1-9]\d{0,11}$/.test(id);
}

function backdropFromPhotos(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || !('photos' in raw) || !Array.isArray(raw.photos)) return undefined;
  const photo = raw.photos[0] as { image?: { large?: { url?: unknown }; normal?: { url?: unknown } } } | undefined;
  const url = photo?.image?.large?.url || photo?.image?.normal?.url;
  return typeof url === 'string' && /^https:\/\/img\d*\.doubanio\.com\//.test(url) ? url : undefined;
}

export async function fetchCatalogItem(id: string): Promise<DoubanItem> {
  if (!isDoubanId(id)) throw new Error('无效的豆瓣 id');
  const cacheKey = `douban-catalog:${id}`;
  const cached = getCache<DoubanItem>(cacheKey);
  if (cached) return cached;
  const existing = pending.get(id);
  if (existing) return existing;

  const request = (async () => {
    // movie/{id} 可同时返回电影、剧集和综艺；仅允许固定域名内部 API 跳转。
    const [raw, backdrop] = await Promise.all([
      fetchDoubanJson(`movie/${id}`),
      fetchDoubanJson(`movie/${id}/photos?type=S&start=0&count=1`, 3000)
        .then(backdropFromPhotos)
        .catch(() => undefined),
    ]);
    const item = doubanSubjectToItem(raw);
    if (!item || item.id !== id) throw new Error('豆瓣详情数据异常');
    if (backdrop) item.backdrop = backdrop;
    setCache(cacheKey, item, CACHE_TTL);
    return item;
  })();
  pending.set(id, request);
  try {
    return await request;
  } finally {
    pending.delete(id);
  }
}
