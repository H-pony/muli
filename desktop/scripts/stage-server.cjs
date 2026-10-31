'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '..');
const source = path.join(root, '.next', 'standalone');
const staging = path.join(desktop, '.staging');
const destination = path.join(staging, 'server');
const excluded = new Set();

function safeRemoveGenerated(target) {
  const resolved = path.resolve(target);
  if (resolved !== destination) throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  if (fs.existsSync(resolved)) {
    console.log(`Replacing generated standalone staging: ${resolved}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function copyFilter(file) {
  const relative = path.relative(source, file);
  const parts = relative.split(path.sep);
  const base = path.basename(file);
  if (parts.some((part) => part.startsWith('.env') || part === '.git')) {
    excluded.add('environment files');
    return false;
  }
  if (parts.some((part) => part === '@img' || part === 'sharp' || /^swc-(darwin|win32|linux|freebsd|android)/.test(part))) {
    excluded.add('optional native sharp/SWC packages');
    return false;
  }
  if (/\.(node|dylib|so(?:\.\d+)?)$/i.test(base)) {
    excluded.add('native dynamic libraries');
    return false;
  }
  return true;
}

function assertClean(directory) {
  let fileCount = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith('.env')) throw new Error('Environment file found in desktop staging.');
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in staging: ${path.relative(staging, target)}`);
    if (entry.isDirectory()) {
      const nested = assertClean(target);
      fileCount += nested.fileCount;
      bytes += nested.bytes;
    } else {
      if (/\.(node|dylib|so(?:\.\d+)?)$/i.test(entry.name)) throw new Error('Host-native binary found in desktop server.');
      fileCount += 1;
      bytes += fs.statSync(target).size;
    }
  }
  return { fileCount, bytes };
}

function stageServer() {
  if (!fs.existsSync(path.join(source, 'server.js'))) {
    throw new Error('先在项目根目录运行 DOCKER_BUILD=1 npm run build，等待 .next/standalone/server.js 生成后再打包桌面端。');
  }
  if (!fs.existsSync(path.join(root, '.next', 'static'))) throw new Error('Missing .next/static assets.');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.next', 'required-server-files.json'), 'utf8')).config;
  if (config.images?.unoptimized !== true) {
    throw new Error('Desktop cross-platform staging requires images.unoptimized=true so native sharp is unnecessary.');
  }
  fs.mkdirSync(staging, { recursive: true });
  safeRemoveGenerated(destination);
  fs.cpSync(source, destination, { recursive: true, dereference: true, filter: copyFilter });
  fs.cpSync(path.join(root, '.next', 'static'), path.join(destination, '.next', 'static'), {
    recursive: true, dereference: true, filter: copyFilter,
  });
  fs.cpSync(path.join(root, 'public'), path.join(destination, 'public'), {
    recursive: true, dereference: true, filter: copyFilter,
  });
  const sourceData = JSON.parse(fs.readFileSync(path.join(root, 'android-tv', 'app', 'src', 'main', 'assets', 'sources.json'), 'utf8'));
  if (!Array.isArray(sourceData.vodSources) || !sourceData.vodSources.length) throw new Error('Missing public default video sources.');
  // Only copy the documented public source lists, never host configuration.
  const publicSources = {
    version: sourceData.version || 1,
    vodSources: sourceData.vodSources,
    liveSubscriptions: sourceData.liveSubscriptions || [],
    bundledLive: sourceData.bundledLive === true,
    provenance: sourceData.provenance || {},
  };
  fs.writeFileSync(path.join(staging, 'sources.json'), JSON.stringify(publicSources, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(desktop, 'LICENSE'));
  const audit = assertClean(destination);
  const serverBytes = fs.readFileSync(path.join(destination, 'server.js'));
  const manifest = {
    application: '幕里',
    technicalName: 'kongwotv',
    version: JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version,
    nextVersion: JSON.parse(fs.readFileSync(path.join(destination, 'node_modules', 'next', 'package.json'), 'utf8')).version,
    serverSha256: crypto.createHash('sha256').update(serverBytes).digest('hex'),
    buildId: fs.readFileSync(path.join(destination, '.next', 'BUILD_ID'), 'utf8').trim(),
    createdAt: new Date().toISOString(),
    imagesUnoptimized: true,
    nativeModulesIncluded: false,
    runtime: 'Electron bundled Node.js; no host Node.js installation required',
    exclusions: [...excluded],
    ...audit,
  };
  fs.writeFileSync(path.join(staging, 'server-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Staged ${audit.fileCount} files (${(audit.bytes / 1024 / 1024).toFixed(1)} MiB); environment files and optional host-native modules excluded.`);
  return manifest;
}

if (require.main === module) {
  try { stageServer(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { stageServer, assertClean };
