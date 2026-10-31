'use strict';

// Runs inside Electron's main process. Only the two metadata API responses are
// intercepted; the renderer must fetch, demux and decode the actual HLS media.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const ALL_CHECKS = Object.freeze(['vod_real_hls_decode', 'pause_and_resume', 'seek_preview_then_commit', 'seek_escape_cancels', 'rate_1_25_persists_after_reload', 'long_hold_boost_and_release_restore', 'long_hold_real_window_blur_restore', 'episode_change_cancels_active_seek', 'web_fullscreen_menus_episode_same_video', 'native_fullscreen_menus_episode_same_video', 'settings_fit_fill_changes_real_object_fit', 'live_real_decode_and_hidden_vod_controls', 'live_web_fullscreen_switch_keeps_video', 'required_screenshots_and_real_media_requests']);
const OS_CHECK_REASONS = Object.freeze({
  native_fullscreen_menus_episode_same_video: 'Explicit renderer-only scope excludes OS native fullscreen and foreground-focus acceptance.',
  long_hold_real_window_blur_restore: 'Explicit renderer-only scope excludes real OS window blur and foreground-focus restoration acceptance.',
});
const RENDERER_CHECKS = Object.freeze(ALL_CHECKS.filter((name) => !Object.hasOwn(OS_CHECK_REASONS, name)));

function summarizeChecks({ checks, scope, error, interceptionErrors = [] }) {
  const rendererOnly = scope === 'renderer-only';
  const noErrors = !error && interceptionErrors.length === 0 && checks.every((item) => item.passed);
  const fullAcceptancePassed = !rendererOnly && scope === 'full' && noErrors && ALL_CHECKS.every((name) => checks.some((item) => item.name === name && item.passed));
  const skippedChecks = ALL_CHECKS.filter((name) => !checks.some((item) => item.name === name));
  return {
    scope, passed: fullAcceptancePassed, fullAcceptancePassed,
    ...(rendererOnly ? { rendererPassed: noErrors && checks.length === RENDERER_CHECKS.length && RENDERER_CHECKS.every((name) => checks.some((item) => item.name === name && item.passed)) } : {}),
    skippedChecks,
    skippedCheckReasons: Object.fromEntries(skippedChecks.map((name) => [name, rendererOnly && Object.hasOwn(OS_CHECK_REASONS, name) ? OS_CHECK_REASONS[name] : 'Not executed because a required setup or decode prerequisite failed.'])),
  };
}

