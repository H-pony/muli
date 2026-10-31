import { describe, expect, it } from 'vitest';
import {
  channelHasUrl,
  findRecentChannel,
  isLiveFavorite,
  liveChannelKey,
  mergeLiveChannels,
  selectLiveLine,
  type LiveChannelLine,
} from './live-channels';

function line(name: string, url: string, extra: Partial<LiveChannelLine> = {}): LiveChannelLine {
  return { id: url, name, url, ...extra };
}

const PRIMARY = 'https://primary.example.com/cctv1.m3u8';
const BACKUP = 'https://backup.example.com/cctv1.m3u8';

describe('直播频道的保守身份匹配', () => {
  it.each([
    ['CCTV1', 'CCTV-1综合'],
    ['CCTV-1 综合 高清', 'ＣＣＴＶ１[1080][S]'],
    ['CCTV5', 'CCTV-5 体育'],
    ['CCTV5+', 'CCTV-5+体育赛事'],
    ['CCTV13[720][S]', 'CCTV-13 新闻 (1080p)'],
  ])('%s 与 %s 合并为同一个频道', (first, second) => {
    expect(liveChannelKey({ name: first })).toBe(liveChannelKey({ name: second }));
    expect(mergeLiveChannels([line(first, PRIMARY), line(second, BACKUP)])[0].lines).toHaveLength(2);
  });

  it.each([
    ['CCTV5', 'CCTV5+'],
    ['CCTV5+', 'CCTV5+4K'],
    ['CCTV4', 'CCTV4K'],
    ['CCTV8', 'CCTV8K'],
    ['CCTV4K', 'CCTV8K'],
    ['CCTV4亚洲', 'CCTV4欧洲'],
    ['CCTV4中文国际', 'CCTV4中文国际欧洲'],
    ['CGTN英语', 'CGTN法语'],
    ['北京卫视', '北京卫视4K'],
    ['CCTV16', 'CCTV16[4K]'],
    ['CCTV16[4K]', 'CCTV16[8K]'],
  ])('保留 %s 与 %s 的频道区别', (first, second) => {
    const channels = mergeLiveChannels([line(first, PRIMARY), line(second, BACKUP)]);
    expect(channels).toHaveLength(2);
    expect(channels[0].channelKey).not.toBe(channels[1].channelKey);
  });

  it('不同来源复用数字 tvg-id 时，不会把不同电视台合并', () => {
    const channels = mergeLiveChannels([
      line('CCTV1', PRIMARY, { id: '26', tvgId: '26' }),
      line('湖南卫视', BACKUP, { id: '26', tvgId: '26' }),
    ]);
    expect(channels).toHaveLength(2);
    expect(channels.map((channel) => channel.name)).toEqual(['CCTV1', '湖南卫视']);
  });

  it('空台名按地址区分，同一空台名地址仍去重', () => {
    const channels = mergeLiveChannels([line('', PRIMARY), line('  ', BACKUP), line('', PRIMARY)]);
    expect(channels).toHaveLength(2);
    expect(channels.map((channel) => channel.lines.length)).toEqual([1, 1]);
  });
});

