const path = require('node:path');
const { version } = require('./package.json');
const BUILD_NUMBER = 7;
const bundleBuild = String(version.split('.').reduce((value, part) => value * 100 + Number(part), 0) * 100 + BUILD_NUMBER);

module.exports = {
  appId: 'tv.kongwo.desktop',
  productName: '幕里',
  buildVersion: `${version}.${BUILD_NUMBER}`,
  copyright: 'Copyright © 空我TV contributors; 幕里 contributors; AGPL-3.0-or-later',
  asar: true,
  npmRebuild: false,
  directories: {
    app: __dirname,
    buildResources: path.join(__dirname, 'build'),
    output: path.join(__dirname, '..', 'dist', `muli-${version}-build${BUILD_NUMBER}`),
  },
  files: [
    'package.json',
    'main.cjs',
    'player-self-test.cjs',
    'server-entry.cjs',
    'LICENSE',
  ],
  extraResources: [
    // afterPack copies the standalone tree without electron-builder's node_modules filtering.
    { from: '.staging/sources.json', to: 'sources.json' },
    { from: '.staging/server-manifest.json', to: 'server-manifest.json' },
    { from: 'build/icon-512.png', to: 'icon.png' },
  ],
  artifactName: `幕里-\${version}-build${BUILD_NUMBER}-\${os}-\${arch}.\${ext}`,
  afterPack: path.join(__dirname, 'scripts', 'after-pack.cjs'),
  mac: {
    category: 'public.app-category.entertainment',
    icon: 'build/icon.icns',
    identity: '-',
    hardenedRuntime: false,
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    extendInfo: {
      CFBundleVersion: bundleBuild,
      NSLocalNetworkUsageDescription: '幕里使用设备本地服务提供视频搜索与播放。',
    },
  },
  dmg: { title: '幕里 ${version}', icon: 'build/icon.icns' },
  win: {
    executableName: 'kongwotv',
    icon: 'build/icon.ico',
    // Cross-compilation uses the pure-JavaScript PE editor in after-pack.cjs.
    signAndEditExecutable: false,
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '幕里',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerHeaderIcon: 'build/icon.ico',
    artifactName: `幕里-\${version}-build${BUILD_NUMBER}-windows-\${arch}-setup.\${ext}`,
  },
  linux: {
    executableName: 'kongwotv',
    icon: 'build/icons',
    category: 'AudioVideo',
    target: [{ target: 'tar.gz', arch: ['x64'] }],
    desktop: { entry: { Name: '幕里', Comment: '视频搜索、直播与播放', StartupWMClass: 'kongwotv' } },
  },
};
