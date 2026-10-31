'use strict';

// Invoke with the project's normal Node. The child is Electron and runs its own
// bundled server; --without-host-node verifies that its PATH contains no Node.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { spawn, spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const repository = path.resolve(desktop, '..');
const MAC_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const { RENDERER_CHECKS, OS_CHECK_REASONS } = require('../player-self-test.cjs');

function argumentsOf(argv) {
  const result = { withoutHostNode: false, launchServices: false, rendererOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--without-host-node') { result.withoutHostNode = true; continue; }
    if (flag === '--renderer-only') { result.rendererOnly = true; continue; }
    if (flag === '--launch-services') { result.launchServices = true; continue; }
    if (flag === '--app' || flag === '--output') {
      const value = argv[++i];
      if (!value || value.startsWith('--') || !path.isAbsolute(value)) throw new Error(`${flag} requires an absolute path.`);
      result[flag.slice(2)] = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  return result;
}

function resultAccepted(result, options, code, viaLaunchServices = false) {
  if (!options.rendererOnly) return code === 0 && result.passed === true;
  const osNames = Object.keys(OS_CHECK_REASONS);
  return code === (viaLaunchServices ? 0 : 1)
    && result.scope === 'renderer-only' && result.inputMode === 'injected-renderer' && result.rendererPassed === true
    && result.passed === false && result.fullAcceptancePassed === false && result.expectedAppExitCode === 1
    && !result.error && !(result.errors?.length) && !(result.interception?.errors?.length)
    && Array.isArray(result.checks) && result.checks.length === RENDERER_CHECKS.length && result.checks.every((item) => item.passed === true)
    && RENDERER_CHECKS.every((name) => result.checks.some((item) => item.name === name && item.passed === true))
    && Array.isArray(result.skippedChecks) && result.skippedChecks.length === osNames.length
    && osNames.every((name) => result.skippedChecks.includes(name) && typeof result.skippedCheckReasons?.[name] === 'string' && result.skippedCheckReasons[name].length > 0);
}

function reportScope(result, options, code, viaLaunchServices = false) {
  if (!options.rendererOnly) return;
  console.log(`[player-qa] RENDERER-ONLY: rendererPassed=${result.rendererPassed === true}; passed=${result.passed}; fullAcceptancePassed=${result.fullAcceptancePassed}.`);
  console.log('[player-qa] Injected renderer inputs under locked console; OS/document foreground focus not certified.');
  console.log(`[player-qa] OS ACCEPTANCE NOT PERFORMED: ${Object.keys(OS_CHECK_REASONS).join(', ')}.`);
  console.log(`[player-qa] ${viaLaunchServices ? 'open exit' : 'App exit'}=${code}; expected=${viaLaunchServices ? 0 : 1}. Frozen main normally exits 1 because full passed remains false. Original result.json is unchanged.`);
}

function launchServicesTarget(explicitApp) {
  if (process.platform !== 'darwin') throw new Error('--launch-services is only available on macOS.');
  if (!explicitApp) throw new Error('--launch-services requires an explicit --app executable or .app bundle.');
  const selected = fs.realpathSync(explicitApp);
  let bundle = fs.statSync(selected).isDirectory() ? selected : path.dirname(selected);
  while (!bundle.toLowerCase().endsWith('.app') && path.dirname(bundle) !== bundle) bundle = path.dirname(bundle);
  if (!bundle.toLowerCase().endsWith('.app')) throw new Error('--app is not inside an explicit .app bundle.');
  const executableName = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 5000 });
  if (executableName.error || executableName.status !== 0) throw new Error('Could not read the selected .app CFBundleExecutable.');
  const name = executableName.stdout.trim();
  if (!name || name.includes('/') || name.includes('\\')) throw new Error('Invalid .app CFBundleExecutable.');
  const executable = fs.realpathSync(path.join(bundle, 'Contents', 'MacOS', name));
  if (!fs.statSync(executable).isFile() || (fs.statSync(selected).isFile() && selected !== executable)) throw new Error('--app does not match the selected bundle main executable.');
  if (!fs.statSync(path.join(bundle, 'Contents', 'Resources', 'app.asar')).isFile()) throw new Error('LaunchServices QA requires the packaged application with its own app.asar.');
  // --help is intentionally rejected by this macOS open, which then prints the
  // complete supported usage. Inspect that text; this probe opens no app or file.
  const help = spawnSync('/usr/bin/open', ['--help'], { encoding: 'utf8', timeout: 5000 });
  const usage = `${help.stdout || ''}\n${help.stderr || ''}`;
  const capabilities = Object.fromEntries(['--env', '--stdout', '--stderr', '--wait-apps', '--new'].map((flag) => [flag, usage.includes(flag)]));
  if (help.error || Object.values(capabilities).some((supported) => !supported)) throw new Error('This macOS open does not advertise the required environment, log and wait options.');
  return { bundle, executable, capabilities, usageExitCode: help.status };
}

