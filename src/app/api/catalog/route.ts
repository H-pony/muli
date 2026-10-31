import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchCatalogItem, isDoubanId } from '@/lib/douban-catalog';

export const runtime = 'nodejs';

/** 豆瓣真实条目元数据，复用站点鉴权；请求只访问固定豆瓣 HTTPS 域名。 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const ids = new URL(req.url).searchParams.getAll('id');
  if (ids.length !== 1 || !isDoubanId(ids[0])) {
    return NextResponse.json({ error: '需要有效的数字豆瓣 id' }, { status: 400 });
  }

  try {
    const item = await fetchCatalogItem(ids[0]);
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: '暂时无法获取豆瓣详情' }, { status: 502 });
  }
}
