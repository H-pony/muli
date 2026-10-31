#!/usr/bin/env python3
"""Offline artwork/parser checks and optional unsigned Release device builds, with new evidence logs per run."""
from pathlib import Path
from datetime import datetime
import argparse
import hashlib
import json
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--devices', action='store_true', help='Also compile iPhone/iPad and Apple TV arm64 Release device targets without signing')
args = parser.parse_args()
prefix = 'artwork-build6-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f')
evidence = ROOT / 'build-evidence'
evidence.mkdir(exist_ok=True)
tests = ROOT / '.build' / 'artwork-build6-tests'
tests.mkdir(parents=True, exist_ok=True)
results = {'version': '2.16.12', 'builds': {'iOS': '2161207', 'tvOS': '2161207'}, 'brand': '幕里', 'offlineTests': [], 'deviceBuilds': [],
           'networkTMDBRequests': False, 'signing': False, 'deviceInstallation': False}


def run(command, label):
    log_path = evidence / (prefix + '-' + label + '.log')
    print(label + ': ' + str(log_path.relative_to(ROOT)), flush=True)
    with log_path.open('x') as log:
        log.write('Command: ' + ' '.join(str(x) for x in command) + '\n\n')
        log.flush()
        code = subprocess.call([str(x) for x in command], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        log.write('\nProcess exit code: ' + str(code) + '\n')
    print(label + ': exit ' + str(code), flush=True)
    if code:
        print('Inspect the new log for details: ' + str(log_path), file=sys.stderr)
        raise SystemExit(code)
    return str(log_path.relative_to(ROOT))


results['generatorLog'] = run([sys.executable, ROOT / 'tools/generate_project.py'], 'generate')
pure = [ROOT / 'Sources' / name for name in ['Models.swift', 'MediaRepository.swift', 'BackdropArtwork.swift', 'BackdropRepository.swift', 'BackdropImageDecoder.swift']]
for name in ['RepositorySmoke', 'ArtworkSmoke']:
    binary = tests / name
    build_log = run(['swiftc', '-parse-as-library', '-strict-concurrency=targeted', *pure, ROOT / 'Tests' / (name + '.swift'), '-o', binary], name.lower() + '-compile')
    test_log = run([binary, ROOT], name.lower() + '-run')
    results['offlineTests'].append({'name': name, 'compileLog': build_log, 'runLog': test_log, 'exitCode': 0})

if args.devices:
    for platform, sdk, destination in [('iOS', 'iphoneos', 'generic/platform=iOS'), ('tvOS', 'appletvos', 'generic/platform=tvOS')]:
        derived = ROOT / '.build' / ('artwork-build6-' + platform)
        log = run(['xcodebuild', '-project', ROOT / 'KongwoTV.xcodeproj', '-scheme', 'KongwoTV-' + platform,
                   '-configuration', 'Release', '-sdk', sdk, '-destination', destination, '-derivedDataPath', derived,
                   'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'build'], platform.lower() + '-release-device')
        app = derived / 'Build' / 'Products' / ('Release-' + sdk) / '幕里.app'
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        resources = []
        for name in ['artwork-catalog.json', 'tmdb-logo.png']:
            bundled = app / name
            shared = ROOT.parent / 'shared' / name
            digest = hashlib.sha256(bundled.read_bytes()).hexdigest()
            source_digest = hashlib.sha256(shared.read_bytes()).hexdigest()
            if name.endswith('.json') and digest != source_digest:
                raise SystemExit('Shared catalog changed during the build; rerun to bundle the current ' + name)
            # CopyPNGFile may losslessly optimize PNGs for Apple devices, changing their byte representation.
            resources.append({'name': name, 'bytes': bundled.stat().st_size, 'sha256': digest,
                              'sourceSha256': source_digest, 'optimizedPNG': name.endswith('.png') and digest != source_digest})
        binary = app / info['CFBundleExecutable']
        arches = subprocess.check_output(['lipo', '-archs', binary], text=True).strip()
        if b'--artwork-qa-detail' in binary.read_bytes():
            raise SystemExit('A Debug simulator preview argument leaked into a Release binary')
        if info['CFBundleDisplayName'] != '幕里' or info['CFBundleName'] != '幕里' or info['CFBundleShortVersionString'] != '2.16.12' or info['CFBundleVersion'] != results['builds'][platform] or arches != 'arm64':
            raise SystemExit('Unexpected device product metadata')
        results['deviceBuilds'].append({'platform': platform, 'sdk': sdk, 'app': str(app.relative_to(ROOT)), 'log': log,
                                       'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'],
                                       'architecture': arches, 'debugPreviewLaunchArgumentAbsent': True,
                                       'catalogItemCount': len(json.loads((app / 'artwork-catalog.json').read_bytes())['items']),
                                       'resources': resources, 'exitCode': 0})

report = evidence / (prefix + '-results.json')
with report.open('x') as output:
    json.dump(results, output, ensure_ascii=False, indent=2)
    output.write('\n')
print('Verification complete: ' + str(report.relative_to(ROOT)), flush=True)
