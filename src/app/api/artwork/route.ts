import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { parseArtworkIdentity, validArtworkCredential } from '@/lib/artwork';
import { resolveArtwork } from '@/lib/artwork-provider';

export const runtime = 'nodejs';
const HEADERS = { 'Cache-Control': 'private, no-store' };
function configuredCredential(): string {
  return (process.env.TMDB_READ_TOKEN || process.env.TMDB_ACCESS_TOKEN || process.env.TMDB_API_KEY || '').trim();
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  return NextResponse.json({ configured: !!configuredCredential() }, { headers: HEADERS });
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (!req.body || Number(req.headers.get('content-length') || 0) > 8192) {
    return NextResponse.json({ error: '图片查询参数过大或为空' }, { status: 413, headers: HEADERS });
  }
  const reader = req.body.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return NextResponse.json({ error: '图片查询参数过大' }, { status: 413, headers: HEADERS });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return NextResponse.json({ error: '无法读取图片查询参数' }, { status: 400, headers: HEADERS });
  } finally { reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    return NextResponse.json({ error: '图片查询参数格式无效' }, { status: 400, headers: HEADERS });
  }
  const identity = parseArtworkIdentity(data);
  const credential = data && typeof data === 'object' ? (data as Record<string, unknown>).credential : undefined;
  if (!identity || (credential !== undefined && !validArtworkCredential(credential))) {
    return NextResponse.json({ error: '需要有效的片名、年份或作品标识' }, { status: 400, headers: HEADERS });
  }
  const result = await resolveArtwork(identity, typeof credential === 'string' && credential.trim() ? credential : configuredCredential());
  return NextResponse.json(result, { headers: HEADERS });
}
