'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { validArtworkCredential } from './artwork';

// Kept outside the general settings/config export: personal service credentials stay on this device.
const STORAGE_KEY = 'kongwotv-private-artwork';
const EVENT = 'kongwotv:artwork-preferences';
export interface ArtworkPreferences { enabled: boolean; credential: string }
const DEFAULTS: ArtworkPreferences = { enabled: true, credential: '' };
function parse(raw: string): ArtworkPreferences {
  try {
    const value = JSON.parse(raw) as Partial<ArtworkPreferences>;
    return { enabled: value.enabled !== false, credential: validArtworkCredential(value.credential) ? value.credential.trim() : '' };
  } catch { return DEFAULTS; }
}
function snapshot(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}
function subscribe(callback: () => void): () => void {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === STORAGE_KEY) callback(); };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
}
export function useArtworkPreferences(): ArtworkPreferences {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '');
  return useMemo(() => parse(raw), [raw]);
}
export function saveArtworkPreferences(patch: Partial<ArtworkPreferences>): void {
  const value = { ...parse(snapshot()), ...patch };
  if (!validArtworkCredential(value.credential)) throw new Error('图片服务凭据格式无效');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: value.enabled !== false, credential: value.credential.trim() }));
  window.dispatchEvent(new Event(EVENT));
}
/** A cache namespace, not a credential: never expose a raw token through React Query keys. */
export function artworkCredentialRevision(credential: string): string {
  let hash = 2166136261;
  for (let index = 0; index < credential.length; index++) hash = Math.imul(hash ^ credential.charCodeAt(index), 16777619);
  return credential ? (hash >>> 0).toString(36) : 'default';
}
