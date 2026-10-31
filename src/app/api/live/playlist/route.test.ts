import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkLiveUrlAllowed } from '@/lib/ssrf';
import { parseM3u, parseM3uEpg } from '@/lib/m3u-parser';
import { BUILTIN_LIVE_URL, builtinLivePlaylist } from '@/lib/default-live-sources';

const state = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  text: '',
}));

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkLiveUrlAllowed: vi.fn() }));
vi.mock('@/lib/live-cache', () => ({
  getLiveCache: vi.fn((key: string) => state.cache.get(key)),
  setLiveCache: vi.fn((key: string, value: unknown) => state.cache.set(key, value)),
}));

const SOURCE_URL = 'https://feeds.example.com/tv/list.m3u';
const CHANNEL_LINES = [
  '#PLAYLIST:测试直播',
  '#EXTINF:-1 tvg-id="CCTV1" tvg-logo="/logos/cctv1.png" group-title="央视",CCTV-1',
  'https://streams.example.com/cctv1.m3u8',
].join('\n');

function makeRequest(params: Record<string, string> = {}): Request {
  const { token } = signSession();
  const sp = new URLSearchParams({ url: SOURCE_URL, ...params });
  return new Request(`https://local.test/api/live/playlist?${sp.toString()}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PASSWORD', 'test-password');
  vi.stubEnv('PROXY_SECRET', '');
  state.cache.clear();
  state.text = `#EXTM3U x-tvg-url="../guide.xml.gz"\n${CHANNEL_LINES}`;
  vi.mocked(checkLiveUrlAllowed).mockResolvedValue({ ok: true });
  vi.mocked(fetchUpstream).mockImplementation(async () => new Response(state.text));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/live/playlist', () => {
  it('内置频道直接读取随包数据，刷新和导出均不重新引入上游坏条目', async () => {
    const response = await GET(makeRequest({ url: BUILTIN_LIVE_URL, force: '1' }));
    expect(await response.json()).toEqual(builtinLivePlaylist());
    const exported = await GET(makeRequest({ url: BUILTIN_LIVE_URL, format: 'm3u' }));
    expect(parseM3u(await exported.text()).map((channel) => channel.url))
      .toEqual(builtinLivePlaylist().channels.map((channel) => channel.url));
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(checkLiveUrlAllowed).not.toHaveBeenCalled();
  });

  it('内置路径的变体或目录穿越仍按任意订阅地址校验', async () => {
    vi.mocked(checkLiveUrlAllowed).mockResolvedValue({ ok: false, reason: '无效的订阅地址' });
    for (const url of ['/live/../verified.m3u', '/live/verified.m3u?file=/etc/passwd']) {
      const response = await GET(makeRequest({ url }));
      expect(response.status).toBe(403);
    }
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('返回解析后的 EPG 元数据，只请求和校验订阅地址', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: '测试直播',
      epg: 'https://feeds.example.com/guide.xml.gz',
      groups: ['央视'],
      channels: [{
        name: 'CCTV-1',
        tvgId: 'CCTV1',
        logo: 'https://feeds.example.com/logos/cctv1.png',
        url: 'https://streams.example.com/cctv1.m3u8',
      }],
    });
    expect(checkLiveUrlAllowed).toHaveBeenCalledOnce();
    expect(checkLiveUrlAllowed).toHaveBeenCalledWith(SOURCE_URL);
    expect(fetchUpstream).toHaveBeenCalledOnce();
    expect(fetchUpstream).toHaveBeenCalledWith(SOURCE_URL, {
      timeoutMs: 15000,
      retries: 1,
      allowPrivate: true,
    });
  });

  it('从缓存导出 M3U 保留 EPG 及频道，无需再次请求上游', async () => {
    await GET(makeRequest());
    const res = await GET(makeRequest({ format: 'm3u' }));
    const text = await res.text();
    expect(res.headers.get('content-type')).toContain('audio/x-mpegurl');
    expect(text).toContain('#EXTM3U x-tvg-url="https://feeds.example.com/guide.xml.gz"');
    expect(parseM3uEpg(text)).toBe('https://feeds.example.com/guide.xml.gz');
    expect(parseM3u(text)).toHaveLength(1);
    expect(parseM3u(text)[0]).toMatchObject({ name: 'CCTV-1', tvgId: 'CCTV1', group: '央视' });
    expect(fetchUpstream).toHaveBeenCalledOnce();
    expect(checkLiveUrlAllowed).toHaveBeenCalledTimes(2);
  });

  it('直接导出时同样读取 EPG 的别名属性', async () => {
    state.text = `#EXTM3U url-tvg="https://epg.example.com/guide.xml"\n${CHANNEL_LINES}`;
    const res = await GET(makeRequest({ format: 'm3u' }));
    expect(parseM3uEpg(await res.text())).toBe('https://epg.example.com/guide.xml');
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it('无 EPG 的订阅继续可用，JSON 和导出均不附加节目单', async () => {
    state.text = `#EXTM3U\n${CHANNEL_LINES}`;
    const json = await GET(makeRequest());
    const data = await json.json();
    expect(data).not.toHaveProperty('epg');
    expect(data.channels).toHaveLength(1);
    const exported = await GET(makeRequest({ format: 'm3u' }));
    expect((await exported.text()).split('\n')[0]).toBe('#EXTM3U');
  });

  it('忽略非 http(s) EPG，不影响频道解析或导出', async () => {
    state.text = `#EXTM3U x-tvg-url="javascript:alert(1)"\n${CHANNEL_LINES}`;
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data).not.toHaveProperty('epg');
    expect(data.channels).toHaveLength(1);
    const exported = await GET(makeRequest({ format: 'm3u' }));
    expect(await exported.text()).not.toContain('javascript:');
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it('force=1 更新缓存中的 EPG，而非沿用旧元数据', async () => {
    await GET(makeRequest());
    state.text = `#EXTM3U tvg-url="https://epg.example.com/new.xml.gz"\n${CHANNEL_LINES}`;
    const res = await GET(makeRequest({ force: '1' }));
    expect((await res.json()).epg).toBe('https://epg.example.com/new.xml.gz');
    const cached = await GET(makeRequest());
    expect((await cached.json()).epg).toBe('https://epg.example.com/new.xml.gz');
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('命中缓存时也必须通过 SSRF 校验，不请求被拦截的源', async () => {
    await GET(makeRequest());
    vi.mocked(checkLiveUrlAllowed).mockResolvedValue({ ok: false, reason: '目标地址解析到私有/保留网络' });
    const res = await GET(makeRequest({ format: 'm3u' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '目标地址解析到私有/保留网络' });
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it('未登录时不会请求或解析订阅', async () => {
    const res = await GET(new Request(`https://local.test/api/live/playlist?url=${encodeURIComponent(SOURCE_URL)}`));
    expect(res.status).toBe(401);
    expect(checkLiveUrlAllowed).not.toHaveBeenCalled();
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});
