import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preserveWatchReturn, safeReturnTo, watchBackPlan, watchUrlWithReturnTo } from './navigation';

const ORIGIN = 'https://tv.example';

describe('safe playback return destinations', () => {
  it('keeps search, category, layer and fragment on local URLs', () => {
    const href = '/?s=%E6%98%9F%E9%99%85&view=movies&detail=nav_film#episodes';
    expect(safeReturnTo(href, ORIGIN)).toBe(href);
    expect(safeReturnTo(ORIGIN + href, ORIGIN)).toBe(href);
  });

  it.each([
    'https://evil.example/path', '//evil.example/path', '/\\evil.example',
    'javascript:alert(1)', 'data:text/html,hello', 'https://tv.example.evil.example/',
    'https://user:password@tv.example/', '/watch?source=a', '/watch/other', '/%77atch?source=a',
    '/api/auth', '/%61pi/status', '/%2fevil.example', '/%5cevil.example', '/foo\nbar', '',
  ])('rejects unsafe or recursive destination %j', (value) => {
    expect(safeReturnTo(value, ORIGIN)).toBeUndefined();
  });

  it('carries the original caller through source and episode replacements', () => {
    const initial = watchUrlWithReturnTo('/watch?source=a&id=1&index=0', '/?s=star&detail=nav_film', ORIGIN, 'nav_entry');
    const changed = preserveWatchReturn('/watch?source=b&id=2&index=3', initial, ORIGIN);
    const params = new URL(changed, ORIGIN).searchParams;
    params.set('index', '4');
    const next = `/watch?${params}`;
    expect(watchBackPlan(next, ORIGIN, { entryId: 'nav_entry', href: '/?s=star&detail=nav_film' })).toEqual({
      kind: 'back', href: '/?s=star&detail=nav_film', entryId: 'nav_entry',
    });
    expect(params.get('source')).toBe('b');
    expect(params.get('index')).toBe('4');
  });

  it('does not trust an arbitrary returnEntry or external referrer as browser history proof', () => {
    const href = watchUrlWithReturnTo('/watch?source=a', '/?view=tv', ORIGIN, 'nav_copied');
    expect(watchBackPlan(href, ORIGIN)).toEqual({ kind: 'replace', href: '/?view=tv' });
    expect(watchBackPlan(href, ORIGIN, { entryId: 'nav_other', href: '/?view=tv' })).toEqual({ kind: 'replace', href: '/?view=tv' });
    expect(watchBackPlan('/watch?returnTo=https%3A%2F%2Fevil.example', ORIGIN, undefined, 'https://evil.example')).toEqual({ kind: 'replace', href: '/' });
    expect(watchBackPlan('/watch', ORIGIN, undefined, ORIGIN + '/?s=star')).toEqual({ kind: 'replace', href: '/?s=star' });
    expect(watchBackPlan('/watch', ORIGIN, undefined, ORIGIN + '/watch?source=old')).toEqual({ kind: 'replace', href: '/' });
  });
});

function browserAt(href: string) {
  const events = new EventTarget();
  const stack: { href: string; state: unknown }[] = [{ href: new URL(href, ORIGIN).href, state: { __NA: true } }];
  let index = 0;
  const storage = new Map<string, string>();
  const history = {
    get state() { return stack[index].state; },
    get length() { return stack.length; },
    pushState(state: unknown, _unused: string, url?: string | URL | null) {
      stack.splice(index + 1);
      stack.push({ state, href: url == null ? stack[index].href : new URL(url, stack[index].href).href });
      index++;
    },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) {
      stack[index] = { state, href: url == null ? stack[index].href : new URL(url, stack[index].href).href };
    },
    back() { if (index > 0) { index--; events.dispatchEvent(new Event('popstate')); } },
    forward() { if (index + 1 < stack.length) { index++; events.dispatchEvent(new Event('popstate')); } },
  };
  const fake = {
    get location() { return new URL(stack[index].href); },
    history,
    scrollX: 0,
    scrollY: 720,
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  vi.stubGlobal('window', fake);
  vi.stubGlobal('document', { querySelectorAll: () => [] });
  return fake;
}

