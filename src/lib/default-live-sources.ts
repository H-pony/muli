import verified from '../../shared/sources/verified.json';
import type { LivePlaylistResponse, LiveSourceConfig } from './types';

/** Exact local identifier, resolved by the playlist API without an HTTP loopback. */
export const BUILTIN_LIVE_URL = '/live/verified.m3u';

/** Extensionless gateways need their measured container type to select a decoder. */
export function builtinLiveFormat(url: string): 'flv' | 'hls' | undefined {
  const format = verified.liveChannels.find((channel) => channel.url === url)?.format;
  return format === 'flv' || format === 'hls' ? format : undefined;
}

/** Curated channels, rather than the entire upstream feeds containing dead entries. */
export const BUILTIN_LIVE_SOURCES: readonly LiveSourceConfig[] = [
  {
    key: 'builtin_live_verified',
    name: '精选电视直播',
    url: BUILTIN_LIVE_URL,
  },
];

export function builtinLivePlaylist(): LivePlaylistResponse {
  const channels = verified.liveChannels.map(({ id, name, url, group }) => ({
    id, name, url, group, tvgId: id,
  }));
  return {
    name: '精选电视直播',
    channels,
    groups: [...new Set(channels.map((channel) => channel.group))].sort((a, b) => a.localeCompare(b, 'zh')),
  };
}
