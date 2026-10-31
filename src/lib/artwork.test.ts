import { describe, expect, it, vi } from 'vitest';
import catalog from '../../shared/artwork-catalog.json';
import { artworkPath, catalogBackdrop, normalizeArtworkTitle, parseArtworkIdentity, selectTmdbBackdrop,
  selectTmdbMatch, sourceArtworkIds, type ArtworkIdentity, type CatalogArtwork } from './artwork';
import { createArtworkResolver } from './artwork-provider';

const identity: ArtworkIdentity = { title: '未内置测试影片', year: '2020', mediaType: 'movie' };
const images = { backdrops: [{ file_path: '/ValidBackdrop123.jpg', width: 3840, height: 2160, iso_639_1: null }] };
const search = { results: [{ id: 12345, title: identity.title, original_title: 'An Original Film', release_date: '2020-03-04' }] };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('artwork identity and image selection', () => {
  it('matches the verified image without changing poster identity or requiring credentials', () => {
    expect(catalogBackdrop({ title: '燃烧女子的肖像', year: '2019' })).toMatchObject({ width: 3840, height: 2160, mediaId: 531428, match: 'catalog' });
    expect(catalogBackdrop({ title: '燃烧女子的肖像', year: '2020' })).toBeUndefined();
    expect(catalogBackdrop({ title: '燃烧女子的肖像', year: '2019', mediaType: 'tv' })).toBeUndefined();
    expect(catalogBackdrop({ title: '燃烧女子的肖像' })).toBeUndefined();
  });
  it('matches Avengers: Endgame by its Chinese title and year without a TMDB credential', () => {
    expect(catalogBackdrop({ title: '复仇者联盟4：终局之战', year: '2019', mediaType: 'movie' }))
      .toMatchObject({ url: 'https://image.tmdb.org/t/p/original/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg', width: 3840, height: 2160, mediaId: 299534, match: 'catalog' });
  });
  it('uses stable IDs without guessing titles, but rejects contradictory IDs or years', () => {
    expect(catalogBackdrop({ title: '另一译名', doubanId: '30257175' })?.mediaId).toBe(531428);
    expect(catalogBackdrop({ title: '燃烧女子的肖像', year: '2019', tmdbId: 1, doubanId: '30257175' })).toBeUndefined();
    expect(catalogBackdrop({ title: '任意译名', tmdbId: 531428, year: '2021' })).toBeUndefined();
    const incomplete = { ...(catalog.items[0] as CatalogArtwork), imdbId: undefined };
    expect(catalogBackdrop({ title: '任意译名', year: '2019', doubanId: '30257175', imdbId: 'tt8613070' }, [incomplete])?.mediaId).toBe(531428);
    expect(catalogBackdrop({ title: '任意译名', imdbId: 'tt8613070' }, [incomplete])).toBeUndefined();
  });
  it('refuses ambiguous curated titles rather than using whichever comes first', () => {
    const original = catalog.items[0] as CatalogArtwork;
    expect(catalogBackdrop({ title: original.titles[0], year: original.year }, [original, { ...original, tmdbId: 99 }])).toBeUndefined();
  });
  it('keeps every shipped curated record a valid, resolvable landscape image', () => {
    expect(catalog.items.length).toBeGreaterThanOrEqual(6);
    for (const entry of catalog.items) {
      expect(catalogBackdrop({ title: entry.titles[0], year: entry.year, mediaType: entry.mediaType as 'movie' | 'tv', tmdbId: entry.tmdbId })).toMatchObject({ mediaId: entry.tmdbId });
    }
  });
  it('normalizes punctuation and full-width text without erasing distinguishing sequel words', () => {
    expect(normalizeArtworkTitle('Ａ Film： Part ２')).toBe(normalizeArtworkTitle('a film part 2'));
    expect(normalizeArtworkTitle('燃烧女子的肖像【电影解说】')).not.toBe(normalizeArtworkTitle('燃烧女子的肖像'));
  });
  it('rejects remakes, different media types, and ambiguous exact matches', () => {
    const raw = { results: [
      { id: 1, title: identity.title, release_date: '1990-01-01', media_type: 'movie', popularity: 9999 },
      { id: 2, name: identity.title, first_air_date: '2020-01-01', media_type: 'tv' },
      { id: 3, title: identity.title, release_date: '2020-01-01', media_type: 'movie' },
    ] };
    expect(selectTmdbMatch(raw, identity)).toEqual({ id: 3, mediaType: 'movie' });
    expect(selectTmdbMatch({ results: [...raw.results, { ...raw.results[2], id: 4 }] }, identity)).toBeUndefined();
    expect(selectTmdbMatch(raw, { title: identity.title })).toBeUndefined();
    expect(selectTmdbMatch({ ...raw, total_pages: 2 }, identity)).toBeUndefined();
  });
  it('accepts an exact original title and deduplicates identical search rows', () => {
    const row = { id: 12345, title: '译名', original_title: identity.title, release_date: '2020-06-01' };
    expect(selectTmdbMatch({ results: [row, row] }, identity, 'movie')).toEqual({ id: 12345, mediaType: 'movie' });
    expect(selectTmdbMatch({ results: [{ ...row, original_title: identity.title + '续集' }] }, identity, 'movie')).toBeUndefined();
  });
  it('never treats a poster, logo, tiny image, or arbitrary URL as a high-quality background', () => {
    const bad = { backdrops: [
      { file_path: '/Poster.jpg', width: 1500, height: 2250 },
      { file_path: '/Small.jpg', width: 640, height: 360 },
      { file_path: 'https://example.com/a.jpg', width: 3840, height: 2160 },
      { file_path: '/../bad.jpg', width: 3840, height: 2160 },
      { file_path: '/Floating.jpg', width: 3840.5, height: 2160 },
    ], logos: images.backdrops };
    expect(selectTmdbBackdrop(bad, { id: 1, mediaType: 'movie' })).toBeUndefined();
    expect(artworkPath('/x.jpg?resize=small')).toBe(false);
    expect(selectTmdbBackdrop({ backdrops: [...bad.backdrops, ...images.backdrops] }, { id: 1, mediaType: 'movie' })?.width).toBe(3840);
  });
  it('prefers a large language-free background over a title-bearing image', () => {
    const raw = { backdrops: [
      { file_path: '/TextImage.jpg', width: 3840, height: 2160, iso_639_1: 'en', vote_average: 10 },
      { file_path: '/CleanImage.jpg', width: 1920, height: 1080, iso_639_1: null, vote_average: 2 },
    ] };
    expect(selectTmdbBackdrop(raw, { id: 1, mediaType: 'movie' })?.url).toContain('/CleanImage.jpg');
  });
  it('preserves only safe source IDs and leaves old records valid', () => {
    expect(sourceArtworkIds({ vod_tmdb_id: '531428', vod_imdb_id: 'tt8613070', vod_douban_id: 30257175 })).toEqual({ tmdbId: 531428, imdbId: 'tt8613070', doubanId: '30257175' });
    expect(sourceArtworkIds({ vod_tmdb_id: '../12', vod_imdb_id: 'https://example.com', vod_douban_id: 0 })).toEqual({});
    expect(sourceArtworkIds({})).toEqual({});
    expect(parseArtworkIdentity({ title: '电影', tmdbId: '../12' })).toBeUndefined();
    expect(parseArtworkIdentity({ title: '电影', url: 'http://127.0.0.1' })).toEqual({ title: '电影' });
  });
});

