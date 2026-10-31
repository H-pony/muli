#!/usr/bin/env python3
"""Build the native Apple targets without signing or contacting Apple's developer portal."""
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--simulators', action='store_true', help='Also build arm64 simulator applications')
parser.add_argument('--test', action='store_true', help='Run repository parser and live API smoke checks on this Mac')
parser.add_argument('--package', action='store_true', help='Package existing products after building')
args = parser.parse_args()
logs = ROOT / 'build-evidence'
logs.mkdir(exist_ok=True)

def run(command, filename):
    print('Running:', ' '.join(str(x) for x in command), flush=True)
    with (logs / filename).open('w') as log:
        process = subprocess.Popen([str(x) for x in command], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            log.write(line)
            print(line, end='', flush=True)
        code = process.wait()
        log.write(f'\nProcess exit code: {code}\n')
        if code:
            raise SystemExit(code)

for platform, sdk, destination in [
    ('iOS', 'iphoneos', 'generic/platform=iOS'),
    ('tvOS', 'appletvos', 'generic/platform=tvOS'),
] + ([
    ('iOS-Simulator', 'iphonesimulator', 'generic/platform=iOS Simulator'),
    ('tvOS-Simulator', 'appletvsimulator', 'generic/platform=tvOS Simulator'),
] if args.simulators else []):
    scheme = 'KongwoTV-tvOS' if platform.startswith('tvOS') else 'KongwoTV-iOS'
    command = ['xcodebuild', '-project', ROOT / 'KongwoTV.xcodeproj', '-scheme', scheme,
               '-configuration', 'Release', '-sdk', sdk, '-destination', destination,
               '-derivedDataPath', ROOT / '.build' / platform,
               'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']
    if 'Simulator' in platform:
        command += ['ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES']
    command += ['build']
    run(command, 'build-' + platform.lower() + '.log')

if args.test:
    tests = ROOT / '.build' / 'tests'
    tests.mkdir(parents=True, exist_ok=True)
    binary = tests / 'RepositorySmoke'
    run(['swiftc', '-parse-as-library', ROOT / 'Sources/Models.swift', ROOT / 'Sources/MediaRepository.swift', ROOT / 'Sources/BackdropArtwork.swift', ROOT / 'Tests/RepositorySmoke.swift', '-o', binary], 'test-build.log')
    run([binary, ROOT, '--network'], 'repository-smoke.log')
    live_binary = tests / 'LiveSmoke'
    run(['swiftc', '-parse-as-library', ROOT / 'Sources/Models.swift', ROOT / 'Sources/MediaRepository.swift', ROOT / 'Sources/BackdropArtwork.swift', ROOT / 'Tests/LiveSmoke.swift', '-o', live_binary], 'live-test-build.log')
    run([live_binary, ROOT], 'live-smoke.log')

if args.package:
    subprocess.run([sys.executable, ROOT / 'tools/package.py'], check=True)
