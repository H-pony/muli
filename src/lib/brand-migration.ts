import Dexie from 'dexie';
import { APP_ID, LEGACY_APP_ID } from './brand';

const MIGRATION_KEY = `${APP_ID}:legacy-data-migrated`;

/** 首次打开新数据库时原子复制旧数据；已有新记录优先，原数据库保留。 */
export async function migrateLegacyDatabase(target: Dexie): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_KEY) === '1') return;
  } catch { /* 禁止 localStorage 时仍可迁移 IndexedDB */ }
  if (!await Dexie.exists(LEGACY_APP_ID)) return;

  const legacy = new Dexie(LEGACY_APP_ID);
  try {
    await legacy.open();
    const snapshots = await Promise.all(legacy.tables
      .filter((table) => target.tables.some((current) => current.name === table.name))
      .map(async (table) => ({ name: table.name, rows: await table.toArray() as Record<string, unknown>[] })));

    await target.transaction('rw', target.tables, async () => {
      for (const snapshot of snapshots) {
        if (!snapshot.rows.length) continue;
        const table = target.table(snapshot.name);
        const keyPath = table.schema.primKey.keyPath;
        if (typeof keyPath !== 'string') continue;
        const existing = new Set(await table.toCollection().primaryKeys());
        const missing = snapshot.rows.filter((row) => !existing.has(row[keyPath] as string));
        if (missing.length) await table.bulkAdd(missing);
      }
    });
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(MIGRATION_KEY, '1');
    } catch { /* 下次重新执行也安全 */ }
  } finally {
    legacy.close();
  }
}
