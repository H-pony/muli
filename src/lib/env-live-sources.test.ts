import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvLiveSources } from './env-live-sources';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getEnvLiveSources', () => {
  it('未配置时仅提供内置精选频道，不重新导入整份上游列表', () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', undefined);
    expect(getEnvLiveSources()).toEqual([
      {
        key: 'builtin_live_verified',
        name: '精选电视直播',
        url: '/live/verified.m3u',
      },
    ]);
  });

  it.each(['', '   ', '\n\t'])('空配置使用内置订阅：%j', (raw) => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', raw);
    expect(getEnvLiveSources().map((source) => source.key)).toEqual([
      'builtin_live_verified',
    ]);
  });

  it('每次返回独立配置，调用方修改不会污染后续默认值', () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', undefined);
    const first = getEnvLiveSources();
    first[0].name = '已修改';
    first.pop();
    const next = getEnvLiveSources();
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('精选电视直播');
  });

  it('显式空数组关闭所有默认订阅', () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', ' [] ');
    expect(getEnvLiveSources()).toEqual([]);
  });

  it('显式配置整体覆盖内置源，保留已有 key 和字段规范化规则', () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([
      { name: ' 自建 IPTV ', url: ' https://tv.example.com/list.m3u/ ', epg: ' https://epg.example.com/guide.xml.gz ' },
      { name: '其他订阅', url: 'http://tv.example.org/another.m3u', epg: '' },
    ]));
    expect(getEnvLiveSources()).toEqual([
      {
        key: 'envlive_0',
        name: '自建 IPTV',
        url: 'https://tv.example.com/list.m3u',
        epg: 'https://epg.example.com/guide.xml.gz',
      },
      { key: 'envlive_1', name: '其他订阅', url: 'http://tv.example.org/another.m3u', epg: undefined },
    ]);
  });

  it.each([
    '{',
    '{}',
    '[null]',
    '[{"name":"","url":"https://tv.example.com/list.m3u"}]',
    '[{"name":"不支持","url":"ftp://tv.example.com/list.m3u"}]',
    '[{"name":"有效","url":"https://tv.example.com/list.m3u"},null]',
  ])('无效配置仍告警并整体忽略，不回退内置源：%s', (raw) => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getEnvLiveSources()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[幕里] DEFAULT_LIVE_SOURCES 解析失败，已忽略：',
      expect.any(String)
    );
  });
});
