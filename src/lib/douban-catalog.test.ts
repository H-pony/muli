import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCatalogItem, isDoubanId } from './douban-catalog';
import { fetchUpstream, setCache } from './fetch-utils';
import { fetchDoubanJson } from './douban-weekly';

vi.mock('./fetch-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./fetch-utils')>(),
  fetchUpstream: vi.fn(),
}));

const upstream = vi.mocked(fetchUpstream);
const id = '35322132';
const poster = 'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2935294362.jpg';
const still = 'https://img3.doubanio.com/view/photo/l/public/p2929857648.jpg';
const subject = {
  id, title: '罗斯', cover_url: poster, type: 'movie', is_tv: false, is_show: false,
  intro: '来自豆瓣的真实完整剧情', year: '2026', genres: ['剧情'], countries: ['奥地利', '德国'],
  durations: ['93分钟'], directors: [{ name: '马库斯·施莱泽' }], actors: [{ name: '桑德拉·惠勒' }],
  rating: { value: 8.5, count: 22229 }, url: `https://movie.douban.com/subject/${id}/`,
};
const photos = { photos: [{ image: { large: { url: still } } }] };

beforeEach(() => {
  upstream.mockReset();
  setCache(`douban-catalog:${id}`, undefined, -1);
});
afterEach(() => vi.restoreAllMocks());

describe('isDoubanId', () => {
  it.each(['1292052', '35322132', '1', '999999999999'])('允许正整数豆瓣 id：%s', (value) => {
    expect(isDoubanId(value)).toBe(true);
  });

  it.each(['', '0', '000123', '-1', '1.5', '1e7', '1234567890123', 'baidu_0', 'https://evil.example', '../movie/1', '1?url=https://evil.example', ' 1292052', '１２３'])('拒绝非法 id：%s', (value) => {
    expect(isDoubanId(value)).toBe(false);
  });
});

describe('豆瓣固定域名请求', () => {
  it('允许 movie 到 tv 的内部 301，复用整链超时信号', async () => {
    upstream.mockResolvedValueOnce(new Response('', { status: 301, headers: {
      location: 'https://m.douban.com/rexxar/api/v2/tv/37560173',
    } })).mockResolvedValueOnce(Response.json(subject));
    expect(await fetchDoubanJson('movie/37560173')).toEqual(subject);
    expect(upstream).toHaveBeenNthCalledWith(2, 'https://m.douban.com/rexxar/api/v2/tv/37560173', expect.anything());
    const firstSignal = upstream.mock.calls[0][1]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(upstream.mock.calls[1][1]?.signal).toBe(firstSignal);
  });

  it.each([
    'https://attacker.example/rexxar/api/v2/tv/1',
    '//attacker.example/rexxar/api/v2/tv/1',
    'http://m.douban.com/rexxar/api/v2/tv/1',
    'https://m.douban.com:444/rexxar/api/v2/tv/1',
    'https://user:password@m.douban.com/rexxar/api/v2/tv/1',
    'https://m.douban.com/login',
    'http://127.0.0.1/rexxar/api/v2/tv/1',
  ])('拒绝 API 范围外跳转：%s', async (location) => {
    upstream.mockResolvedValueOnce(new Response('', { status: 302, headers: { location } }));
    await expect(fetchDoubanJson(`movie/${id}`)).rejects.toThrow('豆瓣跳转目标被拒绝');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('跳转循环最多请求三次', async () => {
    upstream.mockImplementation(async () => new Response('', { status: 301, headers: {
      location: `/rexxar/api/v2/movie/${id}`,
    } }));
    await expect(fetchDoubanJson(`movie/${id}`)).rejects.toThrow('豆瓣重定向次数过多');
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});

describe('fetchCatalogItem', () => {
  it('只请求固定豆瓣域名，手动校验跳转，返回真实详情和剧照首图', async () => {
    upstream.mockImplementation(async (url) => Response.json(url.includes('/photos?') ? photos : subject));
    const item = await fetchCatalogItem(id);
    expect(item).toMatchObject({
      id, title: '罗斯', kind: 'movie', isTv: false, cover: poster, backdrop: still,
      description: subject.intro, year: '2026', genres: ['剧情'], countries: ['奥地利', '德国'],
      duration: '93分钟', directors: ['马库斯·施莱泽'], actors: ['桑德拉·惠勒'], rating: '8.5', ratingCount: 22229,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream).toHaveBeenNthCalledWith(1, `https://m.douban.com/rexxar/api/v2/movie/${id}`,
      expect.objectContaining({ timeoutMs: 8000, redirect: 'manual', safeRedirects: false }));
    expect(upstream).toHaveBeenNthCalledWith(2,
      `https://m.douban.com/rexxar/api/v2/movie/${id}/photos?type=S&start=0&count=1`,
      expect.objectContaining({ timeoutMs: 3000, redirect: 'manual', safeRedirects: false }));
    expect(await fetchCatalogItem(id)).toEqual(item);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('同 id 并发只发起一组详情和剧照请求', async () => {
    let complete!: (response: Response) => void;
    upstream.mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce(Response.json(photos));
    const first = fetchCatalogItem(id);
    const second = fetchCatalogItem(id);
    expect(upstream).toHaveBeenCalledTimes(2);
    complete(Response.json(subject));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
  });

  it('缓存一小时后重新请求上游', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    upstream.mockImplementation(async (url) => Response.json(url.includes('/photos?') ? photos : subject));
    await fetchCatalogItem(id);
    clock.mockReturnValue(now + 59 * 60 * 1000);
    await fetchCatalogItem(id);
    expect(upstream).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(now + 61 * 60 * 1000);
    await fetchCatalogItem(id);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it.each([
    new Error('照片超时'),
    { photos: [] },
    { photos: [null] },
    { photos: [{ image: { large: { url: 'https://attacker.example/poster.jpg' } } }] },
  ])('剧照不可用时仍返回详情，不将海报冒充剧照：%j', async (photoResponse) => {
    upstream.mockResolvedValueOnce(Response.json(subject));
    if (photoResponse instanceof Error) upstream.mockRejectedValueOnce(photoResponse);
    else upstream.mockResolvedValueOnce(Response.json(photoResponse));
    const item = await fetchCatalogItem(id);
    expect(item.description).toBe(subject.intro);
    expect(item.backdrop).toBeUndefined();
  });

  it('非法 id 在出网前拒绝', async () => {
    await expect(fetchCatalogItem('../1292052')).rejects.toThrow('无效的豆瓣 id');
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([{ code: 404 }, { ...subject, id: '1292052' }, { ...subject, title: undefined }])('坏详情或 id 不匹配时不缓存：%j', async (raw) => {
    upstream.mockResolvedValueOnce(Response.json(raw)).mockResolvedValueOnce(Response.json(photos));
    await expect(fetchCatalogItem(id)).rejects.toThrow('豆瓣详情数据异常');
    upstream.mockResolvedValueOnce(Response.json(subject)).mockResolvedValueOnce(Response.json(photos));
    expect((await fetchCatalogItem(id)).id).toBe(id);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it('详情响应异常会抛错', async () => {
    upstream.mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(Response.json(photos));
    await expect(fetchCatalogItem(id)).rejects.toThrow('豆瓣响应异常 (403)');
  });
});