function hasEnvironment(raw, key, value) {
  const needle = `${key}=${value}`;
  for (let at = raw.indexOf(needle); at !== -1; at = raw.indexOf(needle, at + 1)) {
    const before = at === 0 || /\s/.test(raw[at - 1]);
    const after = raw.slice(at + needle.length);
    if (before && (/^\s*$/.test(after) || /^\s+[A-Za-z_][A-Za-z0-9_]*=/.test(after))) return true;
  }
  return false;
}

function inspectApp(pid, expected) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return null;
  const comm = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 1500 });
  if (comm.error || comm.status !== 0 || !path.isAbsolute(comm.stdout.trim())) return null;
  let executable;
  try { executable = fs.realpathSync(comm.stdout.trim()); } catch { return null; }
  if (executable !== expected.executable) return null;
  const probe = spawnSync('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 1500, maxBuffer: 2 * 1024 * 1024 });
  if (probe.error || probe.status !== 0) return null;
  // Never log the process environment. Persist only proof for our own QA values.
  const raw = probe.stdout;
  const proof = {
    token: hasEnvironment(raw, 'KONGWOTV_PLAYER_QA_TOKEN', expected.token),
    output: hasEnvironment(raw, 'KONGWOTV_PLAYER_TEST_OUTPUT', expected.output),
    fixtures: hasEnvironment(raw, 'KONGWOTV_PLAYER_FIXTURE_DIR', expected.fixtures),
    path: hasEnvironment(raw, 'PATH', MAC_PATH),
    scope: !expected.scope || hasEnvironment(raw, 'KONGWOTV_PLAYER_TEST_SCOPE', expected.scope),
  };
  if (!proof.token || !proof.output || hasEnvironment(raw, 'ELECTRON_RUN_AS_NODE', '1')) return null;
  return { pid, executable, output: expected.output, proof, argumentMarkerSeen: raw.includes(expected.argument), checkedAt: new Date().toISOString() };
}

function findOwnedApps(expected) {
  const listing = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  if (listing.error || listing.status !== 0) throw new Error('Cannot inspect QA application process identities safely.');
  const matches = [];
  for (const line of listing.stdout.split('\n')) {
    const item = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!item || !item[2].endsWith(`${path.sep}${path.basename(expected.executable)}`)) continue;
    const identity = inspectApp(Number(item[1]), expected);
    if (identity) matches.push(identity);
  }
  return matches;
}

function logTail(filename) {
  if (!fs.existsSync(filename)) return '';
  const fd = fs.openSync(filename, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, 6000));
    fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.toString();
  } finally { fs.closeSync(fd); }
}

