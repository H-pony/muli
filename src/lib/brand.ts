/** 幕里的显示品牌与配置兼容入口；安装和存储标识保留，沿用已有设备数据。 */
export const APP_NAME = '幕里';
// APP_ID 是持久化数据标识，不随显示品牌改名。
export const APP_ID = 'kongwotv';
export const CONFIG_NAME = '幕里-Settings';
export const PREVIOUS_CONFIG_NAME = '空我TV-Settings';
export const LEGACY_APP_ID = 'libretv';
export const LEGACY_CONFIG_NAME = 'LibreTV-Settings';

export function isSupportedConfigName(name: unknown): boolean {
  return name === CONFIG_NAME || name === PREVIOUS_CONFIG_NAME || name === LEGACY_CONFIG_NAME;
}

/** 新名称优先；首次访问时复制原设置，不删除旧值，便于回退。 */
export function readBrandStorage(key: string): string | null {
  const current = localStorage.getItem(key);
  if (current !== null || !key.startsWith(APP_ID)) return current;
  const legacy = localStorage.getItem(LEGACY_APP_ID + key.slice(APP_ID.length));
  if (legacy !== null) {
    try { localStorage.setItem(key, legacy); } catch { /* 存储配额不足时仍返回原设置 */ }
  }
  return legacy;
}

export function configSettings(data: Record<string, unknown> | undefined): string | undefined {
  const current = data?.[`${APP_ID}-settings`];
  const legacy = data?.[`${LEGACY_APP_ID}-settings`];
  return typeof current === 'string' ? current : typeof legacy === 'string' ? legacy : undefined;
}
