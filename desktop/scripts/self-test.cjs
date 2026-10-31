'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const appIndex = process.argv.indexOf('--app');
const target = appIndex >= 0 ? path.resolve(process.argv[appIndex + 1]) : require('electron');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1])
  : path.join(desktop, 'self-test-results', `${process.platform}-${process.arch}${appIndex >= 0 ? '-packaged' : '-development'}`);
const env = { ...process.env, KONGWOTV_SELF_TEST_OUTPUT: output };
delete env.ELECTRON_RUN_AS_NODE;
const withoutHostNode = process.argv.includes('--without-host-node');
if (withoutHostNode) {
  env.PATH = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    : '/usr/bin:/bin:/usr/sbin:/sbin';
  const hostNode = spawnSync('node', ['--version'], { env, encoding: 'utf8' });
  if (!hostNode.error || hostNode.error.code !== 'ENOENT') {
    throw new Error('The reduced PATH still exposes a host Node.js executable.');
  }
}
fs.mkdirSync(output, { recursive: true });
const startedAt = Date.now();
const child = spawn(target, appIndex >= 0 ? [] : [desktop], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (data) => { logs += data.toString(); });
child.stderr.on('data', (data) => { logs += data.toString(); });
const timeout = setTimeout(() => { console.error('Desktop self-test exceeded 90 seconds.'); child.kill('SIGKILL'); }, 90000);
child.once('error', (error) => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.once('exit', (code) => {
  clearTimeout(timeout);
  fs.writeFileSync(path.join(output, 'electron.log'), logs);
  const resultPath = path.join(output, 'result.json');
  if (!fs.existsSync(resultPath) || fs.statSync(resultPath).mtimeMs < startedAt) {
    console.error(`Electron exited (${code}) without producing self-test results.\n${logs}`);
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (withoutHostNode) {
    result.hostNodeOnPath = false;
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
  console.log(`Self-test evidence: ${output}`);
  if (!result.passed || code !== 0) process.exitCode = 1;
});
