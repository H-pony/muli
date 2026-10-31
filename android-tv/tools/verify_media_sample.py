#!/usr/bin/env python3
"""Check HLS playlist chains and a small byte range of their first media segment."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
from urllib.parse import urljoin
from verify_live_sources import entries


def fetch(url, sample=False, referer=None):
    arguments = ['curl', '--connect-timeout', '4', '--max-time', '9', '-fLsS', '--user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36']
    if referer:
        arguments += ['--referer', referer]
    if sample:
        arguments += ['--range', '0-1023', '--max-filesize', '1048576']
    else:
        arguments += ['--max-filesize', '524288']
    result = subprocess.run(arguments + ['--write-out', '\nKONGWOTV_HTTP_STATUS=%{http_code}', url], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
    data, _, status = result.stdout.rpartition(b'\nKONGWOTV_HTTP_STATUS=')
    if result.returncode:
        raise OSError(result.stderr.decode('utf-8', 'replace').strip())
    return data, int(status)


def check(item):
    current = item['url']
    try:
        for depth in range(4):
            payload, status = fetch(current, referer=item['url'])
            text = payload.decode('utf-8-sig').strip()
            if not text.startswith('#EXTM3U'):
                raise ValueError('Not an HLS playlist')
            candidates = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
            if not candidates:
                raise ValueError('Playlist contains no media or variant URI')
            next_url = urljoin(current, candidates[0])
            if '#EXT-X-STREAM-INF' in text or ('.m3u8' in next_url and '#EXTINF:' not in text):
                current = next_url
                continue
            sample, media_status = fetch(next_url, sample=True, referer=item['url'])
            return {'name': item['name'], 'ok': bool(sample) and media_status in (200, 206), 'playlistStatus': status, 'mediaStatus': media_status, 'sampleBytes': len(sample)}
        raise ValueError('Too many nested playlists')
    except Exception as error:
        return {'name': item['name'], 'ok': False, 'error': str(error)[:300]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('playlist', type=Path)
    parser.add_argument('report', type=Path)
    parser.add_argument('--all', action='store_true', help='Check every bundled channel instead of the representative sample')
    options = parser.parse_args()
    items = list(entries(options.playlist.read_text('utf-8')))
    wanted = ['CCTV-1 综合','CCTV-6 电影','CCTV-13 新闻','CCTV-14 少儿','CCTV+ 国际新闻一台','广东卫视','湖南卫视','河北卫视','东莞新闻综合','浙江国际']
    chosen = items if options.all else [item for item in items if item['name'] in wanted]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(check, chosen))
    report = {'checked': len(results), 'passed': sum(item['ok'] for item in results), 'items': results}
    options.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
