import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => null),
  jsonError: (message: string, status: number) => Response.json({ error: message }, { status }),
}));
vi.mock('@/lib/ssrf', () => ({
  isValidProxyUrl: vi.fn(() => true),
  isBlockedByDNS: vi.fn(async () => false),
  checkLiveUrlAllowed: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));

import { fetchWithSafeRedirects } from './fetch-utils';
import { isBlockedByDNS } from './ssrf';
import { handleLiveStreamRequest, handleProxyRequest } from './proxy-handlers';

const fetchMock = vi.mocked(fetchWithSafeRedirects);
const request = () => new Request('https://kongwotv.example/api/proxy');
const manifest = '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST';

beforeEach(() => { vi.clearAllMocks(); });

describe('proxy playback responses', () => {
  it('rewrites a signed m3u8 response using its redirect destination', async () => {
    fetchMock.mockResolvedValue({
      res: new Response(manifest, { headers: { 'content-type': 'text/plain' } }),
      finalUrl: 'https://cdn.example/final/index.m3u8?token=signed',
    });
    const response = await handleProxyRequest(request(), 'https://cdn.example/original.m3u8?token=signed');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('mpegurl');
    expect(await response.text()).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example/final/segment.ts'));
  });

  it('passes a Baofeng-style 404 through without rewriting HTML or caching it', async () => {
    const html = '<!DOCTYPE html><title>404 Not Found</title>';
    fetchMock.mockResolvedValue({
      res: new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      finalUrl: 'https://cdn.example/movie/index.m3u8',
    });
    const response = await handleProxyRequest(request(), 'https://cdn.example/movie/index.m3u8');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-upstream-status')).toBe('404');
    expect(await response.text()).toBe(html);
  });

  it('detects extensionless live HLS and proxies separate audio renditions', async () => {
    fetchMock.mockResolvedValue({
      res: new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/index.m3u8', { headers: { 'content-type': 'text/plain' } }),
      finalUrl: 'https://cdn.example/live/channel?id=1',
    });
    const response = await handleLiveStreamRequest(request(), 'https://cdn.example/channel');
    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('mpegurl');
    expect(text).toContain('URI="/api/live/stream?url=' + encodeURIComponent('https://cdn.example/live/audio/index.m3u8') + '"');
    expect(text).toContain('/api/live/stream?url=' + encodeURIComponent('https://cdn.example/live/video/index.m3u8'));
  });

  it('keeps the DNS SSRF guard before making any upstream request', async () => {
    vi.mocked(isBlockedByDNS).mockResolvedValueOnce(true);
    const response = await handleProxyRequest(request(), 'https://blocked.example/movie.m3u8');
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
