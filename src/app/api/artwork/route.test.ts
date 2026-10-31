import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(() => null) }));
import { guardRequest } from '@/lib/api-guard';
import { GET, POST } from './route';

const post = (value: unknown) => new Request('http://localhost/api/artwork', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.mocked(guardRequest).mockReturnValue(null);
  for (const name of ['TMDB_API_KEY', 'TMDB_READ_TOKEN', 'TMDB_ACCESS_TOKEN']) vi.stubEnv(name, '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('artwork route', () => {
  it('uses the same session guard as the other app APIs', async () => {
    vi.mocked(guardRequest).mockReturnValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    expect((await GET(new Request('http://localhost/api/artwork'))).status).toBe(401);
    expect((await POST(post({ title: '燃烧女子的肖像', year: '2019' }))).status).toBe(401);
  });
  it('reports only whether server credentials exist, never their values', async () => {
    vi.stubEnv('TMDB_API_KEY', 'private-server-test-key');
    const result = await GET(new Request('http://localhost/api/artwork'));
    expect(await result.json()).toEqual({ configured: true });
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns verified full-resolution artwork without requiring a key', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const result = await POST(post({ title: '燃烧女子的肖像', year: '2019', mediaType: 'movie' }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ artwork: { width: 3840, height: 2160, mediaId: 531428 }, configured: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('leaves an unmatched film on its ordinary background when no key is configured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const result = await POST(post({ title: '其他电影', year: '2020' }));
    expect(await result.json()).toEqual({ artwork: null, configured: false, status: 'not-configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects invalid identity and credentials without reflecting them', async () => {
    const invalid = await POST(post({ title: '电影', year: '2020', credential: 'private\r\ncredential' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain('private');
    expect((await POST(post({ title: '电影', mediaType: 'person' }))).status).toBe(400);
    expect((await POST(post({ title: '电影', tmdbId: '../12' }))).status).toBe(400);
  });
  it('rejects oversized bodies before forwarding any requests', async () => {
    const result = await POST(new Request('http://localhost/api/artwork', { method: 'POST', body: 'x'.repeat(8193) }));
    expect(result.status).toBe(413);
  });
});
