import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSettings, isSupportedConfigName, readBrandStorage } from './brand';

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('幕里 configuration upgrade', () => {
  it('copies an old preference without deleting the rollback value', () => {
    values.set('libretv-settings', '{"state":{"autoplayNext":false}}');
    expect(readBrandStorage('kongwotv-settings')).toBe(values.get('libretv-settings'));
    expect(values.get('kongwotv-settings')).toBe(values.get('libretv-settings'));
  });
  it('keeps a new preference when both names exist', () => {
    values.set('libretv-theme', 'light');
    values.set('kongwotv-theme', 'dark');
    expect(readBrandStorage('kongwotv-theme')).toBe('dark');
  });
  it('keeps reading an old preference when storage is full', () => {
    values.set('libretv-theme', 'light');
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: () => { throw new Error('QuotaExceeded'); } });
    expect(readBrandStorage('kongwotv-theme')).toBe('light');
  });
  it('recognizes new and original exported configuration files', () => {
    expect(isSupportedConfigName('幕里-Settings')).toBe(true);
    expect(isSupportedConfigName('空我TV-Settings')).toBe(true);
    expect(isSupportedConfigName('LibreTV-Settings')).toBe(true);
    expect(isSupportedConfigName('unrelated')).toBe(false);
    expect(configSettings({ 'libretv-settings': 'old' })).toBe('old');
    expect(configSettings({ 'libretv-settings': 'old', 'kongwotv-settings': 'new' })).toBe('new');
  });
});
