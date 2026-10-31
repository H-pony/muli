import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeEpisode, db, progressKeyOf, saveProgress, updateHistoryProgress, upsertHistory } from './db';

const entry = { sourceKey: 'a', vodId: '42', title: '连续剧', episodeIndex: 0, totalEpisodes: 3, playbackPosition: 480, duration: 1000, timestamp: 100 };
beforeEach(async () => {
  db.close();
  await Dexie.delete('kongwotv');
  await db.open();
});
afterEach(async () => { db.close(); await Dexie.delete('kongwotv'); });

describe('逐集进度与观看历史闭环', () => {
  it('打开下一集不继承前一集位置，迟到的旧集回调不污染新集', async () => {
    await upsertHistory(entry);
    await upsertHistory({ ...entry, episodeIndex: 1, playbackPosition: 0, duration: 0 });
    await updateHistoryProgress('a', '42', 490, 1000, 0);
    expect(await db.history.get('a_42')).toMatchObject({ episodeIndex: 1, playbackPosition: 0, duration: 0, completed: false });
    await updateHistoryProgress('a', '42', 30, 900, 1);
    expect(await db.history.get('a_42')).toMatchObject({ playbackPosition: 30, duration: 900 });
  });

  it('刷新同一集保留进度，完成清续播位置并保留完成状态', async () => {
    await upsertHistory(entry);
    await saveProgress('a', '42', 0, 480, 1000);
    await upsertHistory({ ...entry, playbackPosition: 0, duration: 0 });
    expect((await db.history.get('a_42'))?.playbackPosition).toBe(480);
    await completeEpisode('a', '42', 0);
    await upsertHistory({ ...entry, playbackPosition: 0, duration: 0 });
    expect(await db.progress.get(progressKeyOf('a', '42', 0))).toBeUndefined();
    expect(await db.history.get('a_42')).toMatchObject({ playbackPosition: 0, completed: true });
    await updateHistoryProgress('a', '42', 20, 1000, 0);
    expect((await db.history.get('a_42'))?.completed).toBe(false);
  });

  it('结束旧集不能清除已经切换到新集的历史进度', async () => {
    await upsertHistory({ ...entry, episodeIndex: 1 });
    await completeEpisode('a', '42', 0);
    expect(await db.history.get('a_42')).toMatchObject({ episodeIndex: 1, playbackPosition: 480, completed: false });
  });

  it('保留导入/撤销的时间，并拒绝非有限媒体时长', async () => {
    await upsertHistory(entry);
    await saveProgress('a', '42', 0, 30, Infinity);
    await updateHistoryProgress('a', '42', NaN, 1000, 0);
    expect(await db.progress.count()).toBe(0);
    expect(await db.history.get('a_42')).toMatchObject({ timestamp: 100, playbackPosition: 480 });
  });
});
