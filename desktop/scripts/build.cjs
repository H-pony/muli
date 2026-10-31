'use strict';

const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { stageServer } = require('./stage-server.cjs');
const { createIcons } = require('./create-icons.cjs');

async function main() {
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const platforms = requested.length ? requested : ['mac', 'win'];
  if (platforms.some((name) => !['mac', 'win', 'linux'].includes(name))) {
    throw new Error('Usage: npm run build -- [mac] [win] [linux] [--reuse-stage]');
  }
  if (!process.argv.includes('--reuse-stage')) stageServer();
  await createIcons();
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  const configuration = require('../electron-builder.config.cjs');
  const artifacts = [];
  for (const name of platforms) {
    const targets = name === 'mac'
      ? Platform.MAC.createTarget(['dmg', 'zip'], Arch.arm64, Arch.x64)
      : name === 'win'
        ? Platform.WINDOWS.createTarget(['nsis'], Arch.x64)
        : Platform.LINUX.createTarget(['tar.gz'], Arch.x64);
    artifacts.push(...await build({ projectDir: path.resolve(__dirname, '..'), config: structuredClone(configuration), targets }));
  }
  for (const artifact of artifacts) console.log(`Created ${artifact}`);
}
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  process.on('exit', () => { process.exitCode = 1; });
});
