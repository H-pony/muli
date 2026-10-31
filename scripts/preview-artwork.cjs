'use strict';

// Review the exact standalone tree used by desktop packages, bound to this Mac only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'desktop', '.staging');
const port = Number(process.env.KONGWOTV_PREVIEW_PORT || 17889);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const base = `http://127.0.0.1:${port}`;
let child;
let stopping = false;
const stop = () => { stopping = true; child?.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

(async () => {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port }, () => probe.close(resolve));
  });
  const sources = JSON.parse(fs.readFileSync(path.join(stage, 'sources.json'), 'utf8'));
  const env = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', PORT: String(port),
    PASSWORD: '', PROXY_SECRET: crypto.randomBytes(32).toString('hex'), COOKIE_SECURE: 'false',
    DEFAULT_SOURCES: JSON.stringify(sources.vodSources || []), DEFAULT_LIVE_SOURCES: JSON.stringify(sources.liveSubscriptions || []) });
  child = spawn(process.execPath, [path.join(root, 'desktop', 'server-entry.cjs'), path.join(stage, 'server')], {
    cwd: path.join(stage, 'server'), env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code) => { if (!stopping) process.exitCode = code ?? 1; });
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    if (child.exitCode !== null) throw new Error('Desktop preview service exited');
    try {
      const response = await fetch(base + '/api/status', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { console.log(`ARTWORK_PREVIEW_READY ${base}`); return; }
    } catch { /* Startup probe only. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Desktop preview did not become ready');
})().catch((error) => { console.error(error.message); stop(); process.exitCode = 1; });
