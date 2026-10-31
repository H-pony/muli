import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptSegment } from './m3u8-downloader';
import { parseM3u8Playlist } from './m3u8-parse';

const KEY = crypto.getRandomValues(new Uint8Array(16));
const asBuf = (v: Uint8Array): BufferSource => v.buffer as ArrayBuffer;
const PLAINTEXT = crypto.getRandomValues(new Uint8Array(188 * 3));

async function encryptForIv(plaintext: BufferSource, iv: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', asBuf(KEY), 'AES-CBC', false, ['encrypt']);
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv: asBuf(iv) }, cryptoKey, plaintext);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decryptSegment', () => {
  it('显式 IV：密文往返还原明文', async () => {
    const cipher = await encryptForIv(PLAINTEXT, new Uint8Array(16).fill(0xab));
    const out = await decryptSegment(cipher, asBuf(KEY), 'ab'.repeat(16), 0, 0);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });

  it('无 IV 属性：IV = mediaSequence + 分片序号（16 字节大端），逐分片递增', async () => {
    // 分片 0（媒体序列号 5 → IV=5）与分片 1（IV=6）用各自正确的 IV 加密
    const ivOf = (seq: number) => {
      const iv = new Uint8Array(16);
      iv[15] = seq;
      return iv;
    };
    const cipher0 = await encryptForIv(PLAINTEXT, ivOf(5));
    const cipher1 = await encryptForIv(PLAINTEXT, ivOf(6));

    const out0 = await decryptSegment(cipher0, asBuf(KEY), undefined, 5, 0);
    expect(new Uint8Array(out0)).toEqual(PLAINTEXT);
    const out1 = await decryptSegment(cipher1, asBuf(KEY), undefined, 5, 1);
    expect(new Uint8Array(out1)).toEqual(PLAINTEXT);
  });

  it('回归：旧实现恒用零向量 IV——对非零序列号分片解密必然失败', async () => {
    // 分片按正确 IV=6 加密；旧实现对无 IV 属性的 KEY 恒用零向量 → 解不出明文
    const cipher = await encryptForIv(PLAINTEXT, ivOf6());
    const zeroIv = '00'.repeat(16);
    const out = await decryptSegment(cipher, asBuf(KEY), zeroIv, 5, 1).catch(
      () => new ArrayBuffer(0)
    );
    const same =
      out.byteLength === PLAINTEXT.byteLength &&
      new Uint8Array(out).every((b, i) => b === PLAINTEXT[i]);
    expect(same).toBe(false);
  });
});

function ivOf6(): Uint8Array {
  const iv = new Uint8Array(16);
  iv[15] = 6;
  return iv;
}

describe('parseM3u8Playlist · mediaSequence 与 AES URI 绝对化', () => {
  it('解析 EXT-X-MEDIA-SEQUENCE，AES key 相对地址转绝对', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:15',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:4,',
      'seg0.ts',
      '#EXTINF:4,',
      'seg1.ts',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(playlist, { status: 200 }))
    );

    const parsed = await parseM3u8Playlist('https://cdn.example.com/live/index.m3u8');
    expect(parsed.mediaSequence).toBe(15);
    expect(parsed.aesConf?.uri).toBe('https://cdn.example.com/live/key.bin');
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].url).toBe('https://cdn.example.com/live/seg0.ts');
  });

  it('缺省 MEDIA-SEQUENCE 时为 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('#EXTM3U\n#EXTINF:4,\nseg.ts', { status: 200 }))
    );
    const parsed = await parseM3u8Playlist('https://cdn.example.com/a.m3u8');
    expect(parsed.mediaSequence).toBe(0);
  });
});

describe('整集下载暂停、恢复与取消', () => {
  async function fixture() {
    const { PauseResumeController, runDownloadJob } = await import('./m3u8-downloader');
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
      put: vi.fn(async (request: Request, response: Response) => { stored.set(request.url, response.clone()); }),
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('.m3u8')
      ? new Response('#EXTM3U\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST')
      : new Response(new Uint8Array([1, 2, 3]))));
    const target = { kind: 'memory' as const, write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    const abort = new AbortController();
    const pause = new PauseResumeController();
    let report!: () => void;
    const prepared = new Promise<void>((resolve) => { report = resolve; });
    const onProgress = vi.fn((value: { status: string }) => { if (value.status === 'downloading') report(); });
    return { target, abort, pause, prepared, onProgress, run: () => runDownloadJob({ taskId: 'job', title: '影片', url: 'https://cdn.example.com/a.m3u8', format: 'TS', signal: abort.signal, pause, onProgress, target, concurrency: 8 }) };
  }

  it('8 个下载线程恢复单分片任务，不越界、不丢失原保存目标', async () => {
    const f = await fixture();
    f.pause.pause();
    const job = f.run();
    await f.prepared;
    expect(f.target.write).not.toHaveBeenCalled();
    f.pause.resume();
    await job;
    expect(f.target.write).toHaveBeenCalledOnce();
    expect(f.target.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(f.target.close).toHaveBeenCalledOnce();
    expect(f.target.abort).not.toHaveBeenCalled();
  });

  it('暂停中取消会唤醒等待、关闭目标，并拒绝而非报告完成', async () => {
    const f = await fixture();
    f.pause.pause();
    const job = f.run();
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await f.prepared;
    f.abort.abort();
    await rejected;
    expect(f.target.abort).toHaveBeenCalledOnce();
    expect(f.target.close).not.toHaveBeenCalled();
    expect(f.target.write).not.toHaveBeenCalled();
    expect(f.onProgress.mock.calls.some(([p]) => p.status === 'done')).toBe(false);
  });

  it('解析播放清单前已经取消，不再发起网络请求', async () => {
    const f = await fixture();
    f.abort.abort();
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(f.target.abort).toHaveBeenCalledOnce();
  });
  it('一个线程失败后等待另一个缓存写入退出，不能迟到回报下载中', async () => {
    const f = await fixture();
    let releasePut!: () => void;
    let bothStarted!: () => void;
    const started = new Promise<void>((resolve) => { bothStarted = resolve; });
    const pendingPut = new Promise<void>((resolve) => { releasePut = resolve; });
    const put = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/1')) return pendingPut;
      bothStarted();
      throw new Error('缓存写入失败');
    });
    vi.stubGlobal('caches', { open: vi.fn(async () => ({ match: vi.fn(async () => undefined), put })) });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('.m3u8')
      ? new Response('#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n#EXT-X-ENDLIST')
      : new Response(new Uint8Array([1, 2, 3]))));
    let settled = false;
    const job = f.run();
    void job.then(() => { settled = true; }, () => { settled = true; });
    const rejected = expect(job).rejects.toThrow('缓存写入失败');
    await started;
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(settled).toBe(false);
    releasePut();
    await rejected;
    expect(f.onProgress.mock.calls.every(([p]) => !('current' in p) || p.current === 0)).toBe(true);
    expect(f.target.write).not.toHaveBeenCalled();
    expect(f.target.abort).toHaveBeenCalledOnce();
  });

});
