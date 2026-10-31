'use strict';

const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const APP_NAME = '幕里';
const PLAYER_TEST_DIR = process.env.KONGWOTV_PLAYER_TEST_OUTPUT;
const PORT = PLAYER_TEST_DIR ? 17888 : 17886;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// Keep the existing Chromium partition so playback history, cookies and settings survive the rebrand.
const PARTITION = 'persist:kongwotv';
const DESKTOP_DIR = __dirname;
const SELF_TEST_DIR = process.env.KONGWOTV_SELF_TEST_OUTPUT;
let server;
let window;
let serverReady = false;
let windowCreation;
let quitting = false;
let lastServerOutput = '';
let privatePassword = '';
let proxySecret = '';

app.setName(APP_NAME);
// HTTP header values must be ASCII even though the visible product name is Chinese.
app.userAgentFallback = app.userAgentFallback.replace(/幕里|空我TV/g, 'Muli').replace(/[^\x20-\x7E]/g, '');
// The visible name and package name may change; the existing on-disk profile must not.
app.setPath('userData', PLAYER_TEST_DIR ? path.resolve(PLAYER_TEST_DIR, 'profile') : path.join(app.getPath('appData'), 'kongwotv'));
app.setAppUserModelId('tv.kongwo.desktop');

function resourcesPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(DESKTOP_DIR, '.staging', name);
}

function sanitize(text) {
  let result = String(text);
  for (const secret of [privatePassword, proxySecret]) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return result;
}

function appendServerOutput(data) {
  lastServerOutput = (lastServerOutput + sanitize(data.toString())).slice(-6000);
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => reject(new Error(error.code === 'EADDRINUSE'
      ? `本地端口 ${PORT} 已被其他程序占用。请关闭占用此端口的程序，然后重新打开幕里。`
      : `无法使用本地端口 ${PORT}：${error.message}`)));
    probe.listen({ host: '127.0.0.1', port: PORT, exclusive: true }, () => probe.close(resolve));
  });
}

function serverEnvironment(sources) {
  // Copy only operating-system context. Never inherit deployment secrets or Node loaders.
  const names = [
    'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'HOME', 'USERPROFILE', 'USER', 'LOGNAME', 'APPDATA', 'LOCALAPPDATA',
    'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
    'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  ];
  const env = {};
  for (const name of names) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  privatePassword = '';
  proxySecret = crypto.randomBytes(32).toString('hex');
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    HOSTNAME: '127.0.0.1',
    PORT: String(PORT),
    PASSWORD: privatePassword,
    PROXY_SECRET: proxySecret,
    COOKIE_SECURE: 'false',
    DEFAULT_SOURCES: JSON.stringify(sources.vodSources || []),
    DEFAULT_LIVE_SOURCES: sources.bundledLive ? '' : JSON.stringify(sources.liveSubscriptions || []),
  };
}

