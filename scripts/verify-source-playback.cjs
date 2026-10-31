'use strict';

// Exercises the real project pages and upstream media. No fixture/intercepted responses.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const base = process.env.SOURCE_TEST_BASE_URL || 'http://localhost:8082';
const output = process.env.SOURCE_TEST_OUTPUT || path.join(root, 'artifacts', 'source-integration-20261021');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const executable = require(path.join(root, 'desktop/node_modules/electron'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [__filename], { env, stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 720000);
  child.on('exit', (code) => { clearTimeout(timeout); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('use-mock-keychain');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'muli-real-playback-')));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = { base, realNetwork: true, mockResponses: false, cases: [], errors: [], startedAt: new Date().toISOString() };
  fs.mkdirSync(output, { recursive: true });
  let window;
  const evaluate = (expression) => window.webContents.executeJavaScript(expression, true);
  const status = () => evaluate(`(() => {
    const v = document.querySelector('video');
    return v ? { time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : null,
      width: v.videoWidth, height: v.videoHeight, ready: v.readyState, paused: v.paused, seeking: v.seeking,
      frames: v.getVideoPlaybackQuality?.().totalVideoFrames || 0,
      audioBytes: v.webkitAudioDecodedByteCount || 0,
      error: v.error ? {code:v.error.code, message:v.error.message} : null,
      text: document.body.innerText.slice(-1800) } : {missing:true, text:document.body.innerText.slice(-1800)};
  })()`);
  async function waitFor(predicate, ms = 45000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await predicate();
      if (value) return value;
      await delay(500);
    }
    throw new Error('Player did not satisfy playback condition');
  }
  const save = () => fs.writeFileSync(path.join(output, 'playback.json'), JSON.stringify(report, null, 2));
  async function playCase(test) {
    const result = { ...test, startedAt: new Date().toISOString() };
    console.log('PLAY ' + test.label);
    try {
      await window.loadURL(base + test.page);
      await waitFor(async () => { const s = await status(); return s.ready >= 2 && s.width > 0 && !s.error; });
      await evaluate('document.querySelector("video").play().catch(() => {})');
      result.before = await status();
      await delay(7000);
      result.after = await status();
      result.ok = result.after.time - result.before.time >= 3 && result.after.frames - result.before.frames >= 20 && !result.after.error && !result.after.paused;
      if (test.kind === 'vod' && result.ok) {
        await evaluate('document.querySelector("video").currentTime = 30; document.querySelector("video").play().catch(() => {})');
        result.seekOk = Boolean(await waitFor(async () => { const s = await status(); return !s.seeking && s.time >= 31 && s.ready >= 2 && !s.error; }, 20000).catch(() => false));
        result.seekState = await status();
      }
    } catch (error) {
      result.ok = false;
      result.error = error.message;
      result.state = await status().catch(() => ({}));
    }
    const file = `${test.kind}-${test.key}.png`;
    fs.writeFileSync(path.join(output, file), (await window.webContents.capturePage()).toPNG());
    result.screenshot = file;
    report.cases.push(result);
    save();
    console.log(JSON.stringify({ label: test.label, ok: result.ok, seekOk: result.seekOk,
      timeDelta: result.after && result.before ? +(result.after.time - result.before.time).toFixed(2) : null,
      frames: result.after?.frames, error: result.error }));
  }

  app.whenReady().then(async () => {
    try {
      window = new BrowserWindow({ width: 1440, height: 1000, show: false, backgroundColor: '#08090b',
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      window.webContents.on('render-process-gone', (_event, detail) => report.errors.push(detail));
      await window.loadURL(base + '/');
      const config = await evaluate('fetch("/api/status").then(r => r.json())');
      if (!config.verified) throw new Error('Playback test requires an authenticated local project');
      report.defaults = config;
      const only = process.env.SOURCE_TEST_ONLY || '';
      if (only !== 'live') {
        for (const source of config.defaultSources) {
          const query = await evaluate(`fetch('/api/search', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({wd:'西游记',sources:[${JSON.stringify(source)}]})}).then(r => r.json())`);
          const film = query.list?.find((item) => item.name.replace(/\s/g, '') === '后西游记第一季') || query.list?.[0];
          if (!film) { report.cases.push({label:source.name,kind:'vod',key:source.key,ok:false,error:'No real search result',query}); save(); continue; }
          const details = await evaluate(`fetch('/api/detail?' + new URLSearchParams({id:${JSON.stringify(film.vodId)},source:JSON.stringify(${JSON.stringify(source)})})).then(r => r.json())`);
          const params = new URLSearchParams({source:source.key,id:film.vodId,title:film.name,sourceUrl:source.url});
          await playCase({kind:'vod',key:source.key,label:source.name+' / '+film.name,page:'/watch?'+params,searchResultCount:query.list.length,episodes:details.episodes?.length});
        }
      }
      if (only !== 'vod') {
        const liveSource = config.defaultLiveSources[0];
        const playlist = await evaluate(`fetch('/api/live/playlist?' + new URLSearchParams({url:${JSON.stringify(liveSource.url)}})).then(r => r.json())`);
        report.liveChannelCount = playlist.channels.length;
        for (const [i, channel] of playlist.channels.entries()) {
          if (process.env.SOURCE_TEST_URL_FILTER && !channel.url.includes(process.env.SOURCE_TEST_URL_FILTER)) continue;
          const params = new URLSearchParams({url:channel.url,name:channel.name,group:channel.group || ''});
          await playCase({kind:'live',key:String(i+1),label:channel.name,page:'/live?'+params});
        }
      }
      report.finishedAt = new Date().toISOString();
      report.passed = report.cases.filter((item) => item.ok).length;
      report.failed = report.cases.length - report.passed;
      save();
      console.log('REAL PLAYBACK: ' + report.passed + '/' + report.cases.length + ' passed. ' + output);
      process.exitCode = report.failed ? 1 : 0;
    } catch (error) {
      report.errors.push(error.stack);
      save();
      console.error(error);
      process.exitCode = 1;
    } finally {
      window?.destroy();
      app.quit();
    }
  });
}
