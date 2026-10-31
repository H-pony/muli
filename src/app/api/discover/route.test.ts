import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { fetchDiscoveryPage } from '@/lib/discovery';

vi.mock('@/lib/discovery', async (original) => ({
  ...await original<typeof import('@/lib/discovery')>(),
  fetchDiscoveryPage: vi.fn(),
}));
const fetchPage = vi.mocked(fetchDiscoveryPage);
function request(query = '', authenticated = true): Request {
  const headers = authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : undefined;
  return new Request(`https://local.test/api/discover${query}`, { headers });
}

beforeEach(() => {
  vi.stubEnv('PASSWORD', 'discovery-test-password');
  vi.stubEnv('PROXY_SECRET', 'discovery-test-secret');
  fetchPage.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/discover', () => {
  it('未配置密码时无需 Cookie 即可浏览片库', async () => {
    vi.stubEnv('PASSWORD', '');
    const page = { items: [{ id: '1292052', title: '肖申克的救赎', cover: '' }], nextStart: null, hasMore: false };
    fetchPage.mockResolvedValueOnce(page);
    const response = await GET(request('', false));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(fetchPage).toHaveBeenCalledWith({ category: 'movies', genre: '', region: '', year: '', sort: 'recommend' }, 0, 24);
  });

  it('未登录时停止，不向上游请求', async () => {
    expect((await GET(request('', false))).status).toBe(401);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each([
    '?category=unknown', '?category=https://evil.example', '?genre=unknown', '?region=localhost', '?year=9999', '?sort=fastest',
    '?start=-1', '?start=1.5', '?start=1e3', '?start=10001', '?count=0', '?count=49', '?count=',
    '?category=tv&category=shows', '?genre=剧情&genre=喜剧', '?start=0&start=24',
    '?category=movies&genre=真人秀',
  ])('无效或重复参数在请求前被拒绝：%s', async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('默认电影第一页，返回稳定分页字段', async () => {
    const page = { items: [], nextStart: null, hasMore: false, total: 0 };
    fetchPage.mockResolvedValueOnce(page);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(fetchPage).toHaveBeenCalledWith({ category: 'movies', genre: '', region: '', year: '', sort: 'recommend' }, 0, 24);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('综艺的所有筛选和分页传到服务端，不能默默忽略', async () => {
    fetchPage.mockResolvedValueOnce({ items: [], nextStart: null, hasMore: false });
    const response = await GET(request('?category=shows&genre=真人秀&region=中国大陆&year=2024&sort=rating&start=24&count=48'));
    expect(response.status).toBe(200);
    expect(fetchPage).toHaveBeenCalledWith({ category: 'shows', genre: '真人秀', region: '中国大陆', year: '2024', sort: 'rating' }, 24, 48);
  });

  it('上游失败返回可重试的 502，不泄漏内部异常', async () => {
    fetchPage.mockRejectedValueOnce(new Error('internal detail'));
    const response = await GET(request('?category=tv'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: '影视内容暂时未能加载，请稍后重试' });
  });
});
