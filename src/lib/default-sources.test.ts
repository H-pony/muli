import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvSources } from './env-sources';
import { BUILTIN_VOD_SOURCES } from './default-sources';
import { builtinLiveFormat, builtinLivePlaylist } from './default-live-sources';
import verified from '../../shared/sources/verified.json';
import { parseM3u } from './m3u-parser';

afterEach(() => vi.unstubAllEnvs());

describe('verified source integration', () => {
  it('未设置点播源时开箱即用，但显式空数组和自定义配置仍有优先权', () => {
    vi.stubEnv('DEFAULT_SOURCES', undefined);
    expect(getEnvSources()).toEqual(BUILTIN_VOD_SOURCES);
    const first = getEnvSources();
    first[0].name = 'changed';
    expect(getEnvSources()[0].name).not.toBe('changed');
    vi.stubEnv('DEFAULT_SOURCES', '[]');
    expect(getEnvSources()).toEqual([]);
    vi.stubEnv('DEFAULT_SOURCES', '[{"name":"自建","url":"https://example.com/vod"}]');
    expect(getEnvSources().map((source) => source.url)).toEqual(['https://example.com/vod']);
  });

  it('安卓、苹果与电脑服务共享同一份精选数据，打包资源不能漂移', () => {
    expect(() => execFileSync(process.execPath, ['scripts/sync-verified-sources.cjs', '--check']))
      .not.toThrow();
    const native = JSON.parse(fs.readFileSync('apple/Resources/sources.json', 'utf8'));
    expect(native.liveSubscriptions).toEqual([]);
    expect(native.bundledLive).toBe(true);
  });

  it('直播只保留HTTP(S)流，排除MP4录播、临时签名和重复地址', () => {
    const channels = builtinLivePlaylist().channels;
    expect(channels.length).toBeGreaterThan(0);
    expect(new Set(channels.map((channel) => channel.url)).size).toBe(channels.length);
    for (const channel of channels) {
      const url = new URL(channel.url);
      expect(['http:', 'https:']).toContain(url.protocol);
      expect(url.pathname).not.toMatch(/\.mp4$/i);
      expect(url.searchParams.has('auth_key')).toBe(false);
    }
  });

  it('无后缀FLV网关使用已测格式，苹果资源排除AVPlayer不支持的FLV', () => {
    const flv = verified.liveChannels.filter((channel) => channel.format === 'flv');
    expect(flv.length).toBeGreaterThan(0);
    for (const channel of flv) expect(builtinLiveFormat(channel.url)).toBe('flv');
    expect(builtinLiveFormat('https://example.com/unknown')).toBeUndefined();
    const apple = parseM3u(fs.readFileSync('apple/Resources/channels.m3u', 'utf8'));
    expect(apple.map((channel) => channel.url)).toEqual(
      verified.liveChannels.filter((channel) => channel.format !== 'flv').map((channel) => channel.url)
    );
  });
});
