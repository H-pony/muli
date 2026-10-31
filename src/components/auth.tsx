'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import type { AuthStatusResponse } from '@/lib/types';
import { useToast } from './toast';

/** 未配置 PASSWORD 时直接访问；只有部署者显式配置密码后才显示登录入口。 */
interface AuthContextValue {
  checked: boolean;
  verified: boolean;
  /** /api/status 返回的应用版本（构建时从 package.json 注入） */
  version: string | null;
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  checked: false,
  verified: true,
  version: null,
  openLogin: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [verified, setVerified] = useState(true);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 与 Providers 共用同一 query key 与缓存，避免 /api/status 被请求两次。
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((s) => {
        if (cancelled) return;
        setPasswordRequired(s.passwordRequired);
        setVerified(!s.passwordRequired || s.verified);
        setModalOpen(s.passwordRequired && !s.verified);
        setVersion(s.version);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(
    () =>
      onUnauthorized(() => {
        if (!passwordRequired) return;
        setVerified(false);
        setModalOpen(true);
      }),
    [passwordRequired]
  );

  const openLogin = useCallback(() => {
    if (passwordRequired) setModalOpen(true);
  }, [passwordRequired]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setVerified(!passwordRequired);
      if (passwordRequired) toast('已退出登录', 'info');
    }
  }, [passwordRequired, toast]);

  const handleLoginSuccess = useCallback(async () => {
    setVerified(true);
    setModalOpen(false);
    // 登录前以 401 失败的查询（如豆瓣推荐）需要重新拉取。
    queryClient.invalidateQueries();
    toast('验证成功', 'success');
    // 配置了密码的部署需要补同步首次访问时被会话检查拦下的预置订阅。
    try {
      const cached = queryClient.getQueryData<AuthStatusResponse>(STATUS_QUERY_KEY);
      const status =
        cached ??
        (await queryClient.fetchQuery<AuthStatusResponse>({
          queryKey: STATUS_QUERY_KEY,
          queryFn: () => api.status(),
          staleTime: 0,
        }));
      if (status) await applyEnvPresets(status);
    } catch {
      // 补拉预置数据失败不影响登录后的正常使用。
    }
  }, [toast, queryClient]);

  return (
    <AuthContext.Provider value={{ checked, verified, version, openLogin, logout }}>
      {children}
      {passwordRequired && modalOpen && (
        <LoginModal onSuccess={handleLoginSuccess} onClose={() => setModalOpen(false)} />
      )}
    </AuthContext.Provider>
  );
}

function LoginModal({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = async () => {
    if (!password.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证失败';
      setError(msg === '需要登录' ? '密码错误' : msg);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="tv-auth-backdrop fixed inset-0 z-[95] flex items-center justify-center bg-black/70 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tv-auth-dialog bg-surface-raised w-full max-w-sm mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="访问验证"
      >
        <h2 className="text-lg font-semibold text-content mb-1">访问验证</h2>
        <p className="text-sm text-muted mb-4">请输入密码继续访问</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full"
            placeholder="密码"
            autoComplete="current-password"
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !password.trim()}>
            {loading ? '验证中...' : '进入'}
          </button>
        </form>
      </div>
    </div>
  );
}
