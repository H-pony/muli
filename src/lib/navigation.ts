import type { MouseEvent } from 'react';

/** Navigation context belongs to a browser history entry, never to a video/episode. */
const ENTRY_KEY = '__kongwotvEntry';
const LAYER_KEY = '__kongwotvLayer';
const WATCH_KEY = '__kongwotvWatchReturn';
const STORAGE_PREFIX = 'kongwotv:navigation:';
export const NAVIGATION_EVENT = 'kongwotv:navigation';
const memory = new Map<string, unknown>();

interface ScrollPosition {
  selector: string;
  /** Shelf headings remain stable when continue-watching/watchlist rails appear or disappear. */
  key?: string;
  index: number;
  left: number;
  top: number;
}

export interface NavigationEntry {
  id: string;
  href: string;
  x: number;
  y: number;
  scroll: ScrollPosition[];
  data: Record<string, unknown>;
}

export interface NavigationLayer<T> {
  id: string;
  data: T;
  ui?: Record<string, unknown>;
}

export interface WatchReturnContext {
  entryId: string;
  href: string;
}

let pendingWatchReturn: WatchReturnContext | undefined;
let pendingRestore: WatchReturnContext | undefined;

/** Only local page URLs are usable as a return destination. Playback/API URLs would loop. */
export function safeReturnTo(value: string | null | undefined, origin: string): string | undefined {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//')) return undefined;
  if (!trimmed.startsWith('/') && !/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed, origin);
    if (url.origin !== origin || url.username || url.password) return undefined;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(pathname)) return undefined;
    if (/^\/(watch|api)(?:\/|$)/i.test(pathname)) return undefined;
    return url.pathname + url.search + url.hash;
  } catch {
    return undefined;
  }
}

export function watchUrlWithReturnTo(watchHref: string, returnHref: string, origin: string, entryId?: string): string {
  const url = new URL(watchHref, origin);
  url.searchParams.set('returnTo', safeReturnTo(returnHref, origin) || '/');
  if (entryId) url.searchParams.set('returnEntry', entryId);
  else url.searchParams.delete('returnEntry');
  return url.pathname + url.search + url.hash;
}

/** A different source/episode is still the same playback visit. */
export function preserveWatchReturn(watchHref: string, currentHref: string, origin: string): string {
  const current = new URL(currentHref, origin);
  const next = new URL(watchHref, origin);
  for (const key of ['returnTo', 'returnEntry']) {
    const value = current.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  return next.pathname + next.search + next.hash;
}

export function watchBackPlan(currentHref: string, origin: string, context?: WatchReturnContext, referrer?: string, fallbackHref = '/'): { kind: 'back' | 'replace'; href: string; entryId?: string } {
  const params = new URL(currentHref, origin).searchParams;
  const target = safeReturnTo(params.get('returnTo'), origin);
  if (context && target === context.href && params.get('returnEntry') === context.entryId) {
    return { kind: 'back', href: target, entryId: context.entryId };
  }
  return { kind: 'replace', href: target || safeReturnTo(referrer, origin) || safeReturnTo(fallbackHref, origin) || '/' };
}

export function navigationHref(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname + window.location.search + window.location.hash;
}

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === 'object' ? state as Record<string, unknown> : {};
}

