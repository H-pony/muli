import { describe, expect, it } from 'vitest';
import { readHlsResponse } from './hls-response';

const manifest = '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n';

describe('readHlsResponse', () => {
  it.each([
    ['https://cdn.example/video.M3U8?token=signed', 'https://cdn.example/video.M3U8?token=signed', 'text/plain'],
    ['https://cdn.example/redirect', 'https://cdn.example/final/index.m3u8?token=signed', 'application/unknown'],
    ['https://cdn.example/channel?id=1', 'https://cdn.example/channel?id=1', 'text/plain; charset=utf-8'],
    ['https://cdn.example/channel', 'https://cdn.example/channel', 'application/octet-stream'],
    ['https://cdn.example/channel', 'https://cdn.example/channel', 'application/vnd.apple.mpegURL'],
  ])('recognizes a complete HLS body at %s', async (requested, final, contentType) => {
    const response = new Response(manifest, { headers: { 'content-type': contentType } });
    const result = await readHlsResponse(response, requested, final);
    expect(result.manifest).toBe(manifest);
    expect(result.body).toBeNull();
  });

  it('handles a BOM and a signature split across response chunks', async () => {
    const pieces = ['\uFEFF#EX', 'TM', '3U\n', '#EXTINF:4,\nsegment.ts\n'];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
        controller.close();
      },
    }));
    expect((await readHlsResponse(response, 'https://cdn.example/live')).manifest)
      .toBe(pieces.join('').replace(/^\uFEFF/, ''));
  });

  it('does not rewrite or consume upstream HTTP error pages', async () => {
    const html = '<!DOCTYPE html><title>404 Not Found</title>';
    const response = new Response(html, { status: 404, headers: { 'content-type': 'text/html' } });
    const result = await readHlsResponse(response, 'https://cdn.example/index.m3u8');
    expect(result.manifest).toBeNull();
    expect(response.bodyUsed).toBe(false);
    expect(await new Response(result.body).text()).toBe(html);
  });

  it('preserves a successful HTML error page even with an m3u8 path', async () => {
    const html = '<!DOCTYPE html><title>Expired link</title>';
    const result = await readHlsResponse(new Response(html), 'https://cdn.example/index.m3u8?expired=1');
    expect(result.manifest).toBeNull();
    expect(await new Response(result.body).text()).toBe(html);
  });

  it('preserves every byte of a binary segment including the inspected prefix', async () => {
    const chunks = [new Uint8Array([0x47, 0x40]), new Uint8Array([0x11, 0x10, 0xff, 0x00]), new Uint8Array([1, 2, 3, 4, 5])];
    const response = new Response(new ReadableStream({
      start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); },
    }), { headers: { 'content-type': 'application/octet-stream' } });
    const result = await readHlsResponse(response, 'https://cdn.example/segment.ts');
    expect(result.manifest).toBeNull();
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(new Uint8Array(chunks.flatMap(chunk => [...chunk])));
  });

  it('does not sniff image responses', async () => {
    const response = new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    const result = await readHlsResponse(response, 'https://cdn.example/image');
    expect(result.body).toBe(response.body);
    expect(response.bodyUsed).toBe(false);
  });
});