describe('直播频道合并与源优先级', () => {
  it('保留首个源和频道顺序，相同频道的重复流 URL 只保留一次', () => {
    const primary = line('CCTV1', PRIMARY, { sourceName: '主源', tvgId: 'primary-id', epg: 'https://epg.example.com/primary.xml' });
    const other = line('湖南卫视', 'https://streams.example.com/hunan.m3u8');
    const channels = mergeLiveChannels([
      primary,
      other,
      line('CCTV-1综合', PRIMARY, { sourceName: '重复源', tvgId: 'duplicate-id', epg: 'https://epg.example.com/duplicate.xml' }),
      line('CCTV1[1080][S]', BACKUP, { sourceName: '备用源', tvgId: 'backup-id' }),
    ]);
    expect(channels.map((channel) => channel.name)).toEqual(['CCTV1', '湖南卫视']);
    expect(channels[0].lines.map((candidate) => candidate.url)).toEqual([PRIMARY, BACKUP]);
    expect(channels[0].lines[0]).toEqual(primary);
    expect(channels[0]).toMatchObject({ url: PRIMARY, sourceName: '主源', tvgId: 'primary-id' });
  });

  it('可从备用源补齐频道台标与分类，同时保留每条线路的节目单归属', () => {
    const channels = mergeLiveChannels([
      line('CCTV1', PRIMARY, { sourceUrl: 'https://primary.example.com/list.m3u' }),
      line('CCTV-1综合', BACKUP, {
        logo: 'https://images.example.com/cctv1.png', group: '央视频道',
        epg: 'https://backup.example.com/guide.xml', tvgId: 'backup-id',
        sourceUrl: 'https://backup.example.com/list.m3u',
      }),
    ]);
    expect(channels[0]).toMatchObject({ logo: 'https://images.example.com/cctv1.png', group: '央视频道' });
    expect(channels[0].epg).toBeUndefined();
    expect(channels[0].tvgId).toBeUndefined();
    expect(channels[0].lines[0].epg).toBeUndefined();
    expect(channels[0].lines[1].epg).toBe('https://backup.example.com/guide.xml');
  });

  it.each([
    ['央视台', '央视频道'],
    ['央视频道', '央视频道'],
    ['卫视', '卫视频道'],
    ['卫视频道', '卫视频道'],
    ['体育赛事', '体育赛事'],
  ])('频道分类 %s 显示为 %s', (raw, expected) => {
    expect(mergeLiveChannels([line('测试频道', PRIMARY, { group: raw })])[0].group).toBe(expected);
  });
});

describe('直播线路选择与元数据隔离', () => {
  it('切换备用线路保留频道身份和显示名，使用该线路的 EPG 与 tvg-id', () => {
    const channel = mergeLiveChannels([
      line('CCTV1', PRIMARY, { tvgId: 'primary-id', epg: 'https://primary.example.com/guide.xml', sourceName: '主源', group: '央视频道' }),
      line('CCTV-1综合', BACKUP, { tvgId: 'backup-id', epg: 'https://backup.example.com/guide.xml', sourceName: '备用源' }),
    ])[0];
    const selected = selectLiveLine(channel, BACKUP);
    expect(selected).toMatchObject({
      channelKey: channel.channelKey, name: 'CCTV1', group: '央视频道', url: BACKUP,
      tvgId: 'backup-id', epg: 'https://backup.example.com/guide.xml', sourceName: '备用源',
    });
    expect(channel.url).toBe(PRIMARY);
    expect(channel.epg).toBe('https://primary.example.com/guide.xml');
    expect(channelHasUrl(selected, PRIMARY)).toBe(true);
    expect(channelHasUrl(selected, BACKUP)).toBe(true);
  });

  it('选择缺少 EPG/tvg-id 的线路时清除旧线路值，切回后可恢复', () => {
    const channel = mergeLiveChannels([
      line('CCTV1', PRIMARY, { tvgId: 'primary-id', epg: 'https://primary.example.com/guide.xml' }),
      line('CCTV-1综合', BACKUP),
    ])[0];
    const selected = selectLiveLine(channel, BACKUP);
    expect(selected.epg).toBeUndefined();
    expect(selected.tvgId).toBeUndefined();
    expect(selected.url).toBe(BACKUP);
    const restored = selectLiveLine(selected, PRIMARY);
    expect(restored.epg).toBe('https://primary.example.com/guide.xml');
    expect(restored.tvgId).toBe('primary-id');
  });

  it('切回无节目单的主线路不会继承备用线路的 EPG', () => {
    const channel = mergeLiveChannels([
      line('CCTV1', PRIMARY),
      line('CCTV-1综合', BACKUP, { tvgId: 'backup-id', epg: 'https://backup.example.com/guide.xml' }),
    ])[0];
    const restored = selectLiveLine(selectLiveLine(channel, BACKUP), PRIMARY);
    expect(restored.epg).toBeUndefined();
    expect(restored.tvgId).toBeUndefined();
  });

  it('合并和选线不修改传入的频道数据', () => {
    const lines = [line('CCTV1', PRIMARY), line('CCTV-1综合', BACKUP, { logo: 'https://images.example.com/cctv1.png', group: '央视台' })];
    const original = structuredClone(lines);
    const channel = mergeLiveChannels(lines)[0];
    selectLiveLine(channel, BACKUP);
    expect(lines).toEqual(original);
  });
});