async function runLaunchServices({ selection, output, fixtures, env, options }) {
  const token = crypto.randomBytes(24).toString('hex');
  const argument = `--kongwotv-player-qa=${token}`;
  const expected = { ...selection, output, fixtures, token, argument, scope: env.KONGWOTV_PLAYER_TEST_SCOPE };
  const appStdout = path.join(output, 'electron.stdout.log');
  const appStderr = path.join(output, 'electron.stderr.log');
  for (const filename of [appStdout, appStderr]) fs.writeFileSync(filename, '');
  const launchPath = path.join(output, 'launch-services.json');
  const launch = { mode: 'launch-services', ...expected, path: MAC_PATH, environmentVerified: false, applications: [], signals: [] };
  const save = () => fs.writeFileSync(launchPath, JSON.stringify(launch, null, 2) + '\n');
  save();
  const explicit = {
    KONGWOTV_PLAYER_TEST_OUTPUT: output, KONGWOTV_PLAYER_FIXTURE_DIR: fixtures,
    KONGWOTV_PLAYER_QA_TOKEN: token, KONGWOTV_PLAYER_TEST_SCOPE: env.KONGWOTV_PLAYER_TEST_SCOPE, PATH: MAC_PATH,
    NODE_OPTIONS: '', NODE_PATH: '', KONGWOTV_SELF_TEST_OUTPUT: '',
  };
  const argv = ['-n', '-W', '-a', selection.bundle, '--stdout', appStdout, '--stderr', appStderr];
  for (const [name, value] of Object.entries(explicit)) argv.push('--env', `${name}=${value}`);
  argv.push('--args', argument);
  const launchedAt = Date.now();
  launch.launchedAt = new Date(launchedAt).toISOString();
  const openOut = fs.createWriteStream(path.join(output, 'open.stdout.log'));
  const openErr = fs.createWriteStream(path.join(output, 'open.stderr.log'));
  const child = spawn('/usr/bin/open', argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  launch.openPid = child.pid; save();
  child.stdout.pipe(openOut); child.stderr.pipe(openErr);
  let timedOut = false;
  let interrupted;
  let cleanupPromise;
  let monitorStopped = false;
  let monitorError;

  const terminateOwned = (identity, signal) => {
    // Re-query immediately before every signal: a cached PID alone is never safe.
    const current = inspectApp(identity.pid, expected);
    if (!current) return false;
    try { process.kill(current.pid, signal); }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    launch.signals.push({ ...current, signal, reason: launch.abortReason }); save();
    return true;
  };
  const stop = (reason) => {
    if (cleanupPromise) return cleanupPromise;
    launch.abortReason = reason;
    cleanupPromise = (async () => {
      // open is our own child, but the app is owned by LaunchServices. Stop the
      // waiter, then discover and verify only the uniquely marked real app.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const termSent = new Set();
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const apps = findOwnedApps(expected);
        if (termSent.size && apps.length === 0) break;
        for (const identity of apps) {
          if (!termSent.has(identity.pid) && terminateOwned(identity, 'SIGTERM')) termSent.add(identity.pid);
        }
        await delay(160);
      }
      for (const identity of findOwnedApps(expected)) terminateOwned(identity, 'SIGKILL');
      launch.remainingVerifiedPids = findOwnedApps(expected).map((item) => item.pid);
      launch.cleanupStatus = launch.remainingVerifiedPids.length ? 'verified_app_still_present' : termSent.size ? 'verified_app_terminated' : 'no_verified_target';
      launch.cleanupComplete = termSent.size > 0 && launch.remainingVerifiedPids.length === 0; save();
    })().catch((error) => { launch.cleanupError = error.message; save(); });
    return cleanupPromise;
  };
  for (const stream of [openOut, openErr]) stream.on('error', (error) => { monitorError = `Launcher log failed: ${error.message}`; void stop(monitorError); });
  const monitor = (async () => {
    while (!monitorStopped) {
      try {
        const matches = findOwnedApps(expected);
        for (const identity of matches) {
          const previous = launch.applications.findIndex((item) => item.pid === identity.pid);
          if (previous >= 0) launch.applications[previous] = identity; else launch.applications.push(identity);
          if (identity.proof.path && identity.proof.fixtures && identity.proof.scope) launch.environmentVerified = true;
          else { monitorError = 'The real application did not inherit the exact QA scope, fixture directory and reduced PATH.'; void stop(monitorError); }
        }
        if (matches.length) save();
      } catch (error) { monitorError = error.message; void stop(monitorError); }
      await delay(300);
    }
  })();
  const timer = setTimeout(() => { timedOut = true; void stop('LaunchServices player QA exceeded 270 seconds'); }, 270000);
  const onInterrupt = () => { interrupted = 'SIGINT'; void stop('driver received SIGINT'); };
  const onTerminate = () => { interrupted = 'SIGTERM'; void stop('driver received SIGTERM'); };
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
  let code;
  try {
    code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0) await stop(`open exited with ${code}`);
  } catch (error) {
    await stop(`open failed: ${error.message}`); throw error;
  } finally {
    clearTimeout(timer); monitorStopped = true; await monitor;
    if (cleanupPromise) await cleanupPromise;
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    await Promise.all([openOut, openErr].map((stream) => {
      if (stream.writableFinished || stream.destroyed) return Promise.resolve();
      return new Promise((resolve) => {
        stream.once('finish', resolve); stream.once('close', resolve); stream.once('error', resolve);
        if (!stream.writableEnded) stream.end();
      });
    }));
    launch.openExitCode = code; launch.finishedAt = new Date().toISOString(); save();
  }
  const resultPath = path.join(output, 'result.json');
  if (timedOut || interrupted || monitorError) throw new Error(`LaunchServices QA aborted: ${interrupted || monitorError || 'timeout'}. See ${launchPath}.`);
  if (!fs.existsSync(resultPath) || fs.statSync(resultPath).mtimeMs < launchedAt) {
    await stop('open completed without a fresh application result');
    throw new Error(`open exited (${code}) without a fresh application result.json.\n${logTail(appStdout)}\n${logTail(appStderr)}`);
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  console.log(JSON.stringify(result, null, 2));
  console.log(`LaunchServices player QA evidence: ${output}`);
  if (!launch.environmentVerified) {
    await stop('application environment could not be positively verified');
    throw new Error(`The application result exists but its exact PID/executable/QA environment could not be verified; no pass is claimed. See ${launchPath}.`);
  }
  // Only the app's own fresh result proves playback. open returning zero does not.
  launch.applicationResult = { scope: result.scope, passed: result.passed, rendererPassed: result.rendererPassed, fullAcceptancePassed: result.fullAcceptancePassed, expectedAppExitCode: result.expectedAppExitCode, actualAppExitCode: null };
  save(); reportScope(result, options, code, true);
  if (options.rendererOnly && findOwnedApps(expected).length) { await stop('open returned while the renderer QA App was still running'); throw new Error('The tagged QA App did not finish normally.'); }
  if (!resultAccepted(result, options, code, true)) process.exitCode = 1;
}

