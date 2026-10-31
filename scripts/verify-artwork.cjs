'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const base = process.env.KONGWOTV_ARTWORK_BASE_URL || 'http://127.0.0.1:17889';
const output = path.join(root, 'artifacts', 'artwork-build6', 'desktop', 'ui-' + new Date().toISOString().replace(/[:.]/g, '-'));
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const executable = require(path.join(root, 'desktop', 'node_modules', 'electron'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [__filename], { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  child.on('exit', (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
  child.on('error', (error) => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('use-mock-keychain');
  app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kongwotv-artwork-ui-')));
  fs.mkdirSync(output, { recursive: true });
  const report = { base, output, sourceMode: 'live-search-and-detail', fixtureResponses: false, checks: [], screenshots: [] };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let window;
  const evaluate = (script) => window.webContents.executeJavaScript(script, true);
  const waitFor = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await wait(100);
    }
    throw new Error('Timed out: ' + expression);
  };
  const capture = async (name) => {
    await wait(300);
    const image = await window.webContents.capturePage();
    assert.ok(!image.isEmpty());
    fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
    report.screenshots.push(name + '.png');
  };
  const check = async (name, expression) => {
    assert.ok(await evaluate(expression), name);
    report.checks.push({ name, passed: true });
    console.log('PASS ' + name);
  };
  const createWindow = (name) => {
    const isolated = session.fromPartition('artwork-qa-' + process.pid + '-' + name);
    window = new BrowserWindow({ width: 1600, height: 1000, show: false, backgroundColor: '#08090b',
      webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    return isolated;
  };
  const openPortrait = async () => {
    await window.loadURL(base + '/?s=' + encodeURIComponent('燃烧女子的肖像'));
    await waitFor('Array.from(document.querySelectorAll(".tv-poster-card--aggregated")).some(card=>card.querySelector(".tv-poster-card__title")?.textContent==="燃烧女子的肖像")');
    await evaluate(`{ const card=Array.from(document.querySelectorAll('.tv-poster-card--aggregated')).find(card=>card.querySelector('.tv-poster-card__title')?.textContent==='燃烧女子的肖像'); card.querySelector('.tv-poster-card__trigger').click(); }`);
    await wait(250);
    if (!(await evaluate('!!document.querySelector(".tv-film-detail")'))) {
      await waitFor('!!document.querySelector(".tv-poster-card--expanded .tv-poster-card__source-button")');
      await evaluate(`{ const buttons=Array.from(document.querySelectorAll('.tv-poster-card--expanded .tv-poster-card__source-button')); (buttons.find(button=>button.textContent.includes('360'))||buttons[0]).click(); }`);
    }
    await waitFor('!!document.querySelector(".tv-film-detail")');
    await waitFor('!!document.querySelector(".tv-film-detail__play:not(:disabled)") && document.querySelector(".tv-film-detail__play").textContent.includes("立即播放")');
  };
  app.whenReady().then(async () => {
    try {
      createWindow('success');
      await openPortrait();
      await waitFor('!!document.querySelector(".tv-detail-artwork-hd.is-ready")');
      await check('real original backdrop decoded at 3840x2160', `(() => { const image=document.querySelector('.tv-detail-artwork-hd.is-ready'); return image?.naturalWidth===3840 && image?.naturalHeight===2160 && image.src==='https://image.tmdb.org/t/p/original/ivJ5UzT6IzucLVfbZwCCwiJJoBz.jpg'; })()`);
      await check('source cover is retained independently', 'document.querySelector(".tv-detail-artwork-fallback")?.naturalWidth===270');
      await check('ordinary playback action remains available', '!!document.querySelector(".tv-film-detail__play:not(:disabled)")');
      await capture('desktop-hd');
      report.decodedArtwork = await evaluate(`(() => { const image=document.querySelector('.tv-detail-artwork-hd'); return { url:image.src,width:image.naturalWidth,height:image.naturalHeight,display: {width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height} }; })()`);
      await evaluate(`localStorage.setItem('kongwotv-private-artwork',JSON.stringify({enabled:false,credential:''}));window.dispatchEvent(new Event('kongwotv:artwork-preferences'));`);
      await waitFor('!document.querySelector(".tv-detail-artwork-hd")');
      await waitFor(`(() => { const image=document.querySelector('.tv-detail-artwork-fallback'); return image?.naturalWidth===270 && !image.classList.contains('is-covered') && parseFloat(getComputedStyle(image).opacity)>.7; })()`);
      await check('turning off HD restores the same actual cover image', `(() => { const image=document.querySelector('.tv-detail-artwork-fallback');return image?.naturalWidth===270 && !image.classList.contains('is-covered') && parseFloat(getComputedStyle(image).opacity)>.7; })()`);
      await capture('desktop-cover');
      await evaluate(`localStorage.setItem('kongwotv-private-artwork',JSON.stringify({enabled:true,credential:''}));window.dispatchEvent(new Event('kongwotv:artwork-preferences'));`);
      await waitFor('!!document.querySelector(".tv-detail-artwork-hd.is-ready")');
      window.setContentSize(1280, 800);
      await check('desktop layout has no horizontal overflow at 1280px', 'document.documentElement.scrollWidth<=innerWidth+1');
      await capture('desktop-1280-hd');
      await window.loadURL(base + '/about');
      await waitFor('document.querySelector("img[alt=TMDB]")?.naturalWidth>0');
      await check('TMDB logo and official attribution ship with the client', 'document.body.textContent.includes("This product uses the TMDB API but is not endorsed or certified by TMDB.")');
      window.destroy();
      const blocked = createWindow('failed-image');
      const cancelled = [];
      blocked.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (request, callback) => {
        const deny = request.url.includes('image.tmdb.org');
        if (deny) cancelled.push(request.url);
        callback({ cancel: deny });
      });
      await openPortrait();
      await waitFor('!!document.querySelector(".tv-detail-artwork-fallback") && !document.querySelector(".tv-detail-artwork-hd")');
      await waitFor(`(() => { const image=document.querySelector('.tv-film-detail__backdrop .tv-detail-artwork-fallback');return image?.naturalWidth===270 && !image.classList.contains('is-covered') && parseFloat(getComputedStyle(image).opacity)>.7; })()`);
      await check('a real cancelled CDN request falls back in the backdrop element', `(() => { const image=document.querySelector('.tv-film-detail__backdrop .tv-detail-artwork-fallback');return image?.naturalWidth===270 && !image.classList.contains('is-covered') && parseFloat(getComputedStyle(image).opacity)>.7; })()`);
      assert.ok(cancelled.length > 0, 'Failure scenario actually attempted a CDN request');
      report.cancelledImageRequests = cancelled;
      await capture('desktop-cdn-failure-fallback');
      await check('playback action remains available after image network failure', '!!document.querySelector(".tv-film-detail__play:not(:disabled)")');
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.error = error.stack;
      console.error(error.stack);
      if (window && !window.isDestroyed()) {
        report.diagnostic = await evaluate('({ title:document.title, text:document.body.innerText.slice(-7000), images:Array.from(document.images).map(image=>({src:image.src,w:image.naturalWidth,h:image.naturalHeight,class:image.className})) })').catch(() => null);
        await capture('failure').catch(() => {});
      }
    } finally {
      fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
      console.log('Artwork desktop UI evidence: ' + output);
      app.exit(report.passed ? 0 : 1);
    }
  });
}