async function waitForServer() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (!server || server.exitCode !== null) {
      throw new Error(`内置服务意外退出。\n${lastServerOutput}`);
    }
    try {
      const response = await fetch(`${ORIGIN}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && typeof (await response.json()).passwordRequired === 'boolean') return;
    } catch { /* The local server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`内置服务启动超过 60 秒。\n${lastServerOutput}`);
}

async function startServer() {
  const serverRoot = resourcesPath('server');
  if (!fs.existsSync(path.join(serverRoot, 'server.js'))) {
    throw new Error('未找到内置服务。开发环境请先运行 npm run prepare:server；发行安装包请重新安装。');
  }
  const sources = JSON.parse(fs.readFileSync(resourcesPath('sources.json'), 'utf8'));
  await assertPortAvailable();
  server = spawn(process.execPath, [path.join(DESKTOP_DIR, 'server-entry.cjs'), serverRoot], {
    cwd: app.getPath('userData'),
    env: serverEnvironment(sources),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  server.stdout.on('data', appendServerOutput);
  server.stderr.on('data', appendServerOutput);
  server.once('error', (error) => { lastServerOutput += sanitize(error.message); });
  server.once('exit', (code) => {
    serverReady = false;
    if (!quitting && window) {
      dialog.showErrorBox(APP_NAME, `内置服务已停止（退出码 ${code ?? '未知'}）。请重新打开应用。\n${lastServerOutput}`);
      app.quit();
    }
  });
  await waitForServer();
  serverReady = true;
}

async function login(browserSession) {
  if (!privatePassword) return;
  const response = await fetch(`${ORIGIN}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ password: privatePassword }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !(await response.json()).success) {
    throw new Error('无法为内置服务建立私有登录会话。请重新打开应用。');
  }
  const setCookies = response.headers.getSetCookie();
  if (!setCookies.length) throw new Error('内置服务没有返回登录 Cookie。');
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(';');
    const equal = pair.indexOf('=');
    if (equal < 1) continue;
    const cookie = {
      url: ORIGIN,
      name: pair.slice(0, equal).trim(),
      value: pair.slice(equal + 1).trim(),
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    };
    for (const attribute of attributes) {
      const [key, value] = attribute.trim().split('=');
      if (key.toLowerCase() === 'max-age') cookie.expirationDate = Date.now() / 1000 + Number(value);
    }
    await browserSession.cookies.set(cookie);
  }
  await browserSession.cookies.flushStore();
}

function openExternal(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch { /* Ignore unsupported URLs. */ }
}

function configureMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        { label: `关于${APP_NAME}`, click: () => dialog.showMessageBox({
          type: 'info', title: APP_NAME,
          message: `${APP_NAME} ${app.getVersion()}`,
          detail: '内置本地服务的独立桌面客户端。\n浏览记录和设置仅保存在当前设备。\nAGPL-3.0-or-later',
        }) },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [
      { label: '返回首页', click: () => window?.loadURL(ORIGIN) },
      { label: '刷新', accelerator: 'CmdOrCtrl+R', click: async () => {
        if (window) { await login(window.webContents.session); window.reload(); }
      } },
      { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'toggleDevTools' },
    ] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
}

async function createWindow() {
  if (quitting || !serverReady) return;
  if (windowCreation) return windowCreation;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  // activate and startup can arrive together, including while loadURL is pending.
  windowCreation = createWindowWhenReady().finally(() => { windowCreation = undefined; });
  return windowCreation;
}