async function main() {
  const options = argumentsOf(process.argv.slice(2));
  const selection = options.launchServices ? launchServicesTarget(options.app) : null;
  const target = selection?.executable || options.app || require(path.join(desktop, 'node_modules', 'electron'));
  if (typeof target !== 'string' || !fs.statSync(target).isFile()) throw new Error('--app must identify the actual Electron executable, not an .app directory.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = options.output || path.join(desktop, 'player-self-test-results', `${process.platform}-${process.arch}-${stamp}`);
  if (options.launchServices && /[\r\n]/.test(output)) throw new Error('LaunchServices output paths must not contain line breaks.');
  fs.mkdirSync(output, { recursive: true });
  // A fresh directory prevents stale segments from a previous fixture run.
  const fixtures = fs.mkdtempSync(path.join(output, 'hls-fixture-'));
  const input = path.join(repository, 'android-tv', 'app', 'src', 'androidTest', 'assets', 'smoke.mp4');
  const ffmpeg = process.env.KONGWOTV_TEST_FFMPEG || '/Users/kongwo/.local/bin/ffmpeg';
  if (!fs.existsSync(ffmpeg)) throw new Error(`Existing ffmpeg was not found: ${ffmpeg}. No tools are downloaded by this driver.`);
  if (!fs.existsSync(input)) throw new Error(`Local test video was not found: ${input}`);
  const generated = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
    '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(fixtures, 'segment-%03d.ts'),
    path.join(fixtures, 'fixture.m3u8'),
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  fs.writeFileSync(path.join(output, 'fixture-generation.log'), generated.stderr || '');
  if (generated.error || generated.status !== 0) throw new Error(`HLS fixture generation failed: ${generated.error?.message || generated.stderr || generated.status}`);
  const manifest = fs.readFileSync(path.join(fixtures, 'fixture.m3u8'), 'utf8');
  if (!manifest.startsWith('#EXTM3U') || !manifest.includes('#EXT-X-ENDLIST') || !fs.readdirSync(fixtures).some((name) => name.endsWith('.ts'))) throw new Error('ffmpeg did not produce a complete local HLS fixture.');
  const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map((entry) => Number(entry[1]));
  const duration = durations.reduce((sum, value) => sum + value, 0);
  if (duration < 10 || duration > 14) throw new Error(`Expected the 12-second local fixture, got ${duration} seconds.`);
  const env = { ...process.env, KONGWOTV_PLAYER_TEST_OUTPUT: output, KONGWOTV_PLAYER_FIXTURE_DIR: fixtures,
    KONGWOTV_PLAYER_TEST_SCOPE: options.rendererOnly ? 'renderer-only' : 'full' };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'KONGWOTV_SELF_TEST_OUTPUT', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  const withoutHostNode = options.withoutHostNode || options.launchServices;
  if (withoutHostNode) {
    env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : MAC_PATH;
    const hostNode = spawnSync('node', ['--version'], { env, encoding: 'utf8', timeout: 5000 });
    if (!hostNode.error || hostNode.error.code !== 'ENOENT') throw new Error('The reduced child PATH still exposes a host Node.js executable.');
  }
  const fixtureEvidence = { input, ffmpeg, directory: fixtures, durationSeconds: duration, segmentCount: durations.length, hostNodeOnPath: withoutHostNode ? false : 'not-tested' };
  fs.writeFileSync(path.join(output, 'fixture.json'), JSON.stringify(fixtureEvidence, null, 2) + '\n');
  console.log(`Player QA fixture: ${fixtures} (${duration.toFixed(3)}s)`);
  console.log(`Player QA output: ${output}`);
  if (options.launchServices) { await runLaunchServices({ selection, output, fixtures, env, options }); return; }

  // Original direct-executable mode is preserved when --launch-services is absent.
  const resultPath = path.join(output, 'result.json');
  const launchedAt = Date.now();
  const log = fs.createWriteStream(path.join(output, 'electron.log'));
  const child = spawn(target, options.app ? [] : [desktop], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  let timedOut = false;
  const append = (buffer) => { log.write(buffer); tail = (tail + buffer.toString()).slice(-12000); process.stdout.write(buffer); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const timer = setTimeout(() => { timedOut = true; console.error('Desktop player QA exceeded 270 seconds.'); child.kill('SIGKILL'); }, 270000);
  const finishLog = () => new Promise((resolve) => log.end(resolve));
  const stop = (signal) => { child.kill(signal); };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
  let code;
  try {
    code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate); await finishLog();
  }
  if (timedOut) throw new Error(`Player QA was killed on timeout. Evidence remains at ${output}.`);
  if (!fs.existsSync(resultPath) || fs.statSync(resultPath).mtimeMs < launchedAt) throw new Error(`Electron exited (${code}) without a fresh result.json. Main must integrate runPlayerSelfTest.\n${tail}`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  // Main owns result.json and process shutdown. The driver never upgrades a
  // failed result, synthesizes screenshots, or overwrites runtime evidence.
  console.log(JSON.stringify(result, null, 2));
  console.log(`Player QA evidence: ${output}`);
  reportScope(result, options, code);
  if (!resultAccepted(result, options, code)) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { argumentsOf, hasEnvironment, inspectApp, resultAccepted };
