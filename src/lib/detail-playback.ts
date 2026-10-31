import type { HistoryEntry } from './db';
import type { SearchResultItem } from './types';
import { artworkYear, inferArtworkMediaType, normalizeArtworkTitle } from './artwork';

/** A recommendation must never silently play a different year or a title-prefix match. */
export function matchingPlaybackCandidates(
  results: SearchResultItem[],
  identity: { title: string; year?: string; kind?: 'movie' | 'tv' | 'show'; doubanId?: string },
): SearchResultItem[] {
  const year = artworkYear(identity.year);
  const titles = new Set([identity.title, ...(year ? [`${identity.title}${year}`] : [])].map(normalizeArtworkTitle));
  return results.filter((result) => {
    if (!titles.has(normalizeArtworkTitle(result.name))) return false;
    const resultYear = artworkYear(result.year);
    if (year && resultYear && year !== resultYear) return false;
    if (identity.doubanId && result.doubanId && identity.doubanId !== result.doubanId) return false;
    const resultKind = inferArtworkMediaType(result.typeName);
    return !identity.kind || !resultKind || resultKind === (identity.kind === 'movie' ? 'movie' : 'tv');
  });
}

export function detailPlaybackAction(history: HistoryEntry | undefined, episodeCount: number) {
  if (!history || !Number.isInteger(history.episodeIndex) || history.episodeIndex < 0 || history.episodeIndex >= episodeCount) {
    return { index: 0, label: '立即播放' };
  }
  const completed = history.completed || (history.duration > 0 && history.playbackPosition >= history.duration - 2);
  if (completed) {
    const next = history.episodeIndex + 1;
    return next < episodeCount ? { index: next, label: `播放下一集 · 第 ${next + 1} 集`, restart: true } : { index: 0, label: '重新播放', restart: true };
  }
  if (history.playbackPosition > 0 || history.episodeIndex > 0) {
    return { index: history.episodeIndex, label: episodeCount > 1 ? `继续观看 · 第 ${history.episodeIndex + 1} 集` : '继续观看' };
  }
  return { index: 0, label: '立即播放' };
}
