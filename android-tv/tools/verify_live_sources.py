#!/usr/bin/env python3
"""Check public M3U playlist addresses without downloading programme content."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import time


def entries(text):
    pending = None
    for raw in text.lstrip('\ufeff').splitlines():
        line = raw.strip()
        if line.startswith('#EXTINF:'):
            pending = line
        elif pending and line.startswith(('http://', 'https://')):
            yield {'name': pending.rsplit(',', 1)[-1].strip(), 'url': line, 'extinf': pending}
            pending = None


def probe(item):
    start = time.monotonic()
    try:
        response = subprocess.run([
            'curl', '--connect-timeout', '3', '--max-time', '7', '--max-filesize', '524288',
            '-fLsS', '--user-agent', 'Mozilla/5.0 Muli/2.16.12', item['url']
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=9)
        valid = response.returncode == 0 and response.stdout.lstrip(b'\xef\xbb\xbf\r\n ').startswith(b'#EXTM3U')
        return dict(item, ok=valid, ms=round((time.monotonic()-start)*1000), error='' if valid else response.stderr.decode('utf-8', 'replace').strip()[:200])
    except Exception as error:
        return dict(item, ok=False, ms=round((time.monotonic()-start)*1000), error=str(error))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('playlist', type=Path)
    parser.add_argument('report', type=Path)
    options = parser.parse_args()
    candidates = list(entries(options.playlist.read_text('utf-8')))
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as workers:
        for result in workers.map(probe, candidates):
            results.append(result)
            if result['ok']:
                print('OK:', result['name'], result['ms'], 'ms', flush=True)
    options.report.write_text(json.dumps({'checked': len(results), 'passed': sum(item['ok'] for item in results), 'items': results}, ensure_ascii=False, indent=2), 'utf-8')
    print('Checked:', len(results), 'Playlist responses:', sum(item['ok'] for item in results), flush=True)


if __name__ == '__main__':
    main()
