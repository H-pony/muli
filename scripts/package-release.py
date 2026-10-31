"""Collect finished multi-platform packages and corresponding source for distribution."""
from pathlib import Path
import hashlib
import json
import os
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(os.environ.get('MULI_RELEASE_DIR', ROOT / 'dist'))
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
PREFIX = f'幕里-{VERSION}'
ROOT_FILES = [
    'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.env.example',
    '.gitignore', '.dockerignore', 'Dockerfile', 'docker-compose.yml',
    'next-env.d.ts', 'next.config.ts', 'tsconfig.json', 'vitest.config.ts',
    'eslint.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts',
]
SOURCE_DIRS = ['src', 'public', 'shared', 'docs', 'scripts', '.github', 'android-tv', 'desktop', 'apple']
EXCLUDED_DIRS = {
    'node_modules', '.next', '.git', '.gradle', '.staging', '.signing',
    'build', '.build', 'dist', 'dist-tv', 'artifacts', 'DerivedData', '__pycache__',
    'self-test-results', 'test-results', 'build-evidence',
    '.swiftpm', 'xcuserdata', '.mimosa', '.zcode', '.codebuddy',
}
EXCLUDED_FILES = {'local.properties', 'signing.properties', '.DS_Store'}
PRIVATE_SUFFIXES = {'.jks', '.keystore', '.p12', '.mobileprovision', '.provisionprofile'}


def safe_source(path):
    return path.name not in EXCLUDED_FILES and path.suffix not in PRIVATE_SUFFIXES \
        and (not path.name.startswith('.env') or path.name == '.env.example') \
        and not path.name.endswith(('.log', '.tsbuildinfo')) and not path.is_symlink()


def source_files():
    for name in ROOT_FILES:
        file = ROOT / name
        if file.is_file():
            yield file
    for name in SOURCE_DIRS:
        folder = ROOT / name
        if not folder.exists():
            continue
        for current, dirs, files in os.walk(folder):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not (Path(current) / d).is_symlink())
            for file in sorted(files):
                path = Path(current) / file
                if safe_source(path):
                    yield path


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def create_source():
    target = DIST / f'{PREFIX}-源码.zip'
    if target.exists():
        raise RuntimeError('Source archive already exists; review it before rebuilding.')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in source_files():
            archive.write(file, str(Path('幕里') / file.relative_to(ROOT)))
    with zipfile.ZipFile(target) as archive:
        private = [name for name in archive.namelist() if Path(name).name in EXCLUDED_FILES or Path(name).suffix in PRIVATE_SUFFIXES or (Path(name).name.startswith('.env') and Path(name).name != '.env.example')]
        if private:
            raise RuntimeError('Private file accidentally selected for source distribution.')
        if archive.testzip() is not None:
            raise RuntimeError('Source archive CRC verification failed.')
        print(f'Source archive: {len(archive.namelist())} files; private configuration excluded.')
    return target


def main():
    DIST.mkdir(parents=True, exist_ok=True)
    required = [
        f'幕里-AndroidTV-{VERSION}.apk',
        f'幕里-Android-{VERSION}.apk',
    ]
    missing = [name for name in required if not (DIST / name).is_file()]
    if missing:
        raise RuntimeError('Required packages are still missing: ' + ', '.join(missing))
    packages = sorted(file for file in DIST.iterdir() if file.is_file() and file.name.startswith('幕里') and file.suffix in {'.apk', '.dmg', '.exe', '.ipa', '.zip'} and '源码' not in file.name and '-全端安装包.' not in file.name and '-Web-' not in file.name and 'linux' not in file.name.lower() and '模拟器' not in file.name and not (file.suffix == '.zip' and '-mac-' in file.name))
    supporting = sorted(file for file in DIST.iterdir() if file.is_file() and file.name.startswith('幕里') and file.suffix in {'.md', '.json'})
    if not any(file.suffix == '.dmg' for file in packages) or not any(file.suffix == '.exe' for file in packages):
        raise RuntimeError('Desktop installer builds are not yet complete.')
    source = create_source()
    files = packages + [source] + supporting
    manifest = {
        'application': '幕里', 'version': VERSION,
        'packages': [{'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file)} for file in files],
        'notes': {
            'apple': 'iOS/iPadOS/tvOS IPA files labelled 需签名 require a suitable personal signing certificate and device provisioning profile before installation.',
            'desktop': 'Desktop applications bundle their server and runtime; no separate Node.js installation is required.',
            'source': 'Complete corresponding application source is included under AGPL-3.0-or-later; local private keys and environment files are excluded.',
        },
    }
    manifest_path = DIST / '发布清单.json'
    if manifest_path.exists():
        raise RuntimeError('Release manifest already exists; review it before rebuilding.')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    checksums = DIST / 'SHA256SUMS.txt'
    if checksums.exists():
        raise RuntimeError('Release checksums already exist; review them before rebuilding.')
    checksum_files = files + [manifest_path]
    for name in ['安装说明.txt', '安装说明.md', '验证结果.md']:
        file = DIST / name
        if file.exists():
            checksum_files.append(file)
    checksums.write_text(''.join(f'{digest(file)}  {file.name}\n' for file in checksum_files))
    # DMG is the primary macOS installer; ZIP alternatives remain individually available.
    primary = [file for file in files if not (file.suffix == '.zip' and 'mac' in file.name.lower())]
    bundle = DIST / f'{PREFIX}-全端安装包.zip'
    if bundle.exists():
        raise RuntimeError('Full package archive already exists; review it before rebuilding.')
    with zipfile.ZipFile(bundle, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for file in primary + [manifest_path, checksums] + [DIST / name for name in ['安装说明.txt', '安装说明.md', '验证结果.md'] if (DIST / name).exists()]:
            archive.write(file, str(Path(PREFIX) / file.name))
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Full package archive CRC verification failed.')
    bundle_checksum = DIST / '全端安装包-SHA256.txt'
    if bundle_checksum.exists():
        raise RuntimeError('Full package checksum already exists; review it before rebuilding.')
    bundle_checksum.write_text(f'{digest(bundle)}  {bundle.name}\n')
    print(json.dumps({'bundle': str(bundle), 'bytes': bundle.stat().st_size, 'individualPackages': len(packages), 'source': str(source)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