describe('previous-operation history', () => {
  let nav: typeof import('./navigation');
  beforeEach(async () => {
    vi.resetModules();
    nav = await import('./navigation');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns from changed source/episode to the exact nested detail, then to the prior detail and search', () => {
    const browser = browserAt('/?s=star&view=movies');
    nav.rememberNavigationEntry({ homeVisibleCount: 120 });
    nav.openNavigationLayer('detail', { title: 'first film' });
    const firstHref = nav.navigationHref();
    nav.updateNavigationLayerUi('detail', { selected: 'source-a', reversed: true });
    nav.openNavigationLayer('detail', { title: 'related film' });
    const relatedHref = nav.navigationHref();
    nav.updateNavigationLayerUi('detail', { selected: 'source-b', searchEnabled: true });
    const watch = nav.prepareWatchNavigation('/watch?source=b&id=film&index=0');
    browser.history.pushState({}, '', watch);
    const context = nav.rememberWatchReturn();
    expect(context?.href).toBe(relatedHref);
    const switched = nav.preserveWatchReturn('/watch?source=c&id=film2&index=2', watch, ORIGIN);
    browser.history.replaceState({}, '', switched);
    nav.preserveWatchReturnMarker(context);
    expect(nav.watchBackPlan(nav.navigationHref(), ORIGIN, context).kind).toBe('back');
    browser.history.back();
    expect(nav.navigationHref()).toBe(relatedHref);
    expect(nav.readNavigationLayer('detail')?.data).toEqual({ title: 'related film' });
    expect(nav.readNavigationLayer('detail')?.ui).toEqual({ selected: 'source-b', searchEnabled: true });
    expect(nav.readNavigationEntry()?.data.homeVisibleCount).toBe(120);
    nav.closeNavigationLayer('detail');
    expect(nav.navigationHref()).toBe(firstHref);
    expect(nav.readNavigationLayer('detail')?.ui).toEqual({ selected: 'source-a', reversed: true });
    nav.closeNavigationLayer('detail');
    expect(nav.navigationHref()).toBe('/?s=star&view=movies');
    expect(nav.readNavigationEntry()?.y).toBe(720);
    browser.history.forward();
    expect(nav.readNavigationLayer('detail')?.data).toEqual({ title: 'first film' });
  });

  it('restores the history drawer and its filter after playback, including browser Back/Forward', () => {
    const browser = browserAt('/?view=tv');
    nav.openNavigationLayer('history', {});
    const drawerHref = nav.navigationHref();
    nav.updateNavigationLayerUi('history', { query: '星际' });
    browser.history.pushState({}, '', nav.prepareWatchNavigation('/watch?source=a&id=1'));
    const context = nav.rememberWatchReturn();
    browser.history.back();
    expect(nav.navigationHref()).toBe(drawerHref);
    expect(nav.readNavigationLayer('history')?.ui?.query).toBe('星际');
    nav.closeNavigationLayer('history');
    expect(nav.navigationHref()).toBe('/?view=tv');
    browser.history.forward();
    expect(nav.readNavigationLayer('history')?.ui?.query).toBe('星际');
    browser.history.forward();
    expect(nav.rememberWatchReturn()).toEqual(context);
  });

  it('keeps the category feed and its loaded pages behind the full filter page', () => {
    const browser = browserAt('/?view=movies');
    nav.rememberNavigationEntry({ discoveryQuery: 'movies', discoveryPageCount: 4 });
    const browse = nav.preparePageNavigation('/browse/movies?genre=剧情');
    browser.history.pushState({}, '', browse);
    const caller = nav.rememberWatchReturn();
    expect(caller?.href).toBe('/?view=movies');
    nav.openNavigationLayer('detail', { title: 'filtered film' });
    const detailHref = nav.navigationHref();
    browser.history.pushState({}, '', nav.prepareWatchNavigation('/watch?source=a&id=3'));
    const playbackCaller = nav.rememberWatchReturn();
    expect(playbackCaller?.href).toBe(detailHref);
    browser.history.back();
    expect(nav.readNavigationLayer('detail')?.data).toEqual({ title: 'filtered film' });
    nav.closeNavigationLayer('detail');
    expect(nav.navigationHref()).toBe(browse);
    expect(nav.watchBackPlan(browse, ORIGIN, caller).kind).toBe('back');
    browser.history.back();
    expect(nav.readNavigationEntry()?.data.discoveryPageCount).toBe(4);
    expect(nav.readNavigationEntry()?.y).toBe(720);
  });

  it('uses a safe category fallback for a directly opened filter page', () => {
    expect(watchBackPlan('/browse/shows', ORIGIN, undefined, undefined, '/?view=shows')).toEqual({
      kind: 'replace', href: '/?view=shows',
    });
    expect(watchBackPlan('/browse/shows', ORIGIN, undefined, undefined, 'https://evil.example')).toEqual({
      kind: 'replace', href: '/',
    });
  });

  it('uses a local replacement for copied playback links with no known same-tab caller', () => {
    const browser = browserAt('/?s=star');
    const watch = nav.prepareWatchNavigation('/watch?source=a&id=1');
    browser.history.pushState({}, '', watch);
    nav.rememberWatchReturn();
    // An independently opened/copied entry has no private history marker.
    browser.history.replaceState({}, '', watch);
    expect(nav.rememberWatchReturn()).toBeUndefined();
    expect(nav.watchBackPlan(watch, ORIGIN)).toEqual({ kind: 'replace', href: '/?s=star' });
  });

  it('keeps navigation functional when session storage is unavailable', () => {
    const browser = browserAt('/?view=shows');
    browser.sessionStorage.setItem = () => { throw new Error('storage denied'); };
    browser.sessionStorage.getItem = () => { throw new Error('storage denied'); };
    nav.openNavigationLayer('detail', { title: 'show' });
    expect(nav.readNavigationLayer('detail')?.data).toEqual({ title: 'show' });
    nav.closeNavigationLayer('detail');
    expect(nav.navigationHref()).toBe('/?view=shows');
  });

  it('restores the original shelves when a new continue-watching shelf shifts their DOM order', () => {
    const browser = browserAt('/');
    const frameQueue: FrameRequestCallback[] = [];
    Object.assign(browser, {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frameQueue.push(callback); return frameQueue.length; },
      cancelAnimationFrame: () => {},
      scrollTo: ({ left, top }: { left: number; top: number }) => { browser.scrollX = left; browser.scrollY = top; },
    });
    const rail = (heading: string, left: number) => ({
      scrollLeft: left, scrollTop: 0,
      closest: () => ({ querySelector: () => ({ textContent: heading }) }),
      scrollTo({ left, top }: { left: number; top: number }) { this.scrollLeft = left; this.scrollTop = top; },
    });
    const movies = rail('本周电影榜', 140);
    const dramas = rail('热门电视剧', 320);
    let tracks = [movies, dramas];
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector === '.tv-rail__track' ? tracks : [] });
    nav.rememberNavigationEntry();
    const inserted = rail('继续观看', 0);
    movies.scrollLeft = 0;
    dramas.scrollLeft = 0;
    tracks = [movies, inserted, dramas];
    const cleanup = nav.restoreNavigationEntry();
    frameQueue.shift()!(0);
    expect(movies.scrollLeft).toBe(140);
    expect(dramas.scrollLeft).toBe(320);
    expect(inserted.scrollLeft).toBe(0);
    cleanup();
  });

  it('notifies subscribers after router commits without discarding existing history data', async () => {
    const browser = browserAt('/');
    const listener = vi.fn();
    const unsubscribe = nav.subscribeNavigationChanges(listener);
    browser.history.pushState({ __NA: true, retained: 1 }, '', '/?view=movies');
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    expect(browser.history.state).toEqual({ __NA: true, retained: 1 });
    unsubscribe();
  });
});