async function runPlayerSelfTest({ app, window, origin, output, fixtures }) {
  const scope = process.env.KONGWOTV_PLAYER_TEST_SCOPE || 'full';
  const rendererOnly = scope === 'renderer-only';
  const started = Date.now();
  const deadline = started + 210000;
  const checks = [];
  const screenshots = {};
  const focusTrace = [];
  const inputEvidence = [];
  let activationPrepared = false;
  const interception = { detail: 0, livePlaylist: 0, errors: [] };
  const mediaRequests = { manifests: 0, segments: 0, bytes: 0, manifestQueries: [] };
  const wc = window.webContents;
  let fixtureServer;
  let attached = false;
  let debuggerListener;
  let seedIdentifier;
  let heldMouse = null;
  let fixtureOrigin;
  let fatal;
  fs.mkdirSync(output, { recursive: true });

  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const read = (fn, ...args) => {
    if (wc.isDestroyed()) throw new Error('The player window was destroyed during QA.');
    return wc.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  };
  const media = () => read(() => {
    const v = document.querySelector('.art-video-player video') || document.querySelector('video');
    const root = document.querySelector('.art-video-player');
    const quality = v?.getVideoPlaybackQuality?.();
    return v ? {
      time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : null,
      paused: v.paused, seeking: v.seeking, rate: v.playbackRate, defaultRate: v.defaultPlaybackRate,
      width: v.videoWidth, height: v.videoHeight, ready: v.readyState,
      frames: quality?.totalVideoFrames ?? 0, droppedFrames: quality?.droppedVideoFrames ?? 0,
      src: v.currentSrc, error: v.error ? { code: v.error.code, message: v.error.message } : null,
      fit: getComputedStyle(v).objectFit, nativeFullscreen: !!root && document.fullscreenElement === root,
      webFullscreen: !!root?.classList.contains('art-fullscreen-web'),
      index: Number(new URL(location.href).searchParams.get('index') || 0),
      route: location.pathname, focused: document.hasFocus(),
      fullscreenEvents: window.__kongwoNativeFsEvents?.slice() || [],
      panel: !!document.querySelector('.bili-panel'),
      controlsVisible: document.querySelector('[data-player-ui]')?.dataset.visible,
    } : null;
  });
  async function until(label, fn, timeout = 10000) {
    const end = Math.min(deadline, Date.now() + timeout);
    let last;
    while (Date.now() < end) {
      last = await fn();
      if (last) return last;
      await delay(90);
    }
    let state;
    try { state = await media(); } catch { /* Preserve the original timeout. */ }
    throw new Error(`${label} timed out; media=${JSON.stringify(state)}, last=${JSON.stringify(last)}`);
  }
  async function focusState() {
    return {
      ...(await read(() => ({ documentFocused: document.hasFocus(), visibility: document.visibilityState,
        activeElement: document.activeElement?.tagName, ready: document.readyState, route: location.pathname,
        fullscreenEnabled: document.fullscreenEnabled, userActivation: { active: navigator.userActivation?.isActive, seen: navigator.userActivation?.hasBeenActive } }))),
      nativeWindowFocused: window.isFocused(), webContentsFocused: wc.isFocused(), visible: window.isVisible(), minimized: window.isMinimized(), nativeWindowFullscreen: window.isFullScreen(),
      ...(process.platform === 'darwin' ? { appHidden: app.isHidden(), dockVisible: app.dock?.isVisible() } : {}),
    };
  }
  const focused = (state) => state.documentFocused && state.nativeWindowFocused && state.webContentsFocused && state.visible && state.visibility === 'visible';
  const rendererVisible = (state) => state.visible && state.visibility === 'visible';
  const interactionFocused = (state) => rendererOnly ? rendererVisible(state) : focused(state);
  async function ensureRendererFocus(label) {
    const entry = { label, scope: 'renderer-only', atMs: Date.now() - started, requests: 1, before: await focusState(), focusCertified: false };
    focusTrace.push(entry);
    // This scope injects renderer input; requesting focus is best effort only.
    // Observe real focus values, and never equate visibility with acquired focus.
    try { wc.focus(); } catch (error) { entry.focusRequestError = error.message; }
    let last;
    try {
      await until(`visible renderer for injected input (${label})`, async () => {
        last = await focusState(); return rendererVisible(last);
      }, 6500);
      entry.after = last; entry.acquired = last.documentFocused; entry.rendererReady = true;
      return last;
    } catch (error) {
      entry.after = await focusState(); entry.acquired = entry.after.documentFocused; entry.rendererReady = false; entry.error = error.message;
      throw new Error(`Renderer is not visible for injected input ${label}: ${JSON.stringify(entry)}`);
    }
  }
  async function ensureRealFocus(label) {
    if (rendererOnly) return ensureRendererFocus(label);
    const entry = { label, atMs: Date.now() - started, requests: 0, before: await focusState(), apiErrors: [] };
    focusTrace.push(entry);
    if (focused(entry.before)) { entry.after = entry.before; entry.acquired = true; entry.durationMs = 0; return entry.before; }
    try {
      if (process.platform === 'darwin' && !activationPrepared) {
        activationPrepared = true;
        try { app.setActivationPolicy('regular'); } catch (error) { entry.apiErrors.push(`setActivationPolicy: ${error.message}`); }
        try {
          if (!app.dock.isVisible()) await Promise.race([app.dock.show(), delay(1800).then(() => { throw new Error('Dock show timed out'); })]);
        } catch (error) { entry.apiErrors.push(`dock.show: ${error.message}`); }
      }
      const request = () => {
        entry.requests++;
        if (window.isMinimized()) window.restore();
        if (process.platform === 'darwin' && app.isHidden()) app.show();
        window.show(); app.focus({ steal: true }); window.focus(); wc.focus();
      };
      request();
      let nextRequest = Date.now() + 700;
      let stable = 0;
      let last;
      await until(`real foreground focus (${label})`, async () => {
        last = await focusState();
        stable = focused(last) ? stable + 1 : 0;
        if (stable >= 2) return true;
        if (!focused(last) && Date.now() >= nextRequest && entry.requests < 3) { request(); nextRequest = Date.now() + 900; }
        return false;
      }, 6500);
      entry.after = last; entry.acquired = true; entry.durationMs = Date.now() - started - entry.atMs;
      return last;
    } catch (error) {
      entry.after = await focusState(); entry.acquired = false; entry.error = error.message;
      throw new Error(`Real Electron focus could not be acquired for ${label}; ${JSON.stringify(entry)}. No document focus value was overridden; compare a packaged app launch if the development process cannot activate.`);
    }
  }
  async function collectInputEvidence(checkpoint) {
    if (!rendererOnly) return;
    const events = await read(() => window.__kongwoQaInputEvents?.splice(0) || []);
    inputEvidence.push(...events.map((event) => ({ checkpoint, ...event })));
  }
  async function navigate(url, label) {
    await collectInputEvidence(`before navigation: ${label}`);
    await ensureRealFocus(`${label}: before navigation`);
    await window.loadURL(url);
    await ensureRealFocus(`${label}: after navigation`);
  }
  async function shot(name) {
    const image = await wc.capturePage();
    assert(!image.isEmpty(), `Screenshot ${name} is empty.`);
    const filename = path.join(output, `${name}.png`);
    fs.writeFileSync(filename, image.toPNG());
    screenshots[name] = filename;
    return filename;
  }
  async function position(selector, text, fraction = 0.5, probePoint = null) {
    const located = await read((css, label, ratio, probe) => {
      const fullscreen = document.fullscreenElement;
      const root = fullscreen?.closest('.art-video-player') || fullscreen?.querySelector('.art-video-player')
        || document.querySelector('.art-video-player.art-fullscreen-web') || document.querySelector('.art-video-player');
      const scope = css === '.art-video-player' ? root : root?.querySelector('.bili-player-ui');
      const nodes = css === '.art-video-player' ? (root ? [root] : []) : [...(scope?.querySelectorAll(css) || [])];
      const element = label == null ? nodes[0] : nodes.find((node) => node.textContent.trim() === label);
      if (!element || element.disabled || element.closest('[inert]')) return null;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(element).visibility === 'hidden') return null;
      const point = probe || { x: Math.round(r.left + r.width * ratio), y: Math.round(r.top + r.height / 2) };
      const hit = document.elementFromPoint(point.x, point.y);
      const describe = (node) => node ? { tag: node.tagName, label: node.getAttribute('aria-label'), classes: node.getAttribute('class'), text: node.textContent?.trim().slice(0, 90) } : null;
      return { ...point, width: r.width, height: r.height, hitMatches: !!hit && (hit === element || element.contains(hit)),
        selected: describe(element), hit: describe(hit), scope: css === '.art-video-player' ? 'active-player-root' : 'active-player-ui' };
    }, selector, text ?? null, fraction, probePoint);
    assert(located, `No available player element: ${selector}${text ? ` (${text})` : ''}`);
    assert(located.hitMatches, `Player input target is covered or mismatched: ${JSON.stringify(located)}`);
    return located;
  }
  function move(point, pressed = false) {
    wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y, modifiers: pressed ? ['leftButtonDown'] : [] });
  }
  function down(point) {
    heldMouse = point;
    move(point);
    wc.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  function up(point = heldMouse) {
    if (!point) return;
    wc.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    heldMouse = null;
  }
  async function click(selector, text) {
    await ensureRealFocus(`click ${selector}`);
    await reveal();
    let point = await position(selector, text);
    move(point); await delay(45);
    point = await position(selector, text); move(point); await delay(25);
    await position(selector, text, 0.5, { x: point.x, y: point.y });
    down(point); await delay(40); up(point); await delay(100);
  }
  async function key(keyCode, modifiers = []) {
    if (heldMouse) {
      const observed = await focusState();
      if (rendererOnly) focusTrace.push({ label: `key ${keyCode} during injected pointer gesture`, scope: 'renderer-only', observed, acquired: observed.documentFocused, focusCertified: false });
      assert(interactionFocused(observed), rendererOnly ? `Renderer became invisible during injected pointer input before ${keyCode}.` : `Real foreground focus was lost during the active pointer gesture before ${keyCode}.`);
    } else await ensureRealFocus(`key ${keyCode}`);
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await delay(100);
  }
  async function reveal() {
    const point = await position('.art-video-player');
    // A real pointer movement also removes inert from the hidden controls.
    move({ x: point.x - 2, y: point.y - 18 }); await delay(20); move({ x: point.x, y: point.y - 18 });
    await until('controls visible', () => read(() => document.querySelector('[data-player-ui]')?.dataset.visible === 'true'), 3000);
  }
  async function closeMenus() {
    if (await read(() => !!document.querySelector('.bili-panel'))) await key('Escape');
    await until('menu closed', () => read(() => !document.querySelector('.bili-panel')), 3000);
  }
  async function prepareClock() {
    await ensureRealFocus('prepare playback clock');
    await until('video metadata', async () => { const v = await media(); return v?.width > 0 && v.ready >= 1 && v.duration > 2; }, 18000);
    await closeMenus();
    // Test setup only. Playback controls and seeking assertions below use real input.
    await read(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 1; });
    await until('fixture clock reset', async () => { const v = await media(); return v?.paused && !v.seeking && v.ready >= 2 && Math.abs(v.time - 1) < 0.35; });
    await reveal();
    await until('play button reflects pause', () => read(() => !!document.querySelector('.bili-play[aria-label="播放"]')), 3000);
  }
  async function playAndDecode() {
    await prepareClock();
    await click('.bili-play[aria-label="播放"]');
    await until('actual decoded HLS frames and advancing clock', async () => {
      const v = await media();
      return v?.width > 0 && v.height > 0 && v.frames > 0 && !v.paused && v.time > 1.15;
    }, 15000);
    return media();
  }
  async function observeNativeFullscreen() {
    await read(() => {
      window.__kongwoNativeFsStop?.();
      const events = [];
      window.__kongwoNativeFsEvents = events;
      const record = (kind, reason) => {
        events.push({ kind, reason, at: performance.now(), focused: document.hasFocus(), visibility: document.visibilityState,
          enabled: document.fullscreenEnabled, fullscreenElement: document.fullscreenElement?.className || null,
          activation: { active: navigator.userActivation?.isActive, seen: navigator.userActivation?.hasBeenActive } });
        if (events.length > 20) events.shift();
      };
      const change = () => record('fullscreenchange');
      const failure = () => record('fullscreenerror');
      const rejection = (event) => record('unhandledrejection', { name: event.reason?.name, message: event.reason?.message || String(event.reason) });
      document.addEventListener('fullscreenchange', change);
      document.addEventListener('fullscreenerror', failure);
      window.addEventListener('unhandledrejection', rejection);
      window.__kongwoNativeFsStop = () => {
        document.removeEventListener('fullscreenchange', change); document.removeEventListener('fullscreenerror', failure);
        window.removeEventListener('unhandledrejection', rejection);
      };
      record('probe-start');
    });
  }
  async function newMediaSource(previous, label) {
    return until(label, async () => { const v = await media(); return v?.src && v.src !== previous && v.ready >= 2 && v.width > 0; }, 15000);
  }
  async function rememberNodes() {
    return read(() => {
      const root = document.querySelector('.art-video-player');
      window.__kongwoPlayerQaNodes = { root, video: root.querySelector('video') };
      return { hasRoot: !!root, hasVideo: !!window.__kongwoPlayerQaNodes.video };
    });
  }
  async function sameNodes() {
    return read(() => {
      const current = document.querySelector('.art-video-player');
      const saved = window.__kongwoPlayerQaNodes;
      return { root: !!saved && current === saved.root, video: !!saved && current?.querySelector('video') === saved.video };
    });
  }
  async function assertNodes(context) {
    const identity = await sameNodes();
    assert(identity.root && identity.video, `${context} replaced the Artplayer root or video: ${JSON.stringify(identity)}`);
    return identity;
  }
  async function leaveFullscreen() {
    await read(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
    if (await read(() => !!document.querySelector('.art-fullscreen-web'))) { await reveal(); await click('.bili-web-button'); }
    await until('fullscreen cleanup', () => read(() => !document.fullscreenElement && !document.querySelector('.art-fullscreen-web')), 7000);
  }
  async function check(name, action) {
    if (rendererOnly && Object.hasOwn(OS_CHECK_REASONS, name)) {
      console.log(`[player-qa] SKIP ${name}: ${OS_CHECK_REASONS[name]}`);
      return false;
    }
    const begin = Date.now();
    try {
      const details = await action();
      if (rendererOnly) { const current = await media(); assert(!current?.error, `Renderer media error after ${name}: ${JSON.stringify(current?.error)}`); }
      await collectInputEvidence(name);
      checks.push({ name, passed: true, durationMs: Date.now() - begin, details });
      console.log(`[player-qa] PASS ${name}`);
      return true;
    } catch (error) {
      let state;
      let actualFocus;
      try { state = await media(); actualFocus = await focusState(); } catch { /* Window failure is reported in error. */ }
      try { await collectInputEvidence(`${name}: failure`); } catch { /* The failed check remains authoritative. */ }
      checks.push({ name, passed: false, durationMs: Date.now() - begin, error: error.stack || String(error), state, focus: actualFocus });
      console.error(`[player-qa] FAIL ${name}: ${error.message}`);
      try { up(); await shot(`failure-${name}`); } catch { /* Keep collecting independent checks. */ }
      return false;
    }
  }

  try {
    assert(scope === 'full' || scope === 'renderer-only', `Unsupported player QA scope: ${scope}`);
    assert(new URL(origin).hostname === '127.0.0.1' || new URL(origin).hostname === 'localhost', 'Player QA only runs against the local desktop server.');
    const profileRelative = path.relative(path.resolve(output), path.resolve(app.getPath('userData')));
    assert(profileRelative && !profileRelative.startsWith('..') && !path.isAbsolute(profileRelative), 'Main must isolate userData under the player QA output directory.');
    const fixtureInput = typeof fixtures === 'string' ? fixtures : fixtures?.directory || process.env.KONGWOTV_PLAYER_FIXTURE_DIR;
    assert(typeof fixtureInput === 'string' && fixtureInput.length > 0, 'A fixture directory must be supplied.');
    const fixtureDirectory = path.resolve(fixtureInput);
    assert(fs.statSync(path.join(fixtureDirectory, 'fixture.m3u8')).isFile(), 'Missing fixture.m3u8; launch with the player self-test driver.');
    fixtureServer = http.createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      let target;
      let parsed;
      try {
        parsed = new URL(request.url, 'http://127.0.0.1');
        target = path.resolve(fixtureDirectory, `.${decodeURIComponent(parsed.pathname)}`);
        if (!target.startsWith(`${fixtureDirectory}${path.sep}`) || !fs.statSync(target).isFile()) throw new Error('not found');
      } catch { response.writeHead(404); response.end(); return; }
      const size = fs.statSync(target).size;
      const extension = path.extname(target);
      response.setHeader('Content-Type', extension === '.m3u8' ? 'application/vnd.apple.mpegurl' : extension === '.ts' ? 'video/mp2t' : 'application/octet-stream');
      response.setHeader('Accept-Ranges', 'bytes');
      let start = 0;
      let end = size - 1;
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      response.setHeader('Content-Length', end - start + 1);
      if (request.method === 'HEAD') { response.end(); return; }
      if (extension === '.m3u8') { mediaRequests.manifests++; mediaRequests.manifestQueries.push(parsed.search); }
      if (extension === '.ts') mediaRequests.segments++;
      mediaRequests.bytes += end - start + 1;
      const stream = fs.createReadStream(target, { start, end });
      stream.on('error', () => response.destroy()); stream.pipe(response);
    });
    await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', resolve); });
    fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
    const episodes = [1, 2].map((id) => `${fixtureOrigin}/fixture.m3u8?episode=${id}`);
    const channelUrls = [1, 2].map((id) => `${fixtureOrigin}/fixture.m3u8?channel=${id}`);
    const subscription = `${fixtureOrigin}/qa-playlist.m3u`;
    const status = await read(async () => { const r = await fetch('/api/status'); if (!r.ok) throw new Error(`status ${r.status}`); return r.json(); });
    const source = status.defaultSources?.[0];
    assert(source?.key && source?.url, 'The actual /api/status response has no default source.');
    assert(status.verified && !status.passwordRequired, 'Desktop QA requires the isolated authenticated local application.');
    assert(!wc.debugger.isAttached(), 'A debugger is already attached; QA will not detach another client.');
    wc.debugger.attach('1.3'); attached = true;
    debuggerListener = (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      void (async () => {
        const url = new URL(params.request.url);
        let payload;
        if (url.origin === origin && url.pathname === '/api/detail' && url.searchParams.get('id') === 'kongwotv-player-self-test') {
          interception.detail++;
          payload = { episodes, videoInfo: { title: '幕里本地播放验证', sourceKey: source.key, sourceName: '本地验证' } };
        } else if (url.origin === origin && url.pathname === '/api/live/playlist') {
          interception.livePlaylist++;
          payload = { channels: channelUrls.map((url, i) => ({ id: `qa-channel-${i + 1}`, name: `本地验证频道${i + 1}`, url, group: '验证频道' })), groups: ['验证频道'] };
        }
        if (!payload) { await wc.debugger.sendCommand('Fetch.continueRequest', { requestId: params.requestId }); return; }
        await wc.debugger.sendCommand('Fetch.fulfillRequest', {
          requestId: params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        });
      })().catch(async (error) => {
        interception.errors.push(error.message);
        try { await wc.debugger.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }); } catch { /* Debugger may have detached. */ }
      });
    };
    wc.debugger.on('message', debuggerListener);
    await wc.debugger.sendCommand('Fetch.enable', { patterns: [
      { urlPattern: `${origin}/api/detail?*`, requestStage: 'Request' },
      { urlPattern: `${origin}/api/live/playlist?*`, requestStage: 'Request' },
    ] });
    // Seed on the new document: the old page's beforeunload storage flush must
    // not overwrite QA settings between this call and the navigation.
    const seed = (selectedSource, playlist, seenLive, marker, observeInputs) => {
      if (observeInputs) {
        const events = [];
        window.__kongwoQaInputEvents = events;
        for (const type of ['pointerdown', 'pointerup', 'keydown', 'click']) document.addEventListener(type, (event) => {
          const target = event.target?.closest?.('button,input') || event.target;
          events.push({ type, isTrusted: event.isTrusted, target: target?.tagName, label: target?.getAttribute?.('aria-label') || null,
            key: event.key, button: event.button, documentFocused: document.hasFocus(), route: location.pathname, at: performance.now() });
          if (events.length > 200) events.shift();
        }, { capture: true, passive: true });
      }
      let saved;
      try { saved = JSON.parse(localStorage.getItem('kongwotv-settings') || '{}'); } catch { saved = {}; }
      saved.version = 2;
      saved.state = { ...saved.state, selectedKeys: [selectedSource.key], envKeysSeen: [selectedSource.key], autoplayNext: false, adFilter: false,
        liveEnvKeysSeen: seenLive, liveSubscriptions: [{ url: playlist, name: '本地验证', fromSubscriptions: [] }], liveSelectedUrls: [playlist] };
      localStorage.setItem('kongwotv-settings', JSON.stringify(saved));
      if (sessionStorage.getItem('kongwotv.qa.fixture') !== marker) {
        localStorage.removeItem('kongwotv.player.rate'); localStorage.removeItem('kongwotv.player.fit');
        sessionStorage.setItem('kongwotv.qa.fixture', marker);
      }
    };
    await wc.debugger.sendCommand('Page.enable');
    const seedArgs = JSON.stringify([source, subscription, (status.defaultLiveSources || []).map((s) => s.key), fixtureOrigin, rendererOnly]);
    seedIdentifier = (await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (location.origin === ${JSON.stringify(origin)}) (${seed.toString()})(...${seedArgs});`,
    })).identifier;
    const watch = new URL('/watch', origin);
    watch.search = new URLSearchParams({ source: source.key, id: 'kongwotv-player-self-test', index: '0', title: '幕里本地播放验证', url: episodes[0] }).toString();
    await navigate(watch.href, 'watch');
    const decoded = await check('vod_real_hls_decode', async () => {
      const state = await playAndDecode();
      assert(state.duration >= 10 && state.duration <= 14, `Expected the 12-second fixture, got ${state.duration}.`);
      await reveal(); await shot('desktop-player');
      assert(interception.detail > 0 && mediaRequests.segments > 0, 'Detail metadata or actual media bytes were not requested.');
      return state;
    });

    if (decoded) {
      await check('pause_and_resume', async () => {
        await prepareClock();
        const before = await media();
        await click('.bili-play[aria-label="播放"]');
        await until('resume advances time', async () => { const v = await media(); return !v.paused && v.time > before.time + 0.15; });
        const playing = await media();
        await reveal(); await click('.bili-play[aria-label="暂停"]');
        await until('pause state', async () => (await media()).paused);
        const paused = await media(); await delay(200);
        assert(Math.abs((await media()).time - paused.time) < 0.15, 'Paused clock continues advancing.');
        return { before, playing, paused };
      });
      await check('seek_preview_then_commit', async () => {
        await prepareClock();
        const before = await media();
        const from = await position('input[aria-label="播放进度"]', null, 0.12);
        const to = await position('input[aria-label="播放进度"]', null, 0.66);
        down(from); await delay(100); move(to, true); heldMouse = to; await delay(160);
        const during = await media();
        const preview = await read(() => Number(document.querySelector('.bili-player-ui input[aria-label="播放进度"]').value));
        assert(preview > before.time + 3, 'The real range did not produce a preview.');
        assert(Math.abs(during.time - before.time) < 0.25, 'Dragging sought before pointer release.');
        up(to);
        await until('seek committed after pointer release', async () => { const v = await media(); return !v.seeking && Math.abs(v.time - preview) < 0.45; });
        return { before: before.time, preview, during: during.time, after: (await media()).time };
      });
      await check('seek_escape_cancels', async () => {
        await prepareClock(); const before = await media();
        const from = await position('input[aria-label="播放进度"]', null, 0.12);
        const to = await position('input[aria-label="播放进度"]', null, 0.72);
        down(from); move(to, true); heldMouse = to; await delay(120); await key('Escape'); up(to); await delay(180);
        const after = await media();
        assert(Math.abs(after.time - before.time) < 0.25, 'Escape committed the canceled seek.');
        return { before: before.time, after: after.time };
      });
      await check('rate_1_25_persists_after_reload', async () => {
        await prepareClock(); await click('button[aria-label="播放速度"]'); await until('speed menu', () => read(() => !!document.querySelector('.bili-rate-options')));
        await shot('speed'); await click('.bili-rate-options button', '1.25x');
        await until('selected 1.25x', async () => Math.abs((await media()).rate - 1.25) < 0.001);
        const saved = await read(() => localStorage.getItem('kongwotv.player.rate'));
        assert(Number(saved) === 1.25, `Normal rate not persisted: ${saved}`);
        await navigate(wc.getURL(), 'rate persistence reload');
        const afterReload = await playAndDecode();
        assert(Math.abs(afterReload.rate - 1.25) < 0.001, 'The new document did not restore 1.25x.');
        return { saved, afterReload };
      });
      await check('long_hold_boost_and_release_restore', async () => {
        await playAndDecode(); const baseline = (await media()).rate;
        const point = await position('.art-video-player'); down({ x: point.x, y: point.y - 18 });
        await until('temporary 2x', async () => Math.abs((await media()).rate - Math.max(2, baseline)) < 0.001, 2500);
        const boosted = await media(); up();
        await until('normal rate after release', async () => Math.abs((await media()).rate - baseline) < 0.001, 2500);
        const restored = await media();
        assert(!restored.paused, 'The long-hold release click paused playback.');
        await delay(400);
        return { baseline, boosted: boosted.rate, restored: restored.rate };
      });
      await check('long_hold_real_window_blur_restore', async () => {
        await playAndDecode(); const baseline = (await media()).rate;
        await ensureRealFocus('long hold before blur');
        const point = await position('.art-video-player'); down({ x: point.x, y: point.y - 18 });
        await until('temporary rate before blur', async () => (await media()).rate >= 2, 2500);
        const beforeBlur = await focusState();
        assert(focused(beforeBlur), `Blur test did not start from actual foreground focus: ${JSON.stringify(beforeBlur)}`);
        let method = 'BrowserWindow.blur';
        let blurred;
        let restoredFocus;
        try {
          window.blur(); await delay(180);
          const afterRequest = await focusState();
          if (afterRequest.documentFocused || afterRequest.nativeWindowFocused) { method = 'BrowserWindow.hide'; window.hide(); }
          await until('real document and native window blur with rate restore', async () => {
            const state = await focusState(); const v = await media();
            return !state.documentFocused && !state.nativeWindowFocused && Math.abs(v.rate - baseline) < 0.001;
          }, 3500);
          blurred = await focusState();
        } finally {
          try { restoredFocus = await ensureRealFocus('restore after real long-hold blur'); }
          finally { up(); await delay(400); }
        }
        const restored = (await media()).rate;
        assert(Math.abs(restored - baseline) < 0.001, 'Normal rate changed after restoring genuine focus.');
        return { baseline, restored, method, focus: { before: beforeBlur, blurred, restored: restoredFocus } };
      });
      await check('episode_change_cancels_active_seek', async () => {
        await prepareClock(); await rememberNodes();
        const before = await media(); const index = before.index;
        const from = await position('input[aria-label="播放进度"]', null, 0.12);
        const to = await position('input[aria-label="播放进度"]', null, 0.76);
        down(from); move(to, true); heldMouse = to; await delay(100);
        await key(index === 0 ? 'Right' : 'Left', ['alt', 'shift']);
        await until('episode URL changed during drag', async () => (await media())?.index !== index);
        up(to);
        await newMediaSource(before.src, 'new episode media source during drag');
        const state = await media();
        assert(state.time < 5, 'The old seek preview was applied to the new episode.');
        return { identity: await assertNodes('Changing episode during a drag'), state };
      });
      await check('web_fullscreen_menus_episode_same_video', async () => {
        await leaveFullscreen(); await prepareClock(); await rememberNodes();
        await click('.bili-web-button');
        await until('web fullscreen', async () => (await media()).webFullscreen);
        await reveal(); await click('button[aria-label="播放速度"]');
        await until('speed menu inside web fullscreen', () => read(() => !!document.querySelector('.art-fullscreen-web .bili-panel')));
        await key('Escape'); await until('Escape closes menu', () => read(() => !document.querySelector('.bili-panel')));
        assert((await media()).webFullscreen, 'Escape closed web fullscreen instead of just its menu.');
        await click('button[aria-label="选集"]'); await until('episode menu', () => read(() => !!document.querySelector('.bili-episode-options'))); await shot('episodes');
        const before = await media(); const next = before.index === 0 ? 1 : 0;
        await click('.bili-episode-options button', `第 ${next + 1} 集`);
        await until('episode selected in web fullscreen', async () => (await media())?.index === next);
        await newMediaSource(before.src, 'web fullscreen new episode source');
        const state = await playAndDecode();
        assert(state.webFullscreen, 'Episode selection lost web fullscreen.');
        assert(Math.abs(state.rate - 1.25) < 0.001, 'Episode selection lost the selected normal rate.');
        const identity = await assertNodes('Web fullscreen and episode selection');
        await reveal(); await shot('fullscreen');
        await click('.bili-web-button'); await until('web fullscreen exited', async () => !(await media()).webFullscreen);
        await assertNodes('Exiting web fullscreen');
        return { identity, state };
      });
      await check('native_fullscreen_menus_episode_same_video', async () => {
        try {
          await leaveFullscreen(); await prepareClock(); await rememberNodes();
          const beforeFocus = await ensureRealFocus('native fullscreen request');
          await observeNativeFullscreen();
          await click('button[aria-label="全屏"]');
          await until('native fullscreen root', async () => (await media()).nativeFullscreen, 8000);
          await delay(process.platform === 'darwin' ? 650 : 200);
          await reveal(); await click('button[aria-label="选集"]');
          await until('menu inside native fullscreen root', () => read(() => !!document.fullscreenElement?.querySelector('.bili-panel')));
          const before = await media(); const next = before.index === 0 ? 1 : 0;
          await click('.bili-episode-options button', `第 ${next + 1} 集`);
          await until('episode selected in native fullscreen', async () => (await media())?.index === next);
          await newMediaSource(before.src, 'native fullscreen new episode source');
          const state = await playAndDecode();
          assert(state.nativeFullscreen, 'Episode selection lost native fullscreen.');
          const identity = await assertNodes('Native fullscreen and episode selection');
          await reveal(); await shot('native-fullscreen');
          await click('button[aria-label="退出全屏"]'); await until('native fullscreen exited', async () => !(await media()).nativeFullscreen, 8000);
          await assertNodes('Exiting native fullscreen');
          return { identity, state, focus: { before: beforeFocus, after: await focusState() } };
        } finally {
          try { await leaveFullscreen(); } catch { /* The check retains the original failure. */ }
          try { await read(() => window.__kongwoNativeFsStop?.()); } catch { /* Window may have closed. */ }
        }
      });
      await check('settings_fit_fill_changes_real_object_fit', async () => {
        await prepareClock(); await click('button[aria-label="更多播放设置"]'); await until('settings menu', () => read(() => !!document.querySelector('.bili-setting-options')));
        await click('.bili-setting-options button', '铺满屏幕');
        await until('native video object-fit cover', async () => (await media()).fit === 'cover');
        const filled = await media();
        await click('.bili-setting-options button', '适应画面');
        await until('native video object-fit contain', async () => (await media()).fit === 'contain');
        const fitted = await media(); await key('Escape');
        return { filled: filled.fit, fitted: fitted.fit };
      });
    }

    try { up(); await leaveFullscreen(); } catch { /* A fresh navigation also resets the document. */ }
    const live = new URL('/live', origin);
    live.search = new URLSearchParams({ url: channelUrls[0], name: '本地验证频道1', group: '验证频道' }).toString();
    await navigate(live.href, 'live');
    const liveDecoded = await check('live_real_decode_and_hidden_vod_controls', async () => {
      const state = await playAndDecode();
      const ui = await read(() => ({
        progress: !!document.querySelector('.bili-timeline, .bili-mini-progress'),
        speed: !!document.querySelector('.bili-player-ui button[aria-label="播放速度"]'),
        nextEpisode: !!document.querySelector('.bili-player-ui button[aria-label="下一集"]'),
        channelList: !!document.querySelector('.bili-player-ui button[aria-label="频道列表"]'),
      }));
      assert(!ui.progress && !ui.speed && !ui.nextEpisode && ui.channelList, `Incorrect live controls: ${JSON.stringify(ui)}`);
      assert(state.rate === 1, 'Live playback inherited the saved VOD rate.');
      assert(interception.livePlaylist > 0, 'The real live playlist UI did not request metadata.');
      await reveal(); await shot('live-player');
      await click('button[aria-label="更多播放设置"]');
      const invalidSettings = await read(() => {
        const panel = document.querySelector('.bili-setting-options');
        return !!panel?.querySelector('input[type="checkbox"]') || [...(panel?.querySelectorAll('button') || [])].some((button) => button.textContent.includes('截取当前画面'));
      });
      assert(!invalidSettings, 'Live exposes VOD-only autoplay or screenshot controls.');
      await key('Escape'); return { state, ui };
    });
    if (liveDecoded) await check('live_web_fullscreen_switch_keeps_video', async () => {
      try {
        await prepareClock(); await rememberNodes(); await click('.bili-web-button'); await until('live web fullscreen', async () => (await media()).webFullscreen);
        await reveal(); await click('button[aria-label="频道列表"]'); await until('actual two-channel menu', () => read(() => document.querySelectorAll('.bili-episode-options button').length === 2));
        const before = await read(() => new URL(location.href).searchParams.get('url'));
        const beforeMedia = await media();
        await click('.bili-episode-options button', '本地验证频道2');
        await until('live channel URL changed', () => read((old) => new URL(location.href).searchParams.get('url') !== old, before));
        await newMediaSource(beforeMedia.src, 'selected live channel media source');
        const state = await playAndDecode();
        assert(state.webFullscreen, 'Channel selection lost live web fullscreen.');
        const identity = await assertNodes('Live channel selection');
        await reveal(); await shot('live-fullscreen');
        const beforePrevious = await media();
        await click('button[aria-label="上一台"]');
        await until('real previous-channel action', () => read((expected) => new URL(location.href).searchParams.get('url') === expected, before));
        await newMediaSource(beforePrevious.src, 'previous live channel media source');
        await playAndDecode(); await assertNodes('Live previous-channel action');
        assert((await media()).webFullscreen, 'Previous-channel action lost fullscreen.');
        return { identity, state };
      } finally { try { await leaveFullscreen(); } catch { /* Report the primary assertion failure. */ } }
    });
    const required = ['desktop-player', 'speed', 'episodes', 'fullscreen', 'live-player'];
    await check('required_screenshots_and_real_media_requests', async () => {
      const missing = required.filter((name) => !screenshots[name]);
      assert(missing.length === 0, `Missing evidence screenshots: ${missing.join(', ')}`);
      assert(mediaRequests.manifests > 0 && mediaRequests.segments > 0 && mediaRequests.bytes > 0, 'No real HLS media was served.');
      assert(interception.errors.length === 0, `Metadata interception errors: ${interception.errors.join('; ')}`);
      return { screenshots: required, mediaRequests };
    });
  } catch (error) {
    fatal = error.stack || String(error);
    try { await shot('failure-infrastructure'); } catch { /* Window may not exist. */ }
  } finally {
    try { up(); await read(() => document.querySelector('video')?.pause()); } catch { /* Main owns shutdown. */ }
    if (attached && !wc.isDestroyed()) {
      try { await wc.debugger.sendCommand('Fetch.disable'); } catch { /* Detach below. */ }
      if (seedIdentifier) { try { await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedIdentifier }); } catch { /* Debugger may be closing. */ } }
      if (debuggerListener) wc.debugger.removeListener('message', debuggerListener);
      try { wc.debugger.detach(); } catch { /* Window may have exited. */ }
    }
    if (fixtureServer?.listening) await new Promise((resolve) => { fixtureServer.close(resolve); fixtureServer.closeAllConnections?.(); });
  }
  const acceptance = summarizeChecks({ checks, scope, error: fatal, interceptionErrors: interception.errors });
  return {
    ...acceptance,
    expectedAppExitCode: acceptance.passed ? 0 : 1,
    test: 'desktop-real-hls-player', durationMs: Date.now() - started,
    appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    packaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath(), resourcesPath: process.resourcesPath,
    pid: process.pid, parentPid: process.ppid, electron: process.versions.electron, node: process.versions.node,
    origin, fixtureOrigin, mediaRequests, interception, checks, screenshots, focusTrace, inputEvidence,
    inputMode: rendererOnly ? 'injected-renderer' : 'strict-foreground',
    macActivationPolicyRequested: process.platform === 'darwin' && activationPrepared,
    ...(fatal ? { error: fatal } : {}),
    limitations: [
      ...(rendererOnly ? ['Injected renderer inputs under locked console; OS/document foreground focus not certified. Renderer-only scope does not accept OS native fullscreen or real window blur/restoration; passed and fullAcceptancePassed remain false.'] : []),
      'Uses a local 12-second HLS fixture with actual Chromium decoding; metadata is supplied only for the two documented API routes.',
      'Live controls use a finite local HLS fixture; this does not validate long-running IPTV, real providers or live timeshift.',
      'No DRM, external-source availability, PiP, 404 recovery or hardware decoder acceptance is claimed.',
      'Escape menu layering is asserted in web fullscreen; native fullscreen may reserve Escape at browser/system level.',
    ],
  };
}

module.exports = { runPlayerSelfTest, summarizeChecks, ALL_CHECKS, RENDERER_CHECKS, OS_CHECK_REASONS };
