import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import type { SearchResponse, SearchStreamEvent } from '@/lib/types';

/**
 * 聚合搜索接口单测：跨源聚合、同源去重、精确命中置顶、成人内容过滤、
 * 失败源不影响整体、SSRF 字面量拒绝。上游一律 mock fetch，无真实网络。
 */

function cmsList(items: Array<Record<string, unknown>>, pagecount = 1): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

/** 按 URL 分发的上游 mock：cms-a 正常、cms-b 500、cms-c 与 a 有重叠条目 */
function mockUpstream(): void {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cms-a.example')) {
      return new Response(
        cmsList([
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
          { vod_id: 2, vod_name: '测试剧外传', type_name: '国产剧' },
          { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
          // 同源同 vod_id 的重复条目：聚合时须按 sourceKey_vodId 去重
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('cms-b.example')) {
      return new Response('server error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
}

function makeRequest(body: unknown, stream = false): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/search${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/search', () => {
  it('聚合多源结果：同源去重、成人内容过滤、失败源进 failures', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: SOURCES, filterAdult: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ sourceKey: string; vodId: string; name: string }>;
      failures: Array<{ sourceKey: string; error: string }>;
    };

    // 源A 的 4 条 → 去重后 2 条有效 + 成人条目被过滤
    const aItems = data.list.filter((i) => i.sourceKey === 'a');
    expect(aItems).toHaveLength(2);
    expect(aItems.map((i) => i.vodId).sort()).toEqual(['1', '2']);

    // 源B 500 → 记入 failures，不影响源A 的结果
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].sourceKey).toBe('b');
    expect(data.failures[0].error).toContain('500');
  });

  it('精确命中（忽略标点差异）排在最前', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: [SOURCES[0]], filterAdult: true }));
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(data.list[0]?.name).toBe('测试剧');
  });

  it('内网字面量地址在发起请求前被 SSRF 校验拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      makeRequest({
        wd: 'x',
        sources: [{ key: 'evil', name: '内网', url: 'http://192.168.1.100/api.php' }],
        filterAdult: false,
      })
    );
    const data = (await res.json()) as { failures: Array<{ sourceKey: string; error: string }> };
    expect(data.failures[0]?.sourceKey).toBe('evil');
    // 上游一次请求都不应发生
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream=1 以 NDJSON 逐源推送并以 done 事件收尾', async () => {
    mockUpstream();
    // 用不同关键词避开同键短缓存（缓存命中时只推 done 事件，见 route.ts 缓存分支）
    const res = await POST(makeRequest({ wd: '流式检测关键词', sources: SOURCES, filterAdult: true }, true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sourceKey?: string });
    const sources = lines.filter((l) => l.type === 'source');
    const done = lines.filter((l) => l.type === 'done');
    // 每个源恰好一条 source 事件（含失败的源B），最后一条是 done
    expect(sources.map((l) => l.sourceKey).sort()).toEqual(['a', 'b']);
    expect(done).toHaveLength(1);
    expect(lines[lines.length - 1].type).toBe('done');
  });

  it.each([
    { stream: false, filterAdult: true },
    { stream: false, filterAdult: false },
    { stream: true, filterAdult: true },
    { stream: true, filterAdult: false },
  ])('按片名屏蔽电影解说，包括分页与缓存（stream=$stream, filterAdult=$filterAdult）', async ({ stream, filterAdult }) => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get('pg');
      const list = page === '2' ? [
        { vod_id: 4, vod_name: '星际穿越 特别版' },
        { vod_id: 5, vod_name: '星际穿越【电影解说】' },
        { vod_id: 6, vod_name: '星际电影解说穿越' },
      ] : [
        // 分类名称不参与此项屏蔽，片名正常的影片保留。
        { vod_id: 1, vod_name: '星际穿越', type_name: '电影解说' },
        { vod_id: 2, vod_name: '电影解说：星际穿越' },
        { vod_id: 3, vod_name: '电影解说' },
      ];
      return new Response(cmsList(list, 2), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const source = { ...SOURCES[0], url: `https://cms-a.example.com/title-filter-${stream}-${filterAdult}.php` };
    const body = { wd: '星际穿越', sources: [source], filterAdult };
    const expected = ['星际穿越', '星际穿越 特别版'];
    const assertResult = async (response: Response, streamed: boolean, cached: boolean) => {
      expect(response.status).toBe(200);
      if (streamed) {
        const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
        expect(events.map((event) => event.type)).toEqual(cached ? ['done'] : ['source', 'done']);
        for (const event of events) expect(event.list.map((item) => item.name)).toEqual(expected);
      } else {
        const data = await response.json() as SearchResponse;
        expect(data.list.map((item) => item.name)).toEqual(expected);
      }
    };

    await assertResult(await POST(makeRequest(body, stream)), stream, false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // 换用另一种响应模式，仍应命中同一份已过滤的缓存。
    await assertResult(await POST(makeRequest(body, !stream)), !stream, true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('搜索周星驰时保留正片且相关性回退不会恢复相邻电影解说（stream=%s）', async (stream) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([
      { vod_id: 1, vod_name: '功夫足球' },
      { vod_id: 2, vod_name: '功夫足球电影解说' },
      { vod_id: 3, vod_name: '少林足球【电影解说】' },
      { vod_id: 4, vod_name: '功夫' },
      { vod_id: 5, vod_name: '功夫【电影解说】' },
    ]), { headers: { 'Content-Type': 'application/json' } })));
    const source = { ...SOURCES[0], url: `https://cms-a.example.com/actor-commentary-${stream}.php` };
    const response = await POST(makeRequest({ wd: '周星驰', sources: [source], filterAdult: false }, stream));
    expect(response.status).toBe(200);
    const assertTitles = (list: SearchResponse['list']) => {
      expect(list.map((item) => item.name).sort()).toEqual(['功夫', '功夫足球']);
    };
    if (stream) {
      const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
      expect(events.map((event) => event.type)).toEqual(['source', 'done']);
      events.forEach((event) => assertTitles(event.list));
    } else assertTitles((await response.json() as SearchResponse).list);
  });

  it.each([false, true])('只有电影解说时返回空结果且不会被相关性回退恢复（stream=%s）', async (stream) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([
      { vod_id: 1, vod_name: '星际穿越【电影解说】' },
      { vod_id: 2, vod_name: '电影解说：星际穿越' },
    ]), { headers: { 'Content-Type': 'application/json' } })));
    const source = { ...SOURCES[0], url: `https://cms-a.example.com/only-commentary-${stream}.php` };
    const res = await POST(makeRequest({ wd: '星际穿越', sources: [source], filterAdult: false }, stream));
    expect(res.status).toBe(200);
    if (stream) {
      const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
      expect(events.map((event) => event.type)).toEqual(['source', 'done']);
      for (const event of events) expect(event.list).toEqual([]);
      const done = events.find((event) => event.type === 'done');
      expect(done?.failures).toEqual([]);
    } else {
      expect(await res.json()).toEqual({ list: [], failures: [] });
    }
  });

  it('未配置密码时无需 Cookie 即可搜索', async () => {
    vi.stubEnv('PASSWORD', '');
    mockUpstream();
    try {
      const request = new Request('https://local.test/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wd: '免密码搜索', sources: SOURCES }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json() as SearchResponse;
      expect(data.list.some((item) => item.sourceKey === 'a')).toBe(true);
      expect(fetch).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('显式配置密码时仍要求有效会话', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const noCookie = new Request('https://local.test/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd: 'x', sources: SOURCES }),
    });
    expect((await POST(noCookie)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('搜索请求与来源身份隔离', () => {
  it.each([null, { wd: 123, sources: SOURCES }, { wd: 'test', sources: [null] }, { wd: 'test', sources: [{ key: 'a', name: 'A', url: 123 }] }])('异常输入返回 400 而不是抛出服务错误：%j', async (body) => {
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it('同地址重导入或改名后返回当前来源身份，不复用旧 key/name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ list: [{ vod_id: 9, vod_name: '来源身份隔离' }] })));
    const url = 'https://cms-a.example.com/identity-cache.php';
    const first = await POST(makeRequest({ wd: '来源身份隔离', sources: [{ key: 'old', name: '旧源', url }] }));
    expect((await first.json()).list[0]).toMatchObject({ sourceKey: 'old', sourceName: '旧源' });
    const second = await POST(makeRequest({ wd: '来源身份隔离', sources: [{ key: 'new', name: '新源', url }] }));
    expect((await second.json()).list[0]).toMatchObject({ sourceKey: 'new', sourceName: '新源' });
  });
});
