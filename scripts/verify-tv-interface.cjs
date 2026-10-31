'use strict';

// Run with Node. Reuses the desktop client's Electron; no browser dependency is installed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.KONGWOTV_UI_TEST_OUTPUT || path.join(root, 'artifacts', 'tv-interface');
const base = process.env.KONGWOTV_TEST_BASE_URL || 'http://127.0.0.1:8080';

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const executable = require(path.join(root, 'desktop', 'node_modules', 'electron'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [__filename], { env, stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
  child.on('exit', (code) => { clearTimeout(timeout); process.exitCode = code ?? 1; });
  child.on('error', (error) => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  app.commandLine.appendSwitch('use-mock-keychain');
  app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kongwotv-ui-')));
  const report = { base, checks: [], screenshots: [], errors: [], fixtureScreenshots: true };
  fs.mkdirSync(output, { recursive: true });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let window;
  const evaluate = (expression) => window.webContents.executeJavaScript(expression, true);
  const waitFor = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error('Timed out: ' + expression);
  };
  const check = async (name, expression) => {
    assert.ok(await evaluate(expression), name);
    report.checks.push({ name, passed: true });
    console.log('PASS ' + name);
  };
  const click = async (selector) => {
    await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.click(); }`);
    await delay(260);
  };
  const key = async (keyName) => {
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, bubbles: true, cancelable: true }))`);
    await delay(260);
  };
  const capture = async (name) => {
    await delay(350);
    const image = await window.webContents.capturePage();
    assert.ok(!image.isEmpty(), 'Screenshot is not empty');
    fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
    report.screenshots.push(name + '.png');
  };
  const visit = async (suffix = '/') => {
    await window.loadURL(base + suffix);
    await waitFor('!!document.querySelector("main")');
    await delay(300);
  };
  const fits = 'document.documentElement.scrollWidth <= innerWidth + 1';

  // Explicitly isolated fixture content. It never changes the user's application data.
  function fixtures() {
    window.__interfaceFixtures = true;
    const items = Array.from({ length: 12 }, (_, index) => ({ id: String(900001 + index), title: `界面测试影片 ${String(index + 1).padStart(2, '0')}`, cover: '/artwork/atmosphere-mountains.jpg', backdrop: '/artwork/atmosphere-mountains.jpg', year: '2026', genres: ['剧情', '冒险'], countries: ['测试地区'], description: '这是界面回归测试条目，用来验证长标题、内容浏览、片单和详情返回。测试数据只存在于本次隔离的浏览器会话中。', directors: ['测试导演'], actors: ['演员甲', '演员乙', '演员丙', '演员丁'] }));
    const source = { key: 'interface_qa', name: '界面测试源', url: 'https://example.com/api/vod' };
    const result = { sourceKey: source.key, sourceName: source.name, sourceUrl: source.url, vodId: '900001', name: items[0].title, pic: items[0].cover, year: '2026' };
    if (!localStorage.getItem('kongwotv-theme')) localStorage.setItem('kongwotv-theme', 'dark');
    if (!sessionStorage.getItem('interface-fixtures-seeded')) {
      localStorage.setItem('kongwotv-settings', JSON.stringify({ version: 2, state: { customAPIs: [], selectedKeys: [source.key], imageProxyMode: 'direct', imageProxyModeTouched: true, recommendSource: 'hot-list', recommendSourceTouched: true, doubanEnabled: false } }));
      sessionStorage.setItem('interface-fixtures-seeded', '1');
    }
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      let data;
      if (url.pathname === '/api/status') data = { passwordRequired: false, verified: true, version: '2.16.12', defaultSources: [source], defaultLiveSources: [{ key: 'interface_live', name: '界面测试频道', url: 'https://example.com/channels.m3u' }], defaultSubscriptions: [], defaultRecommendSource: 'hot-list', defaultImageMode: 'direct' };
      else if (url.pathname === '/api/hot-list' || url.pathname === '/api/douban') data = { items };
      else if (url.pathname === '/api/catalog') data = { item: items.find((item) => item.id === url.searchParams.get('id')) || items[0] };
      else if (url.pathname === '/api/discover') data = { items, nextStart: null, hasMore: false, total: items.length };
      else if (url.pathname === '/api/detail') data = { episodes: ['https://example.com/test.m3u8'], videoInfo: { title: items[0].title, cover: items[0].cover, desc: items[0].description, sourceKey: source.key, sourceName: source.name } };
      else if (url.pathname === '/api/search') {
        if (sessionStorage.getItem('audit-search-error')) return new Response(JSON.stringify({ error: '界面测试：搜索服务暂不可用' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        const matchedResult = { ...result, year: sessionStorage.getItem('audit-wrong-year') ? '2007' : result.year };
        if (url.searchParams.get('stream') === '1') return new Response(JSON.stringify({ type: 'source', sourceKey: source.key, ok: true, list: [matchedResult] }) + '\n' + JSON.stringify({ type: 'done', list: [matchedResult], failures: [] }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
        data = { list: [matchedResult], failures: [] };
      } else if (url.pathname === '/api/live/playlist') data = { name: '界面测试频道', channels: Array.from({ length: 10 }, (_, index) => ({ id: 'qa-' + index, name: '测试频道 ' + (index + 1), group: index < 5 ? '新闻' : '纪录', url: 'https://example.com/channel' + index + '.m3u8' })), groups: ['新闻', '纪录'] };
      else if (url.pathname === '/api/auth') data = { success: true, verified: true };
      else return original(input, options);
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    };
  }

  app.whenReady().then(async () => {
    try {
      require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
      const browserSession = session.fromPartition('tv-interface-verification');
      const auth = await fetch(base + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.PASSWORD || '' }) });
      assert.ok(auth.ok, 'Local application authentication');
      for (const cookie of auth.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        await browserSession.cookies.set({ url: base, name: pair.slice(0, separator), value: pair.slice(separator + 1), httpOnly: /HttpOnly/i.test(cookie) });
      }
      window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false, backgroundColor: '#08090b', webPreferences: { session: browserSession, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      await window.loadURL('about:blank');
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Runtime.enable');
      await window.webContents.debugger.sendCommand('Page.enable');
      window.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Runtime.exceptionThrown') report.errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
      });
      // Capture one actual online homepage before installing deterministic fixture APIs.
      console.log('Checking the live homepage...');
      await visit('/');
      await waitFor('document.querySelectorAll(".tv-ranking-card").length > 0 || document.querySelectorAll(".tv-ranking-error").length === 6', 35000);
      await waitFor('!!document.querySelector(".tv-premiere__pagination") && document.querySelector(".tv-premiere__art img")?.naturalWidth > 0', 12000).catch(() => { report.liveArtworkUnavailableAtCapture = true; });
      await delay(1000);
      await waitFor('document.querySelector(".tv-premiere__art img")?.naturalWidth > 0', 8000).catch(() => {});
      report.realArtwork = await evaluate('(() => { const image = document.querySelector(".tv-premiere__art img"); return image ? { loaded: image.complete && image.naturalWidth > 0, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, renderedWidth: image.clientWidth, renderedHeight: image.clientHeight } : null; })()');
      await capture('home-desktop-live-data');
      report.realHomepageCards = await evaluate('document.querySelectorAll(".tv-ranking-card").length');
      await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: '(' + fixtures.toString() + ')();', runImmediately: true });
      await visit('/');
      await check('Fixture APIs are isolated and active', 'window.__interfaceFixtures === true');
      await waitFor('document.querySelectorAll(".tv-ranking-card").length >= 12');
      await check('Desktop content fits the viewport', fits);
      await check('Exactly one primary navigation item is selected', 'document.querySelectorAll(".tv-sidebar__navigation [aria-current=page]").length === 1');
      await capture('home-desktop-fixtures');
      await evaluate('document.querySelector(".tv-sidebar__navigation [aria-current=page]").focus()');
      await key('ArrowRight');
      await check('Right from the sidebar enters featured content', 'document.activeElement.matches(".tv-premiere__play")');
      await key('ArrowDown');
      await check('Down from featured content enters the first shelf', 'document.activeElement.matches("[data-tv-card]")');
      await evaluate('window.__qaShelf = document.activeElement.closest("[data-tv-shelf]")');
      await key('ArrowDown');
      await check('Down moves to the next content shelf', 'document.activeElement.closest("[data-tv-shelf]") !== window.__qaShelf');
      await key('ArrowUp');
      await check('Up returns to the previous shelf', 'document.activeElement.closest("[data-tv-shelf]") === window.__qaShelf');
      await evaluate('document.querySelector(".tv-rail--featured [data-tv-card]").focus()');
      await key('ArrowLeft');
      await check('Left at the shelf edge returns to the sidebar', 'document.activeElement.matches(".tv-sidebar__navigation [aria-current=page]")');
      await click('.tv-premiere__pagination button:nth-child(2)');
      await check('Featured pagination changes the selected film', 'document.querySelector(".tv-premiere__title").textContent.includes("02")');
      await click('.tv-premiere__play');
      await waitFor('!!document.querySelector(".tv-film-detail")');
      await check('Film details open as an accessible dialog', 'document.querySelector(".tv-film-detail").getAttribute("aria-modal") === "true"');
      await click('.tv-film-detail__save');
      await waitFor('document.querySelector(".tv-film-detail__save").getAttribute("aria-pressed") === "true"');
      await capture('detail-fixtures');
      await key('Escape');
      await waitFor('!document.querySelector(".tv-film-detail")');
      await check('Closing details restores the initiating control', 'document.activeElement.matches(".tv-premiere__play")');
      await click('.tv-sidebar__search');
      await waitFor('!!document.querySelector(".tv-search-dialog input")');
      await check('Search autofocus reaches the input', 'document.activeElement.matches(".tv-search-dialog input")');
      await capture('search-fixtures');
      await key('Escape');
      await check('Closing search restores focus to Search', 'document.activeElement.matches(".tv-sidebar__search")');
      await click('.tv-sidebar__preferences button[aria-label="设置"]');
      await waitFor('!!document.querySelector(".tv-drawer__panel")');
      await capture('settings-fixtures');
      await click('[role="tab"][aria-selected="false"]');
      await key('Escape');
      await waitFor('!document.querySelector(".tv-drawer")');
      await click('.tv-sidebar__navigation a[href="/?view=movies"]');
      await waitFor('document.querySelectorAll(".tv-discovery-card").length > 0');
      await check('Movies navigation displays the catalogue', 'location.search.includes("view=movies")');
      await click('.tv-discovery__all');
      await waitFor('!!document.querySelector(".tv-browse__select")');
      await evaluate('{ const select = document.querySelector("select[aria-label=类型]"); select.value = "科幻"; select.dispatchEvent(new Event("change", { bubbles: true })); }');
      await waitFor('location.search.includes("genre=")');
      await capture('catalogue-fixtures');
      await visit('/?s=' + encodeURIComponent('界面测试影片 01'));
      await waitFor('!!document.querySelector(".tv-poster-card--aggregated")');
      await check('Search results remain functional', 'document.querySelector(".tv-poster-card__title").textContent.includes("界面测试影片")');
      await check('Search does not mark Home as the current navigation page', 'document.querySelectorAll(".tv-sidebar__navigation [aria-current=page]").length === 0');
      await evaluate('sessionStorage.setItem("audit-search-error", "1")');
      await visit('/?s=' + encodeURIComponent('失败路径测试'));
      await waitFor('!!document.querySelector("[role=alert]")');
      await check('Search failure offers retry instead of a false no-results state', 'document.querySelector("main").textContent.includes("搜索未完成") && document.querySelector("main").textContent.includes("重新搜索") && !document.querySelector("main").textContent.includes("没有找到这个故事")');
      await capture('search-error-fixtures');
      await evaluate('sessionStorage.removeItem("audit-search-error"); sessionStorage.setItem("audit-wrong-year", "1")');
      await visit('/');
      await click('.tv-premiere__play');
      await waitFor('!!document.querySelector(".tv-film-detail__play")');
      await check('Unresolved recommendation labels its action as finding sources', 'document.querySelector(".tv-film-detail__play").textContent.includes("查找播放源")');
      await click('.tv-film-detail__play');
      await waitFor('document.querySelector(".tv-detail-playback")?.textContent.includes("尚未找到")');
      await check('Wrong-year remakes are not offered under a catalogue title', '!document.querySelector(".tv-detail-playback__sources") && document.querySelector(".tv-detail-playback").textContent.includes("其他作品")');
      await capture('wrong-year-recovery-fixtures');
      await evaluate('sessionStorage.removeItem("audit-wrong-year")');
      await visit('/');
      await evaluate(`new Promise((resolve, reject) => {
        const request = indexedDB.open('kongwotv');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('history', 'readwrite');
          transaction.objectStore('history').put({ id: 'interface_qa_900001', sourceKey: 'interface_qa', sourceUrl: 'https://example.com/api/vod', vodId: '900001', title: '界面测试影片 01', episodeIndex: 0, totalEpisodes: 1, playbackPosition: 120, duration: 1800, timestamp: Date.now() });
          transaction.oncomplete = () => { database.close(); resolve(true); };
          transaction.onerror = () => reject(transaction.error);
        };
      })`);
      await visit('/?s=' + encodeURIComponent('界面测试影片 01'));
      await click('.tv-poster-card--aggregated .tv-poster-card__trigger');
      await waitFor('!!document.querySelector(".tv-film-detail__play")');
      await waitFor('document.querySelector(".tv-film-detail__play").textContent.includes("继续观看")');
      await check('Details restore the saved playback action', 'document.querySelector(".tv-film-detail__play").textContent.includes("继续观看")');
      await capture('resume-detail-fixtures');
      await click('button[aria-label="播放源设置"]');
      await waitFor('!!document.querySelector(".tv-drawer") && !document.querySelector(".tv-film-detail")');
      await check('Detail-to-settings transition keeps background scrolling locked', 'document.body.style.overflow === "hidden"');
      await key('Escape');
      await waitFor('!document.querySelector(".tv-drawer")');
      await check('Closing the last overlay restores page scrolling', 'document.body.style.overflow !== "hidden"');
      await click('.tv-sidebar__library button[aria-label="观看历史"]');
      await waitFor('!!document.querySelector(".tv-history__toolbar button")');
      await click('.tv-history__toolbar button');
      await waitFor('!!document.querySelector("[role=alertdialog]")');
      await check('Destructive confirmation initially focuses Cancel', 'document.activeElement.textContent === "取消"');
      await evaluate('document.querySelector("[role=alertdialog] button:last-child").focus()');
      await key('Tab');
      await check('Nested confirmation traps Tab within its own controls', 'document.activeElement === document.querySelector("[role=alertdialog] button")');
      await key('Escape');
      await check('Escape closes only the confirmation and restores its trigger', '!document.querySelector("[role=alertdialog]") && !!document.querySelector(".tv-drawer") && document.activeElement.textContent.includes("清空历史")');
      await capture('history-fixtures');
      await click('.tv-history__toolbar button');
      await waitFor('!!document.querySelector("[role=alertdialog]")');
      await evaluate('history.back()');
      await waitFor('!document.querySelector(".tv-drawer")');
      await click('.tv-sidebar__library button[aria-label="观看历史"]');
      await waitFor('!!document.querySelector(".tv-drawer")');
      await check('Reopening history does not resurrect an old delete confirmation', '!document.querySelector("[role=alertdialog]")');
      await key('Escape');
      await waitFor('!document.querySelector(".tv-drawer")');
      await visit('/live');
      await waitFor('!!document.querySelector("[data-channel-list]")');
      await check('Live page keeps its channel browser', fits);
      await capture('live-fixtures');
      await visit('/about');
      await check('About keeps the upstream attribution', 'Array.from(document.querySelectorAll("a")).some((el) => el.textContent.includes("查看上游源码与署名"))');
      await capture('about-fixtures');
      for (const [name, width, height] of [['tablet', 834, 1112], ['phone', 390, 844], ['small-phone', 320, 740], ['television', 1920, 1080]]) {
        window.setContentSize(width, height);
        await visit('/');
        await waitFor('document.querySelectorAll(".tv-ranking-card").length >= 12');
        await check(name + ' content fits without horizontal overflow', fits);
        if (width < 768) {
          await check(name + ' navigation uses the touch tab bar', 'getComputedStyle(document.querySelector(".tv-sidebar__navigation")).position === "fixed"');
          await check(name + ' tab bar stays at the screen bottom', 'document.querySelector(".tv-sidebar__navigation").getBoundingClientRect().bottom > innerHeight - 35');
        }
        await capture('home-' + name + '-fixtures');
        if (name === 'phone') {
          await click('.tv-premiere__play');
          await waitFor('!!document.querySelector(".tv-film-detail")');
          await check('Phone film details fit the screen', fits);
          await capture('detail-phone-fixtures');
          await key('Escape');
          await click('.tv-sidebar__mobile-tools > button[aria-label="设置"]');
          await waitFor('!!document.querySelector(".tv-drawer")');
          await check('Phone settings fit the screen', fits);
          await capture('settings-phone-fixtures');
          await key('Escape');
          await waitFor('!document.querySelector(".tv-drawer")');
          await click('.tv-mobile-more summary');
          await click('.tv-mobile-more__menu > button');
          await waitFor('!!document.querySelector("[role=dialog][aria-label=下载管理]")');
          await check('Phone keeps access to downloads', fits);
          await key('Escape');
          await waitFor('!document.querySelector(".tv-drawer")');
          await click('.tv-mobile-more summary');
        }
      }
      await evaluate('localStorage.setItem("kongwotv-theme", "light")');
      window.setContentSize(1440, 1000);
      await visit('/');
      await waitFor('document.querySelectorAll(".tv-ranking-card").length >= 12');
      await check('Existing light appearance preference remains supported', '!document.documentElement.classList.contains("dark")');
      await capture('home-light-fixtures');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await check('Reduced motion disables artwork animation', 'parseFloat(getComputedStyle(document.querySelector(".tv-premiere__art")).animationDuration) < 0.001');
      await check('No uncaught page errors', 'true');
      assert.equal(report.errors.length, 0, report.errors.join('\n'));
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.failure = error.stack;
      console.error(error.stack);
      if (window && !window.isDestroyed()) {
        report.diagnostic = await evaluate('({ ready: document.readyState, visibility: document.visibilityState, resources: performance.getEntriesByType("resource").map((entry) => ({ path: new URL(entry.name).pathname, status: entry.responseStatus, duration: Math.round(entry.duration) })) })').catch(() => null);
        await capture('failure').catch(() => {});
      }
    } finally {
      fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`UI verification: ${report.checks.length} checks; evidence: ${output}`);
      app.exit(report.passed ? 0 : 1);
    }
  });
}
