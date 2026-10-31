'use strict';

// Runs the real main-process entry point against in-memory Electron/OS mocks.
// No application, browser profile, local server, network request or child process is started.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const entryPath = path.resolve(__dirname, '../main.cjs');
const entry = fs.readFileSync(entryPath, 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check) {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Lifecycle did not settle as expected');
}

function harness() {
  const ready = deferred();
  const loads = [];
  const windows = [];
  const errors = [];
  const exits = [];
  const kills = [];
  const server = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null,
    kill(signal) {
      kills.push(signal);
      this.exitCode = 0;
      this.emit('exit', 0);
    },
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, userAgentFallback: 'MockElectron', exitCode: 0,
    setName() {}, setPath() {}, setAppUserModelId() {},
    getPath: () => '/mock/profile',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() { this.emit('before-quit', { preventDefault() {} }); },
    exit(code) { exits.push(code); },
  });
  const browserSession = {
    setUserAgent() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
  };
  class MockWindow extends EventEmitter {
    constructor() {
      super();
      this.focusCount = 0;
      this.showCount = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        session: browserSession, setWindowOpenHandler() {},
      });
      windows.push(this);
    }
    loadURL() {
      const load = deferred();
      loads.push(load);
      return load.promise.then(() => this.emit('ready-to-show'));
    }
    show() { this.showCount += 1; }
    focus() { this.focusCount += 1; }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    restore() {}
  }
  let fetchCount = 0;
  const mocks = {
    electron: {
      app, BrowserWindow: MockWindow,
      Menu: { setApplicationMenu() {}, buildFromTemplate: (value) => value },
      dialog: { showErrorBox: (_title, message) => errors.push(message), showMessageBox() {} },
      session: { fromPartition: () => browserSession }, shell: { openExternal() {} },
    },
    'node:child_process': { spawn: () => server },
    'node:crypto': { randomBytes: () => ({ toString: () => 'mock-ephemeral-token' }) },
    'node:fs': { existsSync: () => true, readFileSync: () => '{"vodSources":[],"liveSubscriptions":[]}', mkdirSync() {}, writeFileSync() {} },
    'node:net': { createServer: () => Object.assign(new EventEmitter(), {
      listen(_options, callback) { callback(); }, close(callback) { callback(); },
    }) },
    'node:path': path,
  };
  vm.runInNewContext(entry, {
    require(name) { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; },
    __dirname: path.dirname(entryPath),
    process: { env: {}, platform: 'darwin', execPath: '/mock/electron' },
    fetch: () => { fetchCount += 1; return ready.promise; },
    AbortSignal, URL, setTimeout, clearTimeout,
  }, { filename: entryPath });
  return {
    app, windows, loads, errors, exits, kills,
    fetchCount: () => fetchCount,
    becomeReady: () => ready.resolve({ ok: true, json: async () => ({ passwordRequired: false }) }),
  };
}

test('activate before server readiness cannot create a window', async (t) => {
  const h = harness();
  t.after(() => h.app.quit());
  await until(() => h.fetchCount() === 1);
  h.app.emit('activate');
  h.app.emit('second-instance');
  await new Promise(setImmediate);
  assert.equal(h.windows.length, 0);
  h.becomeReady();
  await until(() => h.loads.length === 1);
  h.loads[0].resolve();
  await until(() => h.windows[0].showCount === 1);
  assert.equal(h.windows.length, 1);
  assert.deepEqual(h.errors, []);
});

test('concurrent activate and second-instance events share one pending window', async (t) => {
  const h = harness();
  t.after(() => h.app.quit());
  await until(() => h.fetchCount() === 1);
  h.becomeReady();
  await until(() => h.loads.length === 1);
  for (let i = 0; i < 5; i += 1) {
    h.app.emit('activate');
    h.app.emit('second-instance');
  }
  await new Promise(setImmediate);
  assert.equal(h.windows.length, 1);
  h.loads[0].resolve();
  await until(() => h.windows[0].showCount === 1);
  await new Promise(setImmediate);
  h.app.emit('activate');
  await until(() => h.windows[0].focusCount > 0);
  assert.equal(h.windows.length, 1);
});

test('a window creation failure shared with activate is reported once and stops the server', async () => {
  const h = harness();
  await until(() => h.fetchCount() === 1);
  h.becomeReady();
  await until(() => h.loads.length === 1);
  h.app.emit('activate');
  h.app.emit('activate');
  h.loads[0].reject(new Error('mock loadURL failure'));
  await until(() => h.exits.length === 1);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /mock loadURL failure/);
  assert.deepEqual(h.exits, [1]);
  assert.deepEqual(h.kills, ['SIGTERM']);
  h.app.emit('activate');
  await new Promise(setImmediate);
  assert.equal(h.windows.length, 1);
});
