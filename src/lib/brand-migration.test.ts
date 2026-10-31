import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyDatabase } from './brand-migration';
import { db, exportConfig, importConfig } from './db';

let legacy: Dexie;
let values: Map<string, string>;
beforeEach(async () => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  db.close();
  await Dexie.delete('kongwotv');
  await Dexie.delete('libretv');
  legacy = new Dexie('libretv');
  legacy.version(1).stores({ history: 'id, timestamp', watchlist: 'id, addedAt' });
});
afterEach(async () => {
  legacy.close();
  db.close();
  await Dexie.delete('kongwotv');
  await Dexie.delete('libretv');
  vi.unstubAllGlobals();
});

const entry = { id: 'source_42', sourceKey: 'source', vodId: '42', title: '继续观看', episodeIndex: 2, totalEpisodes: 12, playbackPosition: 123, duration: 1000, timestamp: 1 };

describe('brand database migration and configuration round trips', () => {
  it('migrates history and watchlist on first database open and retains the original', async () => {
    await legacy.table('history').put(entry);
    await legacy.table('watchlist').put({ id: 'saved', item: { id: '42', title: '片单' }, addedAt: 1 });
    await db.open();
    expect(await db.history.get(entry.id)).toEqual(entry);
    expect(await db.watchlist.count()).toBe(1);
    expect(await legacy.table('history').count()).toBe(1);
  });
  it('preserves newer records and safely retries a previously interrupted migration', async () => {
    await db.open();
    await db.history.put({ ...entry, playbackPosition: 250 });
    await legacy.table('history').bulkPut([entry, { ...entry, id: 'other_7', sourceKey: 'other', vodId: '7' }]);
    await migrateLegacyDatabase(db);
    expect((await db.history.get(entry.id))?.playbackPosition).toBe(250);
    expect(await db.history.count()).toBe(2);
    await migrateLegacyDatabase(db);
    expect(await db.history.count()).toBe(2);
  });
  it('exports the new name and imports its own modern history and source settings', async () => {
    await db.open();
    await db.history.put(entry);
    values.set('kongwotv-settings', '{"state":{"selectedKeys":["source"]}}');
    const exported = await exportConfig();
    expect(JSON.parse(exported).name).toBe('幕里-Settings');
    await db.history.clear();
    values.clear();
    await importConfig(exported);
    expect((await db.history.get(entry.id))?.vodId).toBe('42');
    expect((await db.history.get(entry.id))?.totalEpisodes).toBe(12);
    expect(values.get('kongwotv-settings')).toContain('source');
  });
  it('imports original exports with legacy field and preference names', async () => {
    await db.open();
    await importConfig(JSON.stringify({ name: 'LibreTV-Settings', data: {
      'libretv-settings': '{"state":{"adFilter":true}}',
      viewingHistory: JSON.stringify([{ sourceCode: 'legacy', vod_id: '99', title: '旧记录', episodes: ['a','b'], playbackPosition: 88 }]),
    } }));
    expect(values.get('kongwotv-settings')).toContain('adFilter');
    expect((await db.history.get('legacy_99'))?.playbackPosition).toBe(88);
    expect((await db.history.get('legacy_99'))?.totalEpisodes).toBe(2);
  });
  it('imports the previous branded export without moving existing device storage', async () => {
    await db.open();
    await db.history.put(entry);
    await importConfig(JSON.stringify({ name: '空我TV-Settings', data: {
      'kongwotv-settings': '{"state":{"autoplayNext":false}}',
      viewingHistory: JSON.stringify([{ ...entry, id: 'previous_7', sourceKey: 'previous', vodId: '7' }]),
    } }));
    expect(values.get('kongwotv-settings')).toContain('autoplayNext');
    expect(await db.history.get(entry.id)).toEqual(entry);
    expect((await db.history.get('previous_7'))?.vodId).toBe('7');
  });
});
