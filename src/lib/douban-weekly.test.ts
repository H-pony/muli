import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baiduTeleplayToItem, doubanSubjectToItem, doubanWeeklyToItem, fetchHotList, HOT_LIST_IDS, isHotListId } from './douban-weekly';
import { fetchUpstream, setCache } from './fetch-utils';

vi.mock('./fetch-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./fetch-utils')>(),
  fetchUpstream: vi.fn(),
}));

const upstream = vi.mocked(fetchUpstream);
const poster = 'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2935294362.jpg';
const still = 'https://img3.doubanio.com/view/photo/l/public/p2929857648.jpg';
const movie = {
  id: '35322132', title: '罗斯', rating: 8.5, cover: poster,
  rank: 1, rating_count: 22225, description: '',
  card_subtitle: '2026 / 奥地利 德国 / 剧情 / 马库斯·施莱泽 / 桑德拉·惠勒 卡洛·布劳恩',
  url: 'https://movie.douban.com/subject/35322132/',
};
const nativeMovie = {
  ...movie, cover: undefined, cover_url: poster,
  rating: { value: 8.5, count: 22229 }, rating_count: undefined,
  photos: [still],
};

beforeEach(() => {
  upstream.mockReset();
  for (const id of HOT_LIST_IDS) {
    setCache(`hot-list:v2:${id}`, undefined, -1);
    setCache(`hot-list:v2:${id}:stale`, undefined, -1);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('isHotListId', () => {
  it('白名单校验', () => {
    for (const id of HOT_LIST_IDS) expect(isHotListId(id)).toBe(true);
    expect(isHotListId('maoyan')).toBe(false);
    expect(isHotListId('')).toBe(false);
  });
});

describe('doubanWeeklyToItem', () => {
  it('评分、封面（原生地址优先）、isTv 正确映射', () => {
    expect(doubanWeeklyToItem({
      id: 36808876, title: '奥德赛', rating: 8.6,
      cover_proxy: 'https://doubanio.viki.moe/view/photo/p1.jpg',
      cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
    }, false)).toEqual({
      id: '36808876', title: '奥德赛', cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
      rating: '8.6', isTv: false, kind: 'movie',
    });
  });

  it('原生 cover 缺失时回退 cover_proxy，0 分不输出 rating', () => {
    expect(doubanWeeklyToItem({
      id: 2, title: 'y', cover_proxy: 'https://doubanio.viki.moe/view/photo/p2.jpg',
    }, true)).toMatchObject({ cover: 'https://doubanio.viki.moe/view/photo/p2.jpg', isTv: true, kind: 'tv' });
    expect(doubanWeeklyToItem({ id: 1, title: 'x', cover: 'c', rating: 0 }, true)?.rating).toBeUndefined();
  });

  it.each([null, {}, { title: 'x', cover: 'c' }, { id: 1, cover: 'c' }, { id: 1, title: 'x' }, { id: {}, title: 'x', cover: 'c' }])(
    '缺 id、标题或封面的脏数据丢弃：%j', (raw) => {
      expect(doubanWeeklyToItem(raw, false)).toBeUndefined();
    }
  );

  it('透传 60s 真实排名、人数、年份、国家和完整演职员段落', () => {
    expect(doubanWeeklyToItem(movie, false)).toMatchObject({
      id: '35322132', kind: 'movie', rank: 1, year: '2026', ratingCount: 22225,
      countries: ['奥地利', '德国'], genres: ['剧情'],
      directors: ['马库斯·施莱泽'], actors: ['桑德拉·惠勒', '卡洛·布劳恩'], url: movie.url,
    });
    expect(doubanWeeklyToItem(movie, false)?.description).toBeUndefined();
    expect(doubanWeeklyToItem(movie, false)?.backdrop).toBeUndefined();
  });

  it('原生嵌套评分、评分人数和剧照首图正确映射', () => {
    expect(doubanWeeklyToItem(nativeMovie, false)).toMatchObject({
      cover: poster, rating: '8.5', ratingCount: 22229, backdrop: still,
    });
  });

  it('缺导演的四段 subtitle 不把演员误标为导演', () => {
    const item = doubanWeeklyToItem({
      ...movie, card_subtitle: '2026 / 英国 / 喜剧 纪录片 真人秀 / 杰里米·克拉克森 凯勒布·库珀',
    }, true, 'show');
    expect(item).toMatchObject({ kind: 'show', year: '2026', genres: ['喜剧', '纪录片', '真人秀'] });
    expect(item?.directors).toBeUndefined();
    expect(item?.actors).toBeUndefined();
  });

  it('详情优先使用结构化数据、完整 intro，正确识别综艺', () => {
    const item = doubanSubjectToItem({
      ...nativeMovie, type: 'tv', subtype: 'tv', is_tv: true, is_show: true,
      year: '2025', intro: '真实完整剧情\n第二段', description: '短介绍',
      genres: ['脱口秀'], countries: ['中国大陆'], durations: ['90分钟'],
      directors: [{ name: '贾思皓' }], actors: [{ name: '张绍刚' }, { name: '陈鲁豫' }],
    });
    expect(item).toMatchObject({
      kind: 'show', isTv: true, year: '2025', description: '真实完整剧情\n第二段',
      genres: ['脱口秀'], countries: ['中国大陆'], duration: '90分钟',
      directors: ['贾思皓'], actors: ['张绍刚', '陈鲁豫'],
    });
  });

  it('非法评分、负人数不输出；无剧情、剧照、年份时不编造', () => {
    const item = doubanWeeklyToItem({ id: 1, title: 'x', cover: poster, rating: NaN, rating_count: -1 }, false);
    expect(item).toEqual({ id: '1', title: 'x', cover: poster, isTv: false, kind: 'movie', rating: undefined });
  });
});

describe('baiduTeleplayToItem', () => {
  it('保留序号 id，透传剧情和排名，热度不映射评分', () => {
    expect(baiduTeleplayToItem({
      title: '某剧', cover: 'https://img.example/1.jpg', rank: 4, desc: '真实剧情',
      score: '95471', url: 'https://baike.baidu.com/item/某剧',
    }, 3)).toEqual({
      id: 'baidu_3', title: '某剧', cover: 'https://img.example/1.jpg', isTv: true, kind: 'tv',
      rank: 4, description: '真实剧情', url: 'https://baike.baidu.com/item/某剧',
    });
  });

  it('无海报条目丢弃', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: null }, 0)).toBeUndefined();
  });
});