describe('直播收藏兼容与最近观看恢复', () => {
  it('旧版按 URL 保存的收藏可匹配当前任意线路', () => {
    const channel = mergeLiveChannels([line('CCTV1', PRIMARY), line('CCTV-1综合', BACKUP)])[0];
    expect(isLiveFavorite(channel, new Set([PRIMARY]))).toBe(true);
    expect(isLiveFavorite(channel, new Set([BACKUP]))).toBe(true);
    expect(isLiveFavorite(channel, new Set(['https://unrelated.example.com/live.m3u8']))).toBe(false);
  });

  it('频道收藏在流地址和来源订阅地址全部更新后仍保持', () => {
    const previous = mergeLiveChannels([line('CCTV1', PRIMARY, { sourceUrl: 'https://old.example.com/list.m3u' })])[0];
    const refreshed = mergeLiveChannels([line('CCTV-1综合', BACKUP, { sourceUrl: 'https://new.example.com/list.m3u' })])[0];
    expect(isLiveFavorite(refreshed, new Set([previous.channelKey]))).toBe(true);
  });

  it('最近观看可恢复仍有效的备用线路以及它自己的节目单', () => {
    const channels = mergeLiveChannels([
      line('CCTV1', PRIMARY, { epg: 'https://primary.example.com/guide.xml' }),
      line('CCTV-1综合', BACKUP, { epg: 'https://backup.example.com/guide.xml', tvgId: 'backup-id' }),
    ]);
    const selected = findRecentChannel(channels, { channelKey: channels[0].channelKey, name: 'CCTV1', url: BACKUP });
    expect(selected).toMatchObject({ url: BACKUP, epg: 'https://backup.example.com/guide.xml', tvgId: 'backup-id' });
  });

  it.each([true, false])('旧流失效后通过频道身份恢复新线路（显式身份：%s）', (withKey) => {
    const channels = mergeLiveChannels([line('CCTV1', BACKUP)]);
    const selected = findRecentChannel(channels, {
      ...(withKey ? { channelKey: channels[0].channelKey } : {}),
      name: 'CCTV-1综合', url: PRIMARY,
    });
    expect(selected?.url).toBe(BACKUP);
  });

  it('稳定频道身份优先于被其他频道复用的旧流地址', () => {
    const channels = mergeLiveChannels([line('CCTV2', PRIMARY), line('CCTV1', BACKUP)]);
    const selected = findRecentChannel(channels, { channelKey: liveChannelKey({ name: 'CCTV1' }), name: 'CCTV-1综合', url: PRIMARY });
    expect(selected?.channelKey).toBe(liveChannelKey({ name: 'CCTV1' }));
    expect(selected?.url).toBe(BACKUP);
  });

  it('旧记录台名不一致时可按有效 URL 兜底，不认识的频道保持缺失', () => {
    const channels = mergeLiveChannels([line('CCTV1', PRIMARY)]);
    expect(findRecentChannel(channels, { name: '旧显示名', url: PRIMARY })?.url).toBe(PRIMARY);
    expect(findRecentChannel(channels, { name: '不存在的电视台', url: BACKUP })).toBeUndefined();
  });
});