async function createWindowWhenReady() {
  const browserSession = session.fromPartition(PARTITION);
  browserSession.setUserAgent(app.userAgentFallback);
  const isAppOrigin = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'fullscreen' && isAppOrigin(contents.getURL()) && isAppOrigin(details.requestingUrl || contents.getURL()));
  });
  browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    permission === 'fullscreen' && isAppOrigin(requestingOrigin) && !!contents && isAppOrigin(contents.getURL()));
  await login(browserSession);
  window = new BrowserWindow({
    title: APP_NAME,
    width: 1440, height: 960, minWidth: 960, minHeight: 640,
    show: false,
    backgroundColor: '#08090b',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(DESKTOP_DIR, 'build', 'icon-512.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== ORIGIN) { event.preventDefault(); openExternal(url); }
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  await window.loadURL(ORIGIN);
  if (PLAYER_TEST_DIR) {
    fs.mkdirSync(PLAYER_TEST_DIR, { recursive: true });
    const { runPlayerSelfTest } = require('./player-self-test.cjs');
    const result = await runPlayerSelfTest({ app, window, origin: ORIGIN, output: PLAYER_TEST_DIR, fixtures: process.env.KONGWOTV_PLAYER_FIXTURE_DIR });
    fs.writeFileSync(path.join(PLAYER_TEST_DIR, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    app.exitCode = result.passed ? 0 : 1;
    app.quit();
  } else if (SELF_TEST_DIR) await runSelfTest();
}

function handleStartupFailure(error) {
  if (quitting) return;
  const message = sanitize(error.stack || error.message);
  const testDirectory = PLAYER_TEST_DIR || SELF_TEST_DIR;
  if (testDirectory) {
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(path.join(testDirectory, 'result.json'), JSON.stringify({ passed: false, error: message }, null, 2));
  } else {
    dialog.showErrorBox(APP_NAME, message);
  }
  app.exitCode = 1;
  app.quit();
}

async function runSelfTest() {
  fs.mkdirSync(SELF_TEST_DIR, { recursive: true });
  const result = {
    appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, node: process.versions.node,
    packaged: app.isPackaged, origin: ORIGIN,
    appName: app.getName(), windowTitle: window.getTitle(),
    userDataDirectory: path.basename(app.getPath('userData')), sessionPartition: PARTITION,
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    Object.assign(result, await window.webContents.executeJavaScript(`(async () => {
      const status = await (await fetch('/api/status')).json();
      const auth = await (await fetch('/api/auth')).json();
      const source = await fetch('/api/source-list');
      const ssrf = await fetch('/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:9/'));
      const previousPersistenceMarker = localStorage.getItem('kongwotv.desktop.selftestMarker');
      localStorage.setItem('kongwotv.desktop.selftestMarker', 'v1');
      let searchProbe;
      try {
        const response = await fetch('/api/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wd: '三体', sources: status.defaultSources, filterAdult: true }),
          signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json();
        searchProbe = { status: response.status, results: payload.list?.length || 0, failures: payload.failures || [] };
      } catch (error) {
        searchProbe = { error: error.message };
      }
      return {
        title: document.title,
        verified: status.verified === true && auth.verified === true,
        passwordRequired: status.passwordRequired,
        defaultSourceCount: status.defaultSources.length,
        defaultLiveSourceCount: status.defaultLiveSources.length,
        sourceListRouteStatus: source.status,
        privateProxyTargetStatus: ssrf.status,
        persistedFromPreviousRun: previousPersistenceMarker === 'v1',
        searchProbe,
        noLoginDialog: !document.querySelector('input[type="password"]'),
        browserNodeDisabled: typeof require === 'undefined' && typeof process === 'undefined',
        userAgent: navigator.userAgent,
        asciiUserAgent: /^[\\x20-\\x7E]+$/.test(navigator.userAgent),
        renderedBodyLength: document.body.innerText.length,
      };
    })()`));
    const unauthorized = await fetch(`${ORIGIN}/api/source-list`, {
      headers: { Connection: 'close' }, signal: AbortSignal.timeout(15000),
    });
    result.unauthenticatedApiStatus = unauthorized.status;
    result.passed = result.appName === APP_NAME && result.windowTitle.includes(APP_NAME)
      && result.userDataDirectory === 'kongwotv' && result.sessionPartition === 'persist:kongwotv'
      && result.title.includes(APP_NAME) && result.verified && result.noLoginDialog
      && result.passwordRequired === false
      && result.browserNodeDisabled && result.asciiUserAgent && result.defaultSourceCount > 0
      && result.sourceListRouteStatus === 400 && result.privateProxyTargetStatus === 400
      && result.unauthenticatedApiStatus === 400;
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(SELF_TEST_DIR, 'desktop.png'), screenshot.toPNG());
  } catch (error) {
    result.passed = false;
    result.error = sanitize(error.stack || error.message);
  }
  fs.writeFileSync(path.join(SELF_TEST_DIR, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  app.exitCode = result.passed ? 0 : 1;
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void createWindow().catch(handleStartupFailure);
  });
  app.whenReady().then(async () => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    configureMenu();
    await startServer();
    await createWindow();
  }).catch(handleStartupFailure);
  app.on('activate', () => { void createWindow().catch(handleStartupFailure); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    if (server && server.exitCode === null) {
      event.preventDefault();
      const force = setTimeout(() => { server.kill('SIGKILL'); app.exit(app.exitCode || 0); }, 4000);
      server.once('exit', () => { clearTimeout(force); app.exit(app.exitCode || 0); });
      server.kill('SIGTERM');
    }
  });
}
