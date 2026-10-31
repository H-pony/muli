import catalog from '../../shared/artwork-catalog.json';

export type ArtworkMediaType = 'movie' | 'tv';
export interface ArtworkIdentity {
  title: string;
  year?: string;
  mediaType?: ArtworkMediaType;
  tmdbId?: number;
  imdbId?: string;
  doubanId?: string;
}
export interface BackdropArtwork {
  url: string;
  width: number;
  height: number;
  provider: 'tmdb';
  mediaType: ArtworkMediaType;
  mediaId: number;
  match: 'catalog' | 'api';
}
export interface CatalogArtwork {
  mediaType: ArtworkMediaType;
  tmdbId: number;
  imdbId?: string;
  doubanId?: string;
  year: string;
  titles: string[];
  backdropPath: string;
  width: number;
  height: number;
}
export interface TmdbMatch {
  id: number;
  mediaType: ArtworkMediaType;
}

export const TMDB_IMAGE_ORIGIN = 'https://image.tmdb.org/t/p/original';
export const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export function normalizeArtworkTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function artworkYear(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  return String(value).match(/(?:^|\D)((?:18|19|20|21)\d{2})(?:\D|$)/)?.[1];
}

export function inferArtworkMediaType(value?: string): ArtworkMediaType | undefined {
  if (!value) return undefined;
  if (/电影|電影|movie|film/i.test(value) || /^(?:剧情|动作|科幻|爱情|喜剧|恐怖|战争|惊悚|悬疑|动画|纪录|紀錄).*片$/.test(value)) return 'movie';
  if (/电视剧|電視劇|连续剧|連續劇|综艺|綜藝|动漫|動畫|动画|series|\btv\b/i.test(value)) return 'tv';
  return undefined;
}

export function sourceArtworkIds(row: Record<string, unknown>): Pick<ArtworkIdentity, 'tmdbId' | 'imdbId' | 'doubanId'> {
  const result: Pick<ArtworkIdentity, 'tmdbId' | 'imdbId' | 'doubanId'> = {};
  const tmdb = String(row.vod_tmdb_id ?? row.tmdb_id ?? '').trim();
  if (/^[1-9]\d{0,11}$/.test(tmdb) && Number.isSafeInteger(Number(tmdb))) result.tmdbId = Number(tmdb);
  const imdb = String(row.vod_imdb_id ?? row.imdb_id ?? '').trim().toLowerCase();
  if (/^tt\d{5,12}$/.test(imdb)) result.imdbId = imdb;
  const douban = String(row.vod_douban_id ?? row.douban_id ?? '').trim();
  if (/^[1-9]\d{0,11}$/.test(douban)) result.doubanId = douban;
  return result;
}

export function artworkPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/.test(value);
}

export function validBackdropDimensions(width: unknown, height: unknown): boolean {
  return typeof width === 'number' && typeof height === 'number'
    && Number.isInteger(width) && Number.isInteger(height)
    && width >= 1280 && height >= 720 && width <= 40000 && height <= 40000
    && width / height >= 1.5 && width / height <= 2.4;
}

/** Stable IDs are authoritative; otherwise require a title AND year, never guess a remake. */
export function catalogBackdrop(identity: ArtworkIdentity, entries: readonly CatalogArtwork[] = catalog.items as CatalogArtwork[]): BackdropArtwork | undefined {
  const title = normalizeArtworkTitle(identity.title);
  const year = artworkYear(identity.year);
  const hasId = !!(identity.tmdbId || identity.imdbId || identity.doubanId);
  const matches = entries.filter((entry) => {
    if (identity.mediaType && entry.mediaType !== identity.mediaType) return false;
    if (year && entry.year !== year) return false;
    if (hasId) {
      let knownMatch = false;
      for (const [requested, known] of [
        [identity.tmdbId, entry.tmdbId], [identity.imdbId, entry.imdbId], [identity.doubanId, entry.doubanId],
      ]) {
        if (!requested || !known) continue;
        if (requested !== known) return false;
        knownMatch = true;
      }
      return knownMatch;
    }
    return !!year && !!title && entry.titles.some((alias) => normalizeArtworkTitle(alias) === title);
  });
  if (matches.length !== 1) return undefined;
  const item = matches[0];
  if (!artworkPath(item.backdropPath) || !validBackdropDimensions(item.width, item.height)) return undefined;
  return { url: TMDB_IMAGE_ORIGIN + item.backdropPath, width: item.width, height: item.height,
    provider: 'tmdb', mediaType: item.mediaType, mediaId: item.tmdbId, match: 'catalog' };
}

