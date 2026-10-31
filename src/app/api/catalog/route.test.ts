import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { fetchCatalogItem } from '@/lib/douban-catalog';

vi.mock('@/lib/douban-catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/douban-catalog')>(),
  fetchCatalogItem: vi.fn(),
}));

const fetchItem = vi.mocked(fetchCatalogItem);

function request(query: string, authenticated = true): Request {
  const headers = authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : undefined;
  return new Request(`https://local.test/api/catalog${query}`, { headers });
}

beforeEach(() => {
  vi.stubEnv('PASSWORD', 'catalog-test-password');
  vi.stubEnv('PROXY_SECRET', 'catalog-test-secret');
  fetchItem.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/catalog', () => {
  it('未配置密码时无需 Cookie 即可获取元数据', async () => {
    vi.stubEnv('PASSWORD', '');
    const item = { id: '1292052', title: '肖申克的救赎', cover: 'https://img3.doubanio.com/poster.jpg' };
    fetchItem.mockResolvedValueOnce(item);
    const res = await GET(request('?id=1292052', false));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ item });
    expect(fetchItem).toHaveBeenCalledWith('1292052');
  });

  it('未登录返回 401，且不请求元数据', async () => {
    const res = await GET(request('?id=1292052', false));
    expect(res.status).toBe(401);
    expect(fetchItem).not.toHaveBeenCalled();
  });

  it('伪造会话被拒绝', async () => {
    const req = new Request('https://local.test/api/catalog?id=1292052', {
      headers: { cookie: `${SESSION_COOKIE}=9999999999999.invalid-signature` },
    });
    expect((await GET(req)).status).toBe(401);
    expect(fetchItem).not.toHaveBeenCalled();
  });

  it.each([
    '', '?id=', '?id=0', '?id=-1', '?id=000123', '?id=baidu_0', '?id=1234567890123',
    '?id=1.5', '?id=https%3A%2F%2Fexample.com', '?id=..%2F1292052', '?id=1292052%3Furl%3Dhttps%3A%2F%2Fevil.example',
    '?id=1292052&id=1292052',
  ])('拒绝非法、缺失或重复 id：%s', async (query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(fetchItem).not.toHaveBeenCalled();
  });

  it('成功响应保持 { item: DoubanItem }', async () => {
    const item = { id: '1292052', title: '肖申克的救赎', cover: 'https://img3.doubanio.com/poster.jpg', description: '真实剧情', ratingCount: 3350777 };
    fetchItem.mockResolvedValueOnce(item);
    const res = await GET(request('?id=1292052'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ item });
    expect(fetchItem).toHaveBeenCalledWith('1292052');
  });

  it('上游失败返回可恢复的 502，不泄漏上游细节', async () => {
    fetchItem.mockRejectedValueOnce(new Error('内部上游详情'));
    const res = await GET(request('?id=1292052'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: '暂时无法获取豆瓣详情' });
  });
});
