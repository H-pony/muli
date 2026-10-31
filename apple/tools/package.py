#!/usr/bin/env python3
"""Create unsigned IPA archives and the matching Apple source archive; simulator archives are opt-in."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import plistlib
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT.parent / 'dist')
parser.add_argument('--include-simulators', action='store_true', help='Explicitly include existing simulator builds as additional validation artifacts')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
VERSION = '2.16.12'
BUILD = '2161207'


def zip_files(destination, entries):
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, name in entries:
            if source.is_symlink():
                value = zipfile.ZipInfo(name)
                value.create_system = 3
                value.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(value, os.readlink(source))
            else:
                archive.write(source, name)
    with zipfile.ZipFile(destination) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError('Archive verification failed: ' + bad)


def tree(directory, prefix):
    return [(path, str(Path(prefix) / path.relative_to(directory))) for path in sorted(directory.rglob('*')) if path.is_file() or path.is_symlink()]


artifacts = []
for platform, sdk, display in [('iOS', 'iphoneos', 'iOS'), ('tvOS', 'appletvos', 'AppleTV')]:
    app = ROOT / '.build' / platform / 'Build/Products' / ('Release-' + sdk) / '幕里.app'
    if not (app / '幕里').is_file():
        raise SystemExit('Build product missing: ' + str(app))
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info['CFBundleDisplayName'] != '幕里' or info['CFBundleShortVersionString'] != VERSION or info['CFBundleVersion'] != BUILD:
        raise SystemExit('Unexpected product name or version: ' + str(app))
    if (app / 'embedded.mobileprovision').exists() or (app / '_CodeSignature').exists():
        raise SystemExit('Expected unsigned output; inspect signing before changing the delivery label.')
    filename = f'幕里-{display}-{VERSION}-需签名.ipa'
    zip_files(output / filename, tree(app, 'Payload/幕里.app'))
    artifacts.append({'file': filename, 'platform': display, 'bundleIdentifier': info['CFBundleIdentifier'],
                      'minimumOS': info['MinimumOSVersion'], 'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'], 'architecture': 'arm64', 'signed': False,
                      'directlyInstallable': False})

for platform, sdk, display in ([('iOS-Simulator', 'iphonesimulator', 'iOS'), ('tvOS-Simulator', 'appletvsimulator', 'AppleTV')] if args.include_simulators else []):
    app = ROOT / '.build' / platform / 'Build/Products' / ('Release-' + sdk) / '幕里.app'
    if (app / '幕里').is_file():
        filename = f'幕里-{display}-{VERSION}-模拟器-arm64.app.zip'
        zip_files(output / filename, tree(app, '幕里.app'))
        artifacts.append({'file': filename, 'platform': display + ' Simulator', 'architecture': 'arm64',
                          'requiresMacWithAppleSiliconAndSimulatorRuntime': True, 'directlyInstallableOnDevice': False})

source_entries = []
for path in sorted(ROOT.rglob('*')):
    relative = path.relative_to(ROOT)
    if any(part in {'.build', 'build-evidence', '.git', 'xcuserdata', '__pycache__', '.DS_Store'} for part in relative.parts):
        continue
    if path.is_file() or path.is_symlink():
        source_entries.append((path, str(Path('apple') / relative)))
for filename in ['artwork-catalog.json', 'tmdb-logo.png']:
    source_entries.append((ROOT.parent / 'shared' / filename, str(Path('shared') / filename)))
filename = f'幕里-Apple源码-{VERSION}.zip'
zip_files(output / filename, source_entries)
artifacts.append({'file': filename, 'platform': 'iOS, iPadOS, tvOS', 'license': 'AGPL-3.0-or-later', 'containsSigningSecrets': False, 'includesSharedResources': True})

for filename in [f'幕里-Apple构建与签名说明-{VERSION}.md', f'幕里-Apple验证记录-{VERSION}.zip']:
    if (output / filename).is_file():
        artifacts.append({'file': filename, 'platform': 'Apple validation', 'containsSigningSecrets': False})

for artifact in artifacts:
    path = output / artifact['file']
    artifact['bytes'] = path.stat().st_size
    artifact['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
manifest = output / f'幕里-Apple交付清单-{VERSION}.json'
manifest.write_text(json.dumps({'version': VERSION, 'build': BUILD, 'artifacts': artifacts}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'manifest': manifest.name, 'artifacts': artifacts}, ensure_ascii=False, indent=2))