function identifier(): string {
  return `nav_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

function readStored<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) as T : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown): void {
  memory.set(key, value);
  try { window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* In-memory navigation still works in private mode. */ }
}

let observingHistory = false;

/** Observe router.push/replace as well as native layer navigation, without reading private Next trees. */
export function subscribeNavigationChanges(listener: () => void): () => void {
  if (!observingHistory) {
    observingHistory = true;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
        original(data, unused, url);
        // Next writes history during commit; notify subscribers after that commit finishes.
        queueMicrotask(notifyNavigation);
      };
    }
  }
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
}

function notifyNavigation(): void {
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

/** Leave Next's internal state to its patched History API so useSearchParams receives URL changes. */
function changeLayerHistory(method: 'pushState' | 'replaceState', state: Record<string, unknown>, href: string): void {
  const custom = { ...state };
  delete custom.__NA;
  delete custom._N;
  delete custom.__PRIVATE_NEXTJS_INTERNALS_TREE;
  window.history[method](custom, '', href);
  notifyNavigation();
}

export function readNavigationEntry(): NavigationEntry | undefined {
  if (typeof window === 'undefined') return undefined;
  const id = historyState()[ENTRY_KEY];
  const entry = typeof id === 'string' ? readStored<NavigationEntry>(`entry:${id}`) : undefined;
  if (entry?.href === navigationHref()) return entry;
  if (pendingRestore?.href === navigationHref()) {
    const pending = readStored<NavigationEntry>(`entry:${pendingRestore.entryId}`);
    if (pending?.href === navigationHref()) return pending;
  }
  return undefined;
}

function shelfKey(element: HTMLElement): string | undefined {
  return element.closest('[data-tv-shelf]')?.querySelector('h3')?.textContent?.trim() || undefined;
}

/** Capture both the page and inner rails/dialogs, since each can scroll independently. */
export function rememberNavigationEntry(data?: Record<string, unknown>): NavigationEntry {
  const previous = readNavigationEntry();
  const scroll: ScrollPosition[] = [];
  for (const selector of ['.tv-rail__track', '.tv-film-detail', '.tv-drawer__content']) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      const key = selector === '.tv-rail__track' ? shelfKey(element) : undefined;
      scroll.push({ selector, key, index, left: element.scrollLeft, top: element.scrollTop });
    });
  }
  const entry: NavigationEntry = {
    id: previous?.id || identifier(),
    href: navigationHref(),
    x: window.scrollX,
    y: window.scrollY,
    scroll,
    data: { ...previous?.data, ...data },
  };
  writeStored(`entry:${entry.id}`, entry);
  window.history.replaceState({ ...historyState(), [ENTRY_KEY]: entry.id }, '');
  return entry;
}

/** Restore after cached data/dialogs have mounted; stop promptly if the user starts navigating. */
export function restoreNavigationEntry(): () => void {
  const entry = readNavigationEntry();
  if (!entry) return () => {};
  if (pendingRestore?.entryId === entry.id) pendingRestore = undefined;
  window.history.replaceState({ ...historyState(), [ENTRY_KEY]: entry.id }, '');
  const href = navigationHref();
  let frame = 0;
  let raf = 0;
  let cancelled = false;
  const stop = () => { cancelled = true; window.cancelAnimationFrame(raf); };
  const apply = () => {
    if (cancelled || navigationHref() !== href) return;
    let ready = true;
    for (const saved of entry.scroll) {
      const candidates = document.querySelectorAll<HTMLElement>(saved.selector);
      const element = saved.key ? Array.from(candidates).find((candidate) => shelfKey(candidate) === saved.key) : candidates[saved.index];
      if (!element) { ready = false; continue; }
      element.scrollTo({ left: saved.left, top: saved.top, behavior: 'instant' });
      if (Math.abs(element.scrollLeft - saved.left) > 1 || Math.abs(element.scrollTop - saved.top) > 1) ready = false;
    }
    window.scrollTo({ left: entry.x, top: entry.y, behavior: 'instant' });
    if (Math.abs(window.scrollY - entry.y) > 1) ready = false;
    // At least two frames allow focus traps and Next scroll handling to settle.
    if ((!ready || frame < 2) && ++frame < 300) raf = window.requestAnimationFrame(apply);
  };
  raf = window.requestAnimationFrame(apply);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, stop, { once: true, passive: true });
  return () => {
    stop();
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.removeEventListener(event, stop);
  };
}

export function readNavigationLayer<T>(name: string): NavigationLayer<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  const id = new URLSearchParams(window.location.search).get(name);
  if (!id || !/^nav_[\w-]+$/.test(id)) return undefined;
  const layer = readStored<NavigationLayer<T>>(`layer:${id}`);
  return layer?.id === id ? layer : undefined;
}

export function openNavigationLayer<T>(name: string, data: T): void {
  const parent = rememberNavigationEntry();
  const id = identifier();
  writeStored(`layer:${id}`, { id, data });
  const url = new URL(window.location.href);
  url.searchParams.set(name, id);
  const href = url.pathname + url.search + url.hash;
  const newLayerSelector = name === 'detail' ? '.tv-film-detail' : '.tv-drawer__content';
  const entry = { ...parent, id: identifier(), href, scroll: parent.scroll.filter((saved) => saved.selector !== newLayerSelector) };
  writeStored(`entry:${entry.id}`, entry);
  changeLayerHistory('pushState', { ...historyState(), [ENTRY_KEY]: entry.id, [LAYER_KEY]: { name, id } }, href);
}

export function updateNavigationLayerUi(name: string, ui: Record<string, unknown>): void {
  const layer = readNavigationLayer<unknown>(name);
  if (layer) writeStored(`layer:${layer.id}`, { ...layer, ui: { ...layer.ui, ...ui } });
}

export function closeNavigationLayer(name: string): void {
  const layer = readNavigationLayer<unknown>(name);
  const marker = historyState()[LAYER_KEY] as { name?: string; id?: string } | undefined;
  if (layer && marker?.name === name && marker.id === layer.id) { window.history.back(); return; }
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  changeLayerHistory('replaceState', historyState(), url.pathname + url.search + url.hash);
}

/** Call only for a same-tab page navigation, immediately before router.push. */
export function preparePageNavigation(href: string): string {
  const entry = rememberNavigationEntry();
  pendingWatchReturn = { entryId: entry.id, href: entry.href };
  return watchUrlWithReturnTo(href, entry.href, window.location.origin, entry.id);
}

/** A source/episode change stays in the current playback visit. */
export function prepareWatchNavigation(watchHref: string): string {
  if (window.location.pathname === '/watch') return preserveWatchReturn(watchHref, window.location.href, window.location.origin);
  return preparePageNavigation(watchHref);
}

/** A history marker proves the previous entry is our own caller, unlike history.length/referrer. */
export function rememberWatchReturn(): WatchReturnContext | undefined {
  const params = new URLSearchParams(window.location.search);
  const entryId = params.get('returnEntry');
  const href = safeReturnTo(params.get('returnTo'), window.location.origin);
  const stored = historyState()[WATCH_KEY] as WatchReturnContext | undefined;
  const context = pendingWatchReturn?.entryId === entryId ? pendingWatchReturn : stored;
  pendingWatchReturn = undefined;
  if (!context || context.entryId !== entryId || context.href !== href) return undefined;
  window.history.replaceState({ ...historyState(), [WATCH_KEY]: context }, '');
  return context;
}

export function preserveWatchReturnMarker(context: WatchReturnContext | undefined): void {
  if (context) window.history.replaceState({ ...historyState(), [WATCH_KEY]: context }, '');
}

export function markNavigationReturn(context: WatchReturnContext): void { pendingRestore = context; }

export function isPlainNavigation(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
