'use strict';

// One curated manifest feeds the server, desktop and native client bundles.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const verified = require(path.join(root, 'shared/sources/verified.json'));
const escape = (text) => text.replace(/[\r\n"]/g, '');
const makePlaylist = (channels) => [
  '#EXTM3U',
  '#PLAYLIST:精选电视直播',
  `# Verified ${verified.revision}; individually decoded channels only.`,
  ...channels.flatMap((channel) => [
    `#EXTINF:-1 tvg-id="${escape(channel.id)}" group-title="${escape(channel.group)}",${escape(channel.name)}`,
    channel.url,
  ]),
  '',
].join('\n');
const playlist = makePlaylist(verified.liveChannels);
// AVPlayer does not decode FLV; Apple bundles only the verified HLS subset.
const applePlaylist = makePlaylist(verified.liveChannels.filter((channel) => channel.format !== 'flv'));
const nativeConfig = JSON.stringify({
  version: verified.version,
  revision: verified.revision,
  vodSources: verified.vodSources.map(({ name, url }) => ({ name, url })),
  liveSubscriptions: [],
  bundledLive: true,
  liveFormats: Object.fromEntries(verified.liveChannels.map((channel) => [channel.url, channel.format])),
  provenance: verified.provenance,
}, null, 2) + '\n';

const outputs = new Map([
  ['public/live/verified.m3u', playlist],
  ['apple/Resources/channels.m3u', applePlaylist],
  ['android-tv/app/src/main/assets/channels.m3u', playlist],
  ['apple/Resources/sources.json', nativeConfig],
  ['android-tv/app/src/main/assets/sources.json', nativeConfig],
]);

for (const [relative, content] of outputs) {
  const file = path.join(root, relative);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
      throw new Error(`Source bundle is out of sync: ${relative}; run node scripts/sync-verified-sources.cjs`);
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
console.log(`Verified source bundles ${process.argv.includes('--check') ? 'match' : 'updated'}: ${verified.vodSources.length} VOD APIs, ${verified.liveChannels.length} live channels.`);
