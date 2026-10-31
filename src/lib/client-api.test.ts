import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, onUnauthorized } from './client-api';

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => vi.unstubAllGlobals());

describe('客户端访问错误', () => {
  it('503 展示实际服务错误，不触发密码验证', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '服务暂时不可用' }, { status: 503 })));
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    try {
      await expect(api.status()).rejects.toMatchObject({ status: 503, message: '服务暂时不可用' });
      expect(unauthorized).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('401 仍通知已配置密码的页面处理会话失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '未登录' }, { status: 401 })));
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    try {
      await expect(api.status()).rejects.toMatchObject({ status: 401, message: '需要登录' });
      expect(unauthorized).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });
});

describe('搜索流完成语义', () => {
  it('只有逐源事件而没有 done 时报告中断，不能返回成功空数组', async () => {
    const event = { type: 'source', sourceKey: 'a', ok: true, list: [{ sourceKey: 'a', vodId: '1', name: '影片' }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(event) + '\n')));
    const onSource = vi.fn();
    await expect(api.search('影片', [], true, { onSource })).rejects.toThrow('搜索连接中断');
    expect(onSource).toHaveBeenCalledWith(event);
  });

  it('明确的 done 空数组才是成功的无结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"type":"done","list":[],"failures":[]}\n')));
    await expect(api.search('影片', [], true, { onSource: vi.fn() })).resolves.toEqual({ list: [], failures: [] });
  });
});
