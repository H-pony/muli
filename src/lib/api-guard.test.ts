import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardRequest } from './api-guard';
import { SESSION_COOKIE, signSession } from './auth';
import { GET as status } from '@/app/api/status/route';
import { GET as sessionStatus, POST as login, DELETE as logout } from '@/app/api/auth/route';

beforeEach(() => {
  vi.stubEnv('PASSWORD', '');
  vi.stubEnv('PROXY_SECRET', 'access-test-secret');
  vi.stubEnv('DEFAULT_SOURCES', '[]');
  vi.stubEnv('DEFAULT_LIVE_SOURCES', '[]');
  vi.stubEnv('DEFAULT_SUBSCRIPTIONS', '[]');
});
afterEach(() => vi.unstubAllEnvs());

function request(cookie?: string): Request {
  return new Request('http://localhost:8080/api/status', {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

describe('可选访问密码', () => {
  it.each([undefined, ''])('PASSWORD=%s 时无需 Cookie 即可使用页面和接口', async (password) => {
    vi.stubEnv('PASSWORD', password);
    const req = request();
    expect(guardRequest(req)).toBeNull();
    expect(await (await status(req)).json()).toMatchObject({ passwordRequired: false, verified: true });
    expect(await (await sessionStatus(req)).json()).toEqual({ success: true, verified: true });
    // 免密码模式无需提交密码，也无需创建登录 Cookie。
    const response = await login(new Request('http://localhost:8080/api/auth', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('旧版无效 Cookie 不影响免密码访问', async () => {
    const req = request(`${SESSION_COOKIE}=%invalid`);
    expect(guardRequest(req)).toBeNull();
    expect(await (await status(req)).json()).toMatchObject({ verified: true });
    expect(await (await sessionStatus(req)).json()).toMatchObject({ verified: true });
  });

  it('清除历史登录 Cookie 后仍可直接使用', async () => {
    expect((await logout()).headers.get('set-cookie')).toContain('Max-Age=0');
    expect(guardRequest(request())).toBeNull();
    expect(await (await sessionStatus(request())).json()).toMatchObject({ verified: true });
  });

  it('显式配置密码后仍会校验会话，状态接口与守卫保持一致', async () => {
    vi.stubEnv('PASSWORD', 'optional-test-password');
    const anonymous = request();
    expect(guardRequest(anonymous)?.status).toBe(401);
    expect(await (await status(anonymous)).json()).toMatchObject({ passwordRequired: true, verified: false });
    expect(await (await sessionStatus(anonymous)).json()).toMatchObject({ verified: false });

    const authenticated = request(`${SESSION_COOKIE}=${signSession().token}`);
    expect(guardRequest(authenticated)).toBeNull();
    expect(await (await status(authenticated)).json()).toMatchObject({ passwordRequired: true, verified: true });
    expect(await (await sessionStatus(authenticated)).json()).toMatchObject({ verified: true });
  });
});
