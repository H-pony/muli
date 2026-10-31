'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { artworkYear, catalogBackdrop, type ArtworkIdentity, type BackdropArtwork } from '@/lib/artwork';
import { artworkCredentialRevision, useArtworkPreferences } from '@/lib/artwork-preferences';
import { SmartImage } from './smart-image';

export function useBackdropArtwork(identity: ArtworkIdentity): BackdropArtwork | undefined {
  const preferences = useArtworkPreferences();
  const builtIn = preferences.enabled ? catalogBackdrop(identity) : undefined;
  const query = useQuery({
    queryKey: ['artwork', identity.title, identity.year ?? '', identity.mediaType ?? '', identity.tmdbId ?? '',
      identity.imdbId ?? '', identity.doubanId ?? '', artworkCredentialRevision(preferences.credential)],
    queryFn: ({ signal }) => api.artwork(identity, preferences.credential, signal),
    enabled: preferences.enabled && !builtIn && !!identity.title && !!(artworkYear(identity.year) || identity.tmdbId || identity.imdbId || identity.doubanId),
    staleTime: (query) => query.state.data?.artwork ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  return preferences.enabled ? builtIn ?? query.data?.artwork ?? undefined : undefined;
}

/** The cover remains visible while metadata loads; a broken HD image really falls back. */
export function DetailBackdrop({ artwork, backdrop, cover, mode, customProxy }: {
  artwork?: BackdropArtwork;
  backdrop?: string;
  cover?: string;
  mode: 'direct' | 'proxy' | 'custom';
  customProxy?: string;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [readyUrl, setReadyUrl] = useState('');
  const seen = new Set<string>();
  const candidates = [backdrop, cover].filter((url): url is string => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map((url) => ({ url, key: `${url}|${mode}|${customProxy ?? ''}` }));
  const active = candidates.find((item) => !failed.has(item.key));
  const highKey = artwork ? `${artwork.url}|direct` : '';
  const highUrl = artwork && !failed.has(highKey) ? artwork.url : undefined;
  const covered = !!highUrl && readyUrl === highUrl;
  const markFailed = (key: string) => setFailed((previous) => previous.has(key) ? previous : new Set([...previous, key]));
  return <>
    {active && <SmartImage key={active.key} url={active.url} mode={mode} customProxy={customProxy} alt="" loading="eager"
      className={`tv-detail-artwork-fallback${covered ? ' is-covered' : ''}`} onExhausted={() => markFailed(active.key)} />}
    {highUrl && <SmartImage key={highKey} url={highUrl} mode="direct" alt="" loading="eager"
      className={`tv-detail-artwork-hd${covered ? ' is-ready' : ''}`} minimumSize={{ width: 1280, height: 720 }}
      onReady={() => setReadyUrl(highUrl)} onExhausted={() => markFailed(highKey)} />}
  </>;
}
