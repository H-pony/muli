'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
const { chromium } = require(process.env.KONGWOTV_PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.KONGWOTV_TEST_BASE_URL || 'http://127.0.0.1:8080';
const output = path.join(root, 'artifacts', 'brand-release');
fs.mkdirSync(output, { recursive: true });
const report = { baseURL, checks: [], errors: [], screenshots: [] };
function check(name, value) {
  assert.ok(value, name);
  report.checks.push({ name, passed: true });
  console.log('PASS ' + name);
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.KONGWOTV_TEST_BROWSER ? { executablePath: process.env.KONGWOTV_TEST_BROWSER } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const auth = await context.request.post(baseURL + '/api/auth', { data: { password: process.env.PASSWORD } });
    check('Existing production endpoint accepts authentication', auth.ok());
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.route('**/__brand_seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><title>Seed</title></html>' }));
    await page.goto(baseURL + '/__brand_seed');
    await page.evaluate(async () => {
      localStorage.setItem('libretv-theme', 'light');
      localStorage.setItem('libretv-settings', JSON.stringify({ version: 2, state: {
        customAPIs: [{ key: 'brand_legacy', name: '更名前保存的点播源', url: 'https://360zy.com/api.php/provide/vod' }],
        selectedKeys: ['brand_legacy'], autoplayNext: false,
      } }));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('libretv', 10);
        request.onupgradeneeded = () => {
          const history = request.result.createObjectStore('history', { keyPath: 'id' });
          history.createIndex('timestamp', 'timestamp');
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('history', 'readwrite');
          transaction.objectStore('history').put({ id: 'brand_legacy_42', sourceKey: 'brand_legacy', vodId: '42', title: '更名前的观看记录', episodeIndex: 1, totalEpisodes: 3, playbackPosition: 123, duration: 1000, timestamp: Date.now() });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '幕里 首页', exact: true }).waitFor();
    await page.getByText('更名前的观看记录', { exact: true }).first().waitFor({ timeout: 20000 });
    check('Production page uses the new application title', (await page.title()).startsWith('幕里'));
    check('No previous brand is visible in page text', !/LibreTV/i.test(await page.locator('body').innerText()));
    check('Original viewing history appears in Continue Watching', await page.getByText('更名前的观看记录', { exact: true }).first().isVisible());
    const preferences = await page.evaluate(() => ({ theme: localStorage.getItem('kongwotv-theme'), saved: JSON.parse(localStorage.getItem('kongwotv-settings') || '{}') }));
    check('Original theme is migrated before first paint', preferences.theme === 'light' && !await page.locator('html').evaluate((el) => el.classList.contains('dark')));
    check('Original playback preference survives new storage key', preferences.saved.state?.autoplayNext === false);
    const manifest = await (await context.request.get(baseURL + '/manifest.webmanifest')).json();
    check('PWA install name and short name use 幕里', manifest.name === '幕里' && manifest.short_name === '幕里' && manifest.scope === '/');
    const icon = await context.request.get(baseURL + '/icons/icon-512.png');
    check('Branded PNG icon is served', icon.ok() && icon.headers()['content-type'].includes('image/png'));
    await page.screenshot({ path: path.join(output, '幕里-Web-桌面.png'), fullPage: false });
    report.screenshots.push('幕里-Web-桌面.png');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '数据', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出配置', exact: true }).click(),
    ]);
    check('Configuration download uses new branded filename', download.suggestedFilename().startsWith('幕里-Settings_'));
    const config = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    check('Configuration export contains new schema name and retained history', config.name === '幕里-Settings' && JSON.parse(config.data.viewingHistory).some((entry) => entry.title === '更名前的观看记录'));
    await page.goto(baseURL + '/about', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '关于 幕里' }).waitFor();
    check('About page retains upstream attribution with the new product name', await page.getByRole('link', { name: '查看上游源码与署名' }).isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '幕里 首页', exact: true }).waitFor();
    check('Mobile viewport fits without horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, '幕里-Web-手机.png'), fullPage: false });
    report.screenshots.push('幕里-Web-手机.png');
    check('No runtime page exceptions during brand and migration checks', report.errors.length === 0);
    await context.close();
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  }
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