describe('artwork provider cache and failure behavior', () => {
  it('does not call TMDB when no own credential is configured', async () => {
    const fetcher = vi.fn(async () => response(search));
    const resolve = createArtworkResolver({ fetcher });
    expect(await resolve(identity)).toMatchObject({ artwork: null, configured: false, status: 'not-configured' });
    expect(await resolve({ title: '燃烧女子的肖像', year: '2019' })).toMatchObject({ artwork: { width: 3840 }, status: 'matched' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent work and caches successful metadata for 24 hours', async () => {
    let now = 1000;
    const fetcher = vi.fn(async (url: string) => response(url.includes('/search/') ? search : images));
    const resolve = createArtworkResolver({ fetcher, now: () => now });
    const values = await Promise.all([resolve(identity, 'own-key'), resolve(identity, 'own-key'), resolve(identity, 'own-key')]);
    expect(values.every((value) => value.artwork?.width === 3840)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 23 * 60 * 60 * 1000;
    await resolve(identity, 'own-key');
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 2 * 60 * 60 * 1000;
    await resolve(identity, 'own-key');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('negative caches failures briefly, and changing credentials immediately permits a retry', async () => {
    let now = 1000;
    const fetcher = vi.fn(async () => { throw new Error('private-url-with-secret'); });
    const resolve = createArtworkResolver({ fetcher, now: () => now });
    const failed = await resolve(identity, 'bad-own-key');
    expect(failed).toEqual({ artwork: null, configured: true, status: 'unavailable' });
    expect(JSON.stringify(failed)).not.toContain('secret');
    await resolve(identity, 'bad-own-key');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolve(identity, 'changed-own-key');
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 10 * 60 * 1000 + 1;
    await resolve(identity, 'bad-own-key');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('keeps credentials on the fixed API host and refuses credential redirects', async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input); requests.push({ url, init });
      return response(url.pathname.includes('/search/') ? search : images);
    });
    const resolve = createArtworkResolver({ fetcher });
    await resolve(identity, 'aaa.bbb.ccc');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.origin).toBe('https://api.themoviedb.org');
      expect(request.url.searchParams.has('api_key')).toBe(false);
      expect(request.init.redirect).toBe('error');
      expect(request.init.headers).toMatchObject({ Authorization: 'Bearer aaa.bbb.ccc' });
    }
  });
  it('bounds responses and fails closed on malformed upstream metadata', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1)));
    const resolve = createArtworkResolver({ fetcher });
    expect(await resolve(identity, 'own-key')).toMatchObject({ artwork: null, status: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not turn a known stable-ID conflict into a remote title guess', async () => {
    const fetcher = vi.fn(async () => response(search));
    const value = await createArtworkResolver({ fetcher })({ title: '燃烧女子的肖像', year: '2019', tmdbId: 531428, doubanId: '1889243', mediaType: 'movie' }, 'own-key');
    expect(value).toMatchObject({ artwork: null, status: 'not-found' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not request images after an ambiguous or different-year search result', async () => {
    const fetcher = vi.fn(async () => response({ results: [{ ...search.results[0], release_date: '1999-01-01' }] }));
    expect(await createArtworkResolver({ fetcher })(identity, 'own-key')).toMatchObject({ artwork: null, status: 'not-found' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
