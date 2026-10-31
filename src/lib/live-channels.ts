import type { LiveChannel } from './types';

/** 一条可播放线路，保留所属订阅与节目单，切线时不会串用另一个来源的元数据。 */
export interface LiveChannelLine extends LiveChannel {
  epg?: string;
  sourceUrl?: string;
  sourceName?: string;
}

/** 频道与线路分开：列表只展示一个频道，播放器使用当前选中的线路。 */
export interface LiveChannelItem extends LiveChannelLine {
  channelKey: string;
  lines: LiveChannelLine[];
}

const CCTV_NAMES: Record<string, string> = {
  '1': '综合', '2': '财经', '3': '综艺', '4': '中文国际', '5': '体育',
  '5+': '体育赛事', '6': '电影', '7': '国防军事', '8': '电视剧', '9': '纪录',
  '10': '科教', '11': '戏曲', '12': '社会与法', '13': '新闻', '14': '少儿',
  '15': '音乐', '16': '奥林匹克', '17': '农业农村',
};

/** 仅移除常见清晰度/检测标注，保留 4K、8K、+、地区和语言等频道区别。 */
function cleanName(name: string): string {
  return name.normalize('NFKC').trim()
    .replace(/\[(?:\d{3,4}p?|[SABCDF]|HD|SD|FHD|UHD)\]/gi, '')
    .replace(/\((?:\d{3,4}p?|HD|SD|FHD|UHD)\)/gi, '')
    .replace(/(?:[\s_-]+(?:HD|SD|FHD|UHD|\d{3,4}p)|高清|超清|标清)$/i, '')
    .trim();
}

export function liveChannelKey(channel: Pick<LiveChannel, 'name'>): string {
  const name = cleanName(channel.name).toLowerCase().replace(/[\s_.·-]+/g, '');
  const cctv = /^cctv(\d{1,2})(\+)?(.*)$/.exec(name);
  if (cctv) {
    const number = `${Number(cctv[1])}${cctv[2] || ''}`;
    // 数字 tvg-id 在各源中经常复用；只按台名识别央视，不能拿它作跨源身份。
    if (CCTV_NAMES[number] && (!cctv[3] || cctv[3] === CCTV_NAMES[number])) {
      return `live:cctv${number}`;
    }
  }
  // 空台名不应把所有无名地址并成一个频道。
  return `live:${name || 'unknown'}`;
}

function channelGroup(group?: string): string | undefined {
  const value = group?.trim();
  if (!value) return undefined;
  if (/^(?:央视|央视台|央视频道|CCTV)$/i.test(value)) return '央视频道';
  if (/^(?:卫视|卫视台|卫视频道|省级卫视)$/.test(value)) return '卫视频道';
  return value;
}

/** 按输入顺序保留主源优先级，去除同一频道中的重复 URL，补齐缺失台标与分组。 */
export function mergeLiveChannels(lines: readonly LiveChannelLine[]): LiveChannelItem[] {
  const channels = new Map<string, LiveChannelItem>();
  const urls = new Map<string, Set<string>>();
  for (const entry of lines) {
    const line = { ...entry, group: channelGroup(entry.group) };
    const key = line.name.trim() ? liveChannelKey(line) : `live:url:${line.url}`;
    const existing = channels.get(key);
    if (!existing) {
      channels.set(key, { ...line, channelKey: key, lines: [{ ...line }] });
      urls.set(key, new Set([line.url]));
      continue;
    }
    if (urls.get(key)!.has(line.url)) continue;
    urls.get(key)!.add(line.url);
    existing.lines.push({ ...line });
    existing.logo ||= line.logo;
    existing.group ||= line.group;
  }
  return [...channels.values()];
}

export function channelHasUrl(channel: LiveChannelItem, url: string): boolean {
  return channel.lines.some((line) => line.url === url);
}

/** 切换线路仍沿用频道显示名和稳定身份；tvg-id/EPG 必须取当前线路。 */
export function selectLiveLine(channel: LiveChannelItem, url: string): LiveChannelItem {
  const line = channel.lines.find((line) => line.url === url);
  if (!line) return channel;
  return {
    ...channel, ...line,
    name: channel.name,
    group: channel.group,
    logo: line.logo || channel.logo,
    tvgId: line.tvgId,
    epg: line.epg,
    rawName: line.rawName,
    sourceUrl: line.sourceUrl,
    sourceName: line.sourceName,
  };
}

/** 收藏新数据按频道身份保存，同时识别此前按流 URL 保存的收藏。 */
export function isLiveFavorite(channel: LiveChannelItem, favorites: ReadonlySet<string>): boolean {
  return favorites.has(channel.channelKey) || channel.lines.some((line) => favorites.has(line.url));
}

export interface LiveRecentLike {
  url: string;
  name: string;
  channelKey?: string;
}

/** 旧观看记录用 URL/台名匹配；失效线路更新后仍能定位到同一个频道。 */
export function findRecentChannel(channels: readonly LiveChannelItem[], recent: LiveRecentLike): LiveChannelItem | undefined {
  const key = recent.channelKey || liveChannelKey(recent);
  const channel = channels.find((channel) => channel.channelKey === key)
    || channels.find((channel) => channelHasUrl(channel, recent.url));
  return channel ? selectLiveLine(channel, recent.url) : undefined;
}
