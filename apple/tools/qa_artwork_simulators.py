#!/usr/bin/env python3
"""Capture real detail views in isolated temporary iPhone/iPad simulators using installed runtimes only."""
from pathlib import Path
from datetime import datetime
import json
import plistlib
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'build-evidence'
EVIDENCE.mkdir(exist_ok=True)
PREFIX = 'artwork-build6-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-native-qa'
REPORT = {'mode': 'DEBUG simulator validation only', 'realDeviceOperations': False, 'runtimeDownloads': False,
          'source': 'https://360zy.com/api.php/provide/vod', 'sourceMediaID': '4342',
          'title': '燃烧女子的肖像', 'year': '2019', 'tmdbID': 531428,
          'fakeMetadataOrAPIResponses': False, 'screenshots': [], 'simulators': []}


def run(command, label, timeout=240):
    path = EVIDENCE / (PREFIX + '-' + label + '.log')
    print(label + ': ' + str(path.relative_to(ROOT)), flush=True)
    with path.open('x') as log:
        log.write('Command: ' + ' '.join(str(x) for x in command) + '\n\n')
        log.flush()
        result = subprocess.run([str(x) for x in command], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        log.write('\nProcess exit code: ' + str(result.returncode) + '\n')
    if result.returncode:
        raise RuntimeError(label + ' failed; inspect ' + str(path))
    return path


def sim_json(*arguments):
    return json.loads(subprocess.check_output(['xcrun', 'simctl', *arguments, '-j']))


def verify_owned(device):
    entries = [row for rows in sim_json('list', 'devices')['devices'].values() for row in rows]
    found = next((row for row in entries if row['udid'] == device['udid']), None)
    if not found or found['name'] != device['name'] or not found['name'].startswith('KongwoTV-Artwork-QA-'):
        raise RuntimeError('Refusing to operate on a simulator whose exact QA identity was not verified')
    return found


runtimes = sim_json('list', 'runtimes')['runtimes']
REPORT['installedRuntimes'] = [{key: runtime.get(key) for key in ['name', 'identifier', 'version', 'isAvailable']} for runtime in runtimes]
ios = next((runtime for runtime in runtimes if runtime.get('isAvailable') and runtime['identifier'].endswith('iOS-27-0')), None)
if ios is None:
    ios = next((runtime for runtime in runtimes if runtime.get('isAvailable') and '.iOS-' in runtime['identifier']), None)
if ios is None:
    raise SystemExit('No installed iOS simulator runtime; nothing was created or downloaded')
REPORT['tvOSRuntimeAvailable'] = any(runtime.get('isAvailable') and '.tvOS-' in runtime['identifier'] for runtime in runtimes)
run(['python3', ROOT / 'tools/generate_project.py'], 'generate')
derived = ROOT / '.build' / 'artwork-build6-iOS-QA'
run(['xcodebuild', '-project', ROOT / 'KongwoTV.xcodeproj', '-scheme', 'KongwoTV-iOS', '-configuration', 'Debug',
     '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived,
     'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'build'], 'ios-debug-simulator-build', timeout=300)
app = derived / 'Build/Products/Debug-iphonesimulator/幕里.app'
info = plistlib.loads((app / 'Info.plist').read_bytes())
if 'iPhoneSimulator' not in info.get('CFBundleSupportedPlatforms', []):
    raise SystemExit('Refusing to install a non-simulator product')

owned = []
try:
    for family, label in [('iPhone', 'iphone'), ('iPad', 'ipad')]:
        device_type = next(device for device in ios['supportedDeviceTypes'] if device.get('productFamily') == family)
        name = 'KongwoTV-Artwork-QA-' + family + '-' + PREFIX.split('-native-qa')[0].split('build6-')[1]
        udid = subprocess.check_output(['xcrun', 'simctl', 'create', name, device_type['identifier'], ios['identifier']], text=True).strip()
        device = {'name': name, 'udid': udid, 'deviceType': device_type['name'], 'runtime': ios['name'], 'cleanedUp': False}
        owned.append(device); REPORT['simulators'].append(device)
        verify_owned(device)
        run(['xcrun', 'simctl', 'boot', udid], label + '-boot')
        run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], label + '-bootstatus', timeout=180)
        run(['xcrun', 'simctl', 'ui', udid, 'appearance', 'dark'], label + '-appearance')
        run(['xcrun', 'simctl', 'install', udid, app], label + '-install-debug')
        for mode in ['backdrop', 'cover']:
            command = ['xcrun', 'simctl', 'launch', '--terminate-running-process', udid, info['CFBundleIdentifier'], '--artwork-qa-detail']
            if mode == 'cover':
                command.append('--artwork-qa-cover')
            run(command, label + '-' + mode + '-launch')
            # Native asynchronous source and CDN requests run normally; allow their bounded requests to settle.
            time.sleep(12)
            shot = EVIDENCE / (PREFIX + '-' + label + '-' + mode + '-debug-simulator.png')
            run(['xcrun', 'simctl', 'io', udid, 'screenshot', shot], label + '-' + mode + '-screenshot')
            REPORT['screenshots'].append({'device': family, 'deviceType': device_type['name'], 'mode': mode,
                                          'path': str(shot.relative_to(ROOT)), 'debugSimulatorOnly': True})
        verify_owned(device)
        run(['xcrun', 'simctl', 'shutdown', udid], label + '-shutdown')
        verify_owned(device)
        run(['xcrun', 'simctl', 'delete', udid], label + '-delete-owned-qa-device')
        device['cleanedUp'] = True
finally:
    for index, device in enumerate(owned):
        if device['cleanedUp']:
            continue
        current = verify_owned(device)
        if current['state'] != 'Shutdown':
            run(['xcrun', 'simctl', 'shutdown', device['udid']], 'cleanup-' + str(index) + '-shutdown')
        verify_owned(device)
        run(['xcrun', 'simctl', 'delete', device['udid']], 'cleanup-' + str(index) + '-delete-owned-qa-device')
        device['cleanedUp'] = True
    report = EVIDENCE / (PREFIX + '-results.json')
    with report.open('x') as stream:
        json.dump(REPORT, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print('Native QA evidence: ' + str(report.relative_to(ROOT)), flush=True)
