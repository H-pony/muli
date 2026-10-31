import { createHash } from 'node:crypto';
import {
  artworkYear, catalogBackdrop, catalogIdentityConflict, normalizeArtworkTitle, selectTmdbBackdrop,
  selectTmdbMatch, tmdbDetailMatches, validArtworkCredential,
  type ArtworkIdentity, type BackdropArtwork, type TmdbMatch,
} from './artwork';

export interface ArtworkResult {
  artwork: BackdropArtwork | null;
  configured: boolean;
  status: 'matched' | 'not-configured' | 'not-found' | 'unavailable';
}
const SUCCESS_TTL = 24 * 60 * 60 * 1000;
const FAILURE_TTL = 10 * 60 * 1000;
const MAX_RESPONSE = 1024 * 1024;
const API_ORIGIN = 'https://api.themoviedb.org/3';
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** The upstream host cannot be supplied by a caller, and redirects never receive credentials. */
async function jsonRequest(path: string, params: Record<string, string>, credential: string, signal: AbortSignal, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const url = new URL(API_ORIGIN + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Muli/2.16.12 (Artwork)' };
  if (credential.includes('.')) headers.Authorization = `Bearer ${credential}`;
  else url.searchParams.set('api_key', credential);
  const response = await fetcher(url.href, { headers, redirect: 'error', signal, cache: 'no-store' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > MAX_RESPONSE) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Artwork upstream unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new Error('Artwork response exceeded limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid artwork metadata');
  return data as Record<string, unknown>;
}

function externalMatch(raw: Record<string, unknown>, identity: ArtworkIdentity): TmdbMatch | undefined {
  const year = artworkYear(identity.year);
  const matches = new Map<string, TmdbMatch>();
  for (const mediaType of ['movie', 'tv'] as const) {
    if (identity.mediaType && identity.mediaType !== mediaType) continue;
    const results = raw[`${mediaType}_results`];
    if (!Array.isArray(results)) continue;
    for (const value of results) {
      if (!value || typeof value !== 'object') continue;
      const row = value as Record<string, unknown>;
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) continue;
      if (year && artworkYear(mediaType === 'movie' ? row.release_date : row.first_air_date) !== year) continue;
      matches.set(`${mediaType}:${row.id}`, { id: row.id, mediaType });
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}

export function createArtworkResolver(options: { fetcher?: Fetcher; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; value: ArtworkResult }>();
  const pending = new Map<string, Promise<ArtworkResult>>();
  return async (identity: ArtworkIdentity, rawCredential = ''): Promise<ArtworkResult> => {
    const credential = rawCredential.trim().replace(/^Bearer\s+/i, '');
    const configured = !!credential && validArtworkCredential(credential);
    const builtIn = catalogBackdrop(identity);
    if (builtIn) return { artwork: builtIn, configured, status: 'matched' };
    if (!configured) return { artwork: null, configured: false, status: 'not-configured' };
    if (catalogIdentityConflict(identity)) return { artwork: null, configured, status: 'not-found' };
    if (!identity.tmdbId && !identity.imdbId && !artworkYear(identity.year)) return { artwork: null, configured, status: 'not-found' };
    const credentialId = createHash('sha256').update(credential).digest('hex').slice(0, 24);
    const key = JSON.stringify([normalizeArtworkTitle(identity.title), artworkYear(identity.year), identity.mediaType,
      identity.tmdbId, identity.imdbId, identity.doubanId, credentialId]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    if (pending.size >= 128) return { artwork: null, configured, status: 'unavailable' };
    const operation = (async (): Promise<ArtworkResult> => {
      let value: ArtworkResult;
      try {
        const signal = AbortSignal.timeout(8000);
        const get = (path: string, params: Record<string, string> = {}) => jsonRequest(path, params, credential, signal, fetcher);
        let match: TmdbMatch | undefined;
        if (identity.tmdbId) {
          if (identity.mediaType) {
            const details = await get(`/${identity.mediaType}/${identity.tmdbId}`, { language: 'zh-CN' });
            if (tmdbDetailMatches(details, identity, identity.mediaType)) match = { id: identity.tmdbId, mediaType: identity.mediaType };
          }
        } else if (identity.imdbId) {
          match = externalMatch(await get(`/find/${identity.imdbId}`, { external_source: 'imdb_id', language: 'zh-CN' }), identity);
        } else {
          const kind = identity.mediaType ?? 'multi';
          const params: Record<string, string> = { query: identity.title, language: 'zh-CN', include_adult: 'false', page: '1' };
          const year = artworkYear(identity.year);
          if (year && kind === 'movie') params.year = year;
          if (year && kind === 'tv') params.first_air_date_year = year;
          const result = await get(`/search/${kind}`, params);
          match = selectTmdbMatch(result, identity, identity.mediaType);
        }
        const artwork = match ? selectTmdbBackdrop(await get(`/${match.mediaType}/${match.id}/images`, { include_image_language: 'null,zh,en' }), match) : undefined;
        value = { artwork: artwork ?? null, configured, status: artwork ? 'matched' : 'not-found' };
      } catch {
        // Never propagate upstream URLs or credential-bearing request errors to clients/logs.
        value = { artwork: null, configured, status: 'unavailable' };
      }
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now() + (value.artwork ? SUCCESS_TTL : FAILURE_TTL), value });
      return value;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}

export const resolveArtwork = createArtworkResolver();
