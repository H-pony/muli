'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { TMDB_ATTRIBUTION } from '@/lib/artwork';
import { saveArtworkPreferences, useArtworkPreferences } from '@/lib/artwork-preferences';
import { SectionTitle, ToggleRow } from './settings-shared';
import { useToast } from './toast';

export function TMDBAttribution() {
  return <div className="space-y-2 text-xs text-faint leading-relaxed">
    <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 text-muted hover:text-content">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/artwork/tmdb-logo.svg" width={137} height={18} alt="TMDB" />
      <span>高清图片来源</span>
    </a>
    <p lang="en">{TMDB_ATTRIBUTION}</p>
  </div>;
}

export function ArtworkSettings() {
  const preferences = useArtworkPreferences();
  const [draft, setDraft] = useState('');
  const { toast } = useToast();
  const configuration = useQuery({ queryKey: ['artwork-configuration'], queryFn: api.artworkConfiguration, staleTime: 60000, retry: false });
  useEffect(() => setDraft(preferences.credential), [preferences.credential]);
  const save = (credential: string) => {
    try {
      saveArtworkPreferences({ credential });
      toast(credential.trim() ? '高清图片凭据已保存在本机' : '已清除本机图片凭据', 'success');
    } catch { toast('无法保存图片设置，请检查凭据或本机存储', 'error'); }
  };
  return <section className="space-y-4">
    <SectionTitle title="高清背景图" />
    <ToggleRow label="自动获取高清横图" description="为影片详情选择独立横图，获取失败时保留原背景"
      checked={preferences.enabled} onChange={(enabled) => {
        try { saveArtworkPreferences({ enabled }); } catch { toast('无法保存图片设置', 'error'); }
      }} />
    <p className="text-xs text-muted leading-relaxed">内置已匹配片目可直接显示高清背景。填写自己的 TMDB 凭据后，可自动查询更多电影和剧集。</p>
    {configuration.data?.configured && <p className="text-xs text-muted">内置服务已配置图片来源；也可填写本机凭据。</p>}
    <div className="space-y-2">
      <label htmlFor="tmdb-artwork-credential" className="text-sm text-content">TMDB API Key 或读取令牌</label>
      <input id="tmdb-artwork-credential" className="input w-full" type="password" autoComplete="off" spellCheck={false}
        maxLength={2048} placeholder="API Key / API Read Access Token" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg bg-chip px-4 py-2 text-xs text-content hover:bg-hover" onClick={() => save(draft)}>保存</button>
        <button type="button" className="rounded-lg px-4 py-2 text-xs text-muted hover:bg-hover" onClick={() => { setDraft(''); save(''); }}>清除</button>
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="px-2 py-2 text-xs text-muted hover:text-content">获取 TMDB 凭据 ↗</a>
      </div>
      <p className="text-xs text-faint">凭据仅在本机保存，不包含在配置导出文件中。</p>
    </div>
    <TMDBAttribution />
  </section>;
}
