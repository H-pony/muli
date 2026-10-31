import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { isDiscoveryCategory, parseDiscoveryFilters } from '@/lib/discovery-model';
import { DISCOVERY_MAX_COUNT, DISCOVERY_MAX_START, DISCOVERY_PAGE_SIZE, fetchDiscoveryPage } from '@/lib/discovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pageInteger(params: URLSearchParams, name: string, fallback: number, minimum: number, maximum: number): number | undefined {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^(?:0|[1-9]\d{0,6})$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

/** 发现页只接收分类/筛选/游标，不允许传入任意上游 URL。 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const params = new URL(req.url).searchParams;
  if (['category', 'genre', 'region', 'year', 'sort', 'start', 'count'].some((name) => params.getAll(name).length > 1)) {
    return jsonError('筛选和分页参数不可重复', 400);
  }
  const category = params.get('category') || 'movies';
  if (!isDiscoveryCategory(category)) return jsonError('无效的影视分类', 400);
  const filters = parseDiscoveryFilters(params, category);
  for (const name of ['genre', 'region', 'year', 'sort'] as const) {
    const raw = params.get(name);
    if (raw && raw !== filters[name]) return jsonError(`无效的筛选参数：${name}`, 400);
  }
  const start = pageInteger(params, 'start', 0, 0, DISCOVERY_MAX_START);
  const count = pageInteger(params, 'count', DISCOVERY_PAGE_SIZE, 1, DISCOVERY_MAX_COUNT);
  if (start === undefined || count === undefined) return jsonError('无效的分页参数', 400);
  try {
    const response = await fetchDiscoveryPage(filters, start, count);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError('影视内容暂时未能加载，请稍后重试', 502);
  }
}