describe('fetchHotList 来源、缓存和降级', () => {
  it('60s 成功则不发起其他请求，并复用服务端缓存', async () => {
    upstream.mockResolvedValueOnce(Response.json({ code: 200, data: [null, movie] }));
    const first = await fetchHotList('douban_movie_weekly');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ title: '罗斯', kind: 'movie', ratingCount: 22225 });
    expect(await fetchHotList('douban_movie_weekly')).toEqual(first);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['douban_movie_weekly', 'movie_weekly_best', 'movie'],
    ['douban_tv_chinese', 'tv_chinese_best_weekly', 'tv'],
    ['douban_tv_global', 'tv_global_best_weekly', 'tv'],
    ['douban_show_chinese', 'show_chinese_best_weekly', 'show'],
    ['douban_show_global', 'show_global_best_weekly', 'show'],
  ] as const)('60s 不通时 %s 回退正确豆瓣移动端榜单', async (id, collection, kind) => {
    upstream.mockRejectedValueOnce(new Error('连接失败'))
      .mockResolvedValueOnce(Response.json({ subject_collection_items: [nativeMovie] }));
    const items = await fetchHotList(id);
    expect(items[0]).toMatchObject({ kind, isTv: kind !== 'movie', rating: '8.5', ratingCount: 22229, backdrop: still });
    expect(upstream).toHaveBeenNthCalledWith(2,
      `https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=0&count=20`,
      expect.objectContaining({ timeoutMs: 8000, redirect: 'manual', safeRedirects: false,
        headers: expect.objectContaining({ Referer: 'https://m.douban.com/', 'User-Agent': expect.stringContaining('iPhone') }) })
    );
    expect(await fetchHotList(id)).toEqual(items);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 503, data: [movie] },
    { code: 200, data: [] },
    { code: 200, data: {} },
    { code: 200, data: [{ title: '缺 id 和封面' }] },
  ])('HTTP 200 的业务错误或坏数据也会触发降级：%j', async (payload) => {
    upstream.mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json({ subject_collection_items: [nativeMovie] }));
    expect(await fetchHotList('douban_movie_weekly')).toHaveLength(1);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('社区 403、豆瓣空榜时继续尝试官方实例', async () => {
    upstream.mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ subject_collection_items: [] }))
      .mockResolvedValueOnce(Response.json({ code: 200, data: [movie] }));
    expect(await fetchHotList('douban_movie_weekly')).toHaveLength(1);
    expect(upstream).toHaveBeenNthCalledWith(3,
      'https://60s.viki.moe/v2/douban/weekly/movie', expect.anything());
  });

  it('自部署实例优先，去除尾部斜杠', async () => {
    vi.stubEnv('60S_API_BASE', 'https://rank.example///');
    upstream.mockResolvedValueOnce(Response.json({ code: 200, data: [movie] }));
    await fetchHotList('douban_movie_weekly');
    expect(upstream).toHaveBeenCalledWith('https://rank.example/v2/douban/weekly/movie', expect.anything());
  });

  it('百度榜仅尝试两个 60s 实例，保留真实条数和剧集类别', async () => {
    upstream.mockRejectedValueOnce(new Error('连接失败'))
      .mockResolvedValueOnce(Response.json({ code: 200, data: [{ title: '九门', cover: poster, rank: 1, desc: '真实介绍' }] }));
    expect(await fetchHotList('baidu_teleplay')).toEqual([
      { id: 'baidu_0', title: '九门', cover: poster, rank: 1, description: '真实介绍', isTv: true, kind: 'tv' },
    ]);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream).toHaveBeenNthCalledWith(2, 'https://60s.viki.moe/v2/baidu/teleplay', expect.anything());
  });

  it('并发相同榜单合并为一次上游请求', async () => {
    let complete!: (response: Response) => void;
    upstream.mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }));
    const first = fetchHotList('douban_movie_weekly');
    const second = fetchHotList('douban_movie_weekly');
    expect(upstream).toHaveBeenCalledTimes(1);
    complete(Response.json({ code: 200, data: [movie] }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
  });

  it('一小时后刷新；短暂故障使用此前真榜单，超过 24 小时后报错', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    upstream.mockResolvedValueOnce(Response.json({ code: 200, data: [movie] }));
    const initial = await fetchHotList('douban_movie_weekly');
    clock.mockReturnValue(now + 2 * 60 * 60 * 1000);
    upstream.mockRejectedValue(new Error('全部离线'));
    expect(await fetchHotList('douban_movie_weekly')).toEqual(initial);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(await fetchHotList('douban_movie_weekly')).toEqual(initial);
    expect(upstream).toHaveBeenCalledTimes(4);
    clock.mockReturnValue(now + 25 * 60 * 60 * 1000);
    await expect(fetchHotList('douban_movie_weekly')).rejects.toThrow('全部离线');
  });

  it('从未成功取得数据时抛错，失败不缓存空列表', async () => {
    upstream.mockRejectedValue(new Error('全部离线'));
    await expect(fetchHotList('douban_movie_weekly')).rejects.toThrow('全部离线');
    upstream.mockResolvedValueOnce(Response.json({ code: 200, data: [movie] }));
    expect(await fetchHotList('douban_movie_weekly')).toHaveLength(1);
  });
});
