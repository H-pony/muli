'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import type { EpgProgram } from '@/lib/types';
import { EmptyState, ErrorState, Spinner } from './states';

/**
 * EPG 节目单面板：当前节目（含播放进度条）+ 接下来节目列表 + 简介展开。
 * 仅在频道带 tvg-id 且来源订阅配置了 EPG 地址时查询；无数据优雅降级。
 */

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function LiveEpgPanel({ epgUrl, tvgId }: { epgUrl?: string; tvgId?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedDesc, setExpandedDesc] = useState(false);

  // 30s 心跳刷新进度
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const enabled = Boolean(epgUrl && tvgId);
  const epgQuery = useQuery({
    queryKey: ['liveEpg', epgUrl, tvgId],
    queryFn: ({ signal }) => api.liveEpg(epgUrl!, tvgId!, false, signal),
    enabled,
    staleTime: 10 * 60_000,
  });

  if (!enabled) {
    return (
      <EmptyState
        variant="plain"
        title="该频道未配置节目单数据（需来源订阅提供 EPG 地址且频道带 tvg-id）"
        className="!py-6"
      />
    );
  }

  if (epgQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner size="sm" />
      </div>
    );
  }

  if (epgQuery.isError) {
    return <ErrorState message="节目单加载失败" onRetry={() => epgQuery.refetch()} className="!py-6" />;
  }

  const data = epgQuery.data;
  const current = data?.current;
  const upcoming: EpgProgram[] = (data?.programs ?? []).filter((p) => p.start > now).slice(0, 5);

  const progress = current ? Math.min(100, Math.max(0, ((now - current.start) / (current.stop - current.start)) * 100)) : 0;

  return (
    <div className="min-w-0 space-y-6">
      {current ? (
        <div className="min-w-0 rounded-2xl border border-line/50 bg-chip/60 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              正在播出
            </span>
            <span className="text-[11px] tabular-nums text-faint">
              {fmtTime(current.start)} - {fmtTime(current.stop)}
            </span>
          </div>
          <button
            className="w-full break-words rounded-lg text-left text-base font-semibold tracking-tight text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:text-lg"
            aria-expanded={expandedDesc}
            onClick={() => setExpandedDesc((v) => !v)}
          >
            {current.title}
          </button>
          {current.desc && expandedDesc && (
            <p className="mt-3 break-words text-sm leading-relaxed text-muted animate-fade-in">{current.desc}</p>
          )}
          {/* 已播进度条 */}
          <div className="mt-5 h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] tabular-nums text-faint">
            <span>{fmtTime(current.start)}</span>
            <span>{Math.round(progress)}%</span>
            <span>{fmtTime(current.stop)}</span>
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-faint">当前时段暂无节目数据</p>
      )}

      {upcoming.length > 0 && (
        <div>
          <h4 className="mb-3 text-xs font-medium text-muted">接下来</h4>
          <ul className="space-y-1.5">
            {upcoming.map((p) => (
              <li
                key={`${p.start}-${p.title}`}
                className={cn(
                  'flex min-w-0 items-center gap-4 rounded-xl px-3 py-3 text-[13px]',
                  'text-muted hover:bg-hover transition-colors'
                )}
                title={p.desc || p.title}
              >
                <span className="text-faint tabular-nums shrink-0">{fmtTime(p.start)}</span>
                <span className="min-w-0 truncate text-content">{p.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