export function catalogIdentityConflict(identity: ArtworkIdentity, entries: readonly CatalogArtwork[] = catalog.items as CatalogArtwork[]): boolean {
  const year = artworkYear(identity.year);
  return entries.some((entry) => {
    const ids = [[identity.tmdbId, entry.tmdbId], [identity.imdbId, entry.imdbId], [identity.doubanId, entry.doubanId]];
    if (!ids.some(([requested, known]) => !!requested && !!known && requested === known)) return false;
    return !!(year && year !== entry.year) || !!(identity.mediaType && identity.mediaType !== entry.mediaType)
      || ids.some(([requested, known]) => !!requested && !!known && requested !== known);
  });
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Ambiguous exact-title results intentionally have no winner. Popularity is not identity. */
export function selectTmdbMatch(raw: unknown, identity: ArtworkIdentity, expectedType?: ArtworkMediaType): TmdbMatch | undefined {
  const root = object(raw);
  if (root?.total_pages !== undefined && (!Number.isInteger(root.total_pages) || root.total_pages !== 1)) return undefined;
  const rows = Array.isArray(root?.results) ? root.results : [];
  const title = normalizeArtworkTitle(identity.title);
  const year = artworkYear(identity.year);
  if (!title || !year) return undefined;
  const unique = new Map<string, TmdbMatch>();
  for (const value of rows) {
    const row = object(value);
    if (!row || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) continue;
    const mediaType = row.media_type === 'movie' || row.media_type === 'tv' ? row.media_type : expectedType;
    if (!mediaType || (identity.mediaType && mediaType !== identity.mediaType)) continue;
    const names = mediaType === 'movie' ? [row.title, row.original_title] : [row.name, row.original_name];
    if (!names.some((name) => typeof name === 'string' && normalizeArtworkTitle(name) === title)) continue;
    const releaseYear = artworkYear(mediaType === 'movie' ? row.release_date : row.first_air_date);
    if (releaseYear !== year) continue;
    unique.set(`${mediaType}:${row.id}`, { id: row.id, mediaType });
  }
  return unique.size === 1 ? unique.values().next().value : undefined;
}

export function tmdbDetailMatches(raw: unknown, identity: ArtworkIdentity, mediaType: ArtworkMediaType): boolean {
  const row = object(raw);
  if (!row || row.id !== identity.tmdbId) return false;
  const year = artworkYear(identity.year);
  return !year || artworkYear(mediaType === 'movie' ? row.release_date : row.first_air_date) === year;
}

/** Only a real, sufficiently large backdrop is eligible; logos and posters cannot enter this path. */
export function selectTmdbBackdrop(raw: unknown, match: TmdbMatch): BackdropArtwork | undefined {
  const root = object(raw);
  if (!Array.isArray(root?.backdrops)) return undefined;
  const images = root.backdrops.map(object).filter((row): row is Record<string, unknown> => !!row
    && artworkPath(row.file_path) && validBackdropDimensions(row.width, row.height));
  const languageRank = (row: Record<string, unknown>) => row.iso_639_1 === null || row.iso_639_1 === undefined ? 3 : row.iso_639_1 === 'zh' ? 2 : row.iso_639_1 === 'en' ? 1 : 0;
  images.sort((a, b) => Number((b.width as number) >= 1920) - Number((a.width as number) >= 1920)
    || languageRank(b) - languageRank(a)
    || Math.min(b.width as number, 3840) - Math.min(a.width as number, 3840)
    || Number(b.vote_count || 0) - Number(a.vote_count || 0)
    || Number(b.vote_average || 0) - Number(a.vote_average || 0)
    || String(a.file_path).localeCompare(String(b.file_path)));
  const image = images[0];
  return image ? { url: TMDB_IMAGE_ORIGIN + image.file_path, width: image.width as number, height: image.height as number,
    provider: 'tmdb', mediaType: match.mediaType, mediaId: match.id, match: 'api' } : undefined;
}

export function validArtworkCredential(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 2048 && !/[\r\n\u0000]/.test(value);
}

export function parseArtworkIdentity(raw: unknown): ArtworkIdentity | undefined {
  const value = object(raw);
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 240) return undefined;
  if (value.year !== undefined && (typeof value.year !== 'string' || value.year.length > 16)) return undefined;
  if (value.mediaType !== undefined && value.mediaType !== 'movie' && value.mediaType !== 'tv') return undefined;
  if (value.tmdbId !== undefined && (typeof value.tmdbId !== 'number' || !Number.isSafeInteger(value.tmdbId) || value.tmdbId <= 0)) return undefined;
  if (value.imdbId !== undefined && (typeof value.imdbId !== 'string' || !/^tt\d{5,12}$/.test(value.imdbId))) return undefined;
  if (value.doubanId !== undefined && (typeof value.doubanId !== 'string' || !/^[1-9]\d{0,11}$/.test(value.doubanId))) return undefined;
  return { title: value.title.trim(), year: value.year as string | undefined, mediaType: value.mediaType as ArtworkMediaType | undefined,
    tmdbId: value.tmdbId as number | undefined, imdbId: value.imdbId as string | undefined, doubanId: value.doubanId as string | undefined };
}
