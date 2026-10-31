import { describe, expect, it } from 'vitest';
import { detailPlaybackAction, matchingPlaybackCandidates } from './detail-playback';
import type { HistoryEntry } from './db';
import type { SearchResultItem } from './types';

const result = (name: string, year?: string): SearchResultItem => ({ name, year, sourceKey: 'source', sourceName: '来源', vodId: '1' });
const history = (changes: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: 'source_1', sourceKey: 'source', vodId: '1', title: '影片', episodeIndex: 3, totalEpisodes: 10, playbackPosition: 120, duration: 1800, timestamp: 1, ...changes });

describe('catalog playback identity', () => {
  it('rejects a different-year remake instead of offering it under the requested poster', () => {
    expect(matchingPlaybackCandidates([result('生日快乐', '2007')], { title: '生日快乐', year: '2025' })).toEqual([]);
  });
  it('rejects related titles but allows a year suffix and unknown-year exact candidates', () => {
    expect(matchingPlaybackCandidates([result('三体 第一季', '2023'), result('三体（2023）', '2023–'), result('三体')], { title: '三体', year: '2023' })).toHaveLength(2);
  });
  it('rejects conflicting known identifiers and media kinds', () => {
    const items = [{ ...result('同名', '2025'), doubanId: '2' }, { ...result('同名', '2025'), typeName: '科幻片' }];
    expect(matchingPlaybackCandidates(items, { title: '同名', year: '2025', doubanId: '1', kind: 'tv' })).toEqual([]);
  });
});

describe('detail primary playback action', () => {
  it('resumes the actual episode', () => expect(detailPlaybackAction(history(), 10)).toEqual({ index: 3, label: '继续观看 · 第 4 集' }));
  it('offers the next episode after completion, including legacy history', () => {
    expect(detailPlaybackAction(history({ completed: true, playbackPosition: 0 }), 10).index).toBe(4);
    expect(detailPlaybackAction(history({ playbackPosition: 1799 }), 10).index).toBe(4);
  });
  it('replays from the beginning after the last episode, overriding older per-episode progress', () => expect(detailPlaybackAction(history({ completed: true, episodeIndex: 9 }), 10)).toEqual({ index: 0, label: '重新播放', restart: true }));
  it('does not clamp a removed episode to a different episode', () => expect(detailPlaybackAction(history(), 2)).toEqual({ index: 0, label: '立即播放' }));
});
