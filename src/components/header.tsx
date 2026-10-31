'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useBodyScrollLock } from './use-body-scroll-lock';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { isTopFocusLayer, useFocusTrap } from './use-focus-trap';
import { cn } from '@/lib/utils';

type HeaderPage = 'home' | 'movies' | 'tv' | 'shows' | 'live' | 'about';
const navigationItems = [
  { page: 'home', href: '/', label: '立即观看', icon: <><rect x="3" y="4" width="18" height="14" rx="3" /><path d="m10 8 5 3-5 3M8 21h8" /></> },
  { page: 'movies', href: '/?view=movies', label: '电影', icon: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></> },
  { page: 'tv', href: '/?view=tv', label: '剧集', icon: <><rect x="3" y="5" width="18" height="13" rx="3" /><path d="M8 21h8M12 18v3" /></> },
  { page: 'shows', href: '/?view=shows', label: '综艺', icon: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /> },
  { page: 'live', href: '/live', label: '电视直播', icon: <><circle cx="12" cy="12" r="1.5" /><path d="M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7" /></> },
] as const;

function NavIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

/** Persistent content sidebar on large screens, touch tab bar on phones. */
export function Header({ showSearch = false, activePage }: { showSearch?: boolean; activePage?: HeaderPage | null }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(showSearch);
  const currentPage = activePage === null ? undefined : activePage ?? (pathname === '/' ? 'home' : pathname.startsWith('/live') ? 'live' : pathname.startsWith('/about') ? 'about' : undefined);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener('kongwotv:open-settings', openSettings);
    return () => window.removeEventListener('kongwotv:open-settings', openSettings);
  }, []);

  return (
    <>
      <a href="#main-content" className="tv-skip-link">跳到内容</a>
      <header className="tv-sidebar" aria-label="幕里 导航" onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || window.innerWidth < 768) return;
        const target = event.target as HTMLElement;
        if (!target.matches('.tv-sidebar__item, .tv-sidebar__search')) return;
        if (event.key === 'ArrowRight') {
          const content = document.querySelector<HTMLElement>('main .tv-premiere__play, main [data-tv-card]');
          if (content) { event.preventDefault(); content.focus({ preventScroll: true }); content.scrollIntoView({ block: 'nearest' }); }
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.tv-sidebar__search, .tv-sidebar__item')).filter((element) => element.getClientRects().length > 0);
          const index = controls.indexOf(target);
          const next = controls[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) { event.preventDefault(); next.focus({ preventScroll: true }); }
        }
      }}>
        <Link href="/" className="tv-sidebar__brand" aria-label="幕里 首页">
          <Image src="/brand/muli-mark-black.png" alt="" width={40} height={40} priority />
          <span>幕里</span>
        </Link>
        <button type="button" className="tv-sidebar__search" onClick={() => setSearchOpen(true)} aria-label="搜索" aria-haspopup="dialog">
          <Icon name="search" /><span>搜索</span><kbd>⌕</kbd>
        </button>
        <nav className="tv-sidebar__navigation" aria-label="主导航">
          {navigationItems.map(({ page, href, label, icon }) => (
            <Link key={page} href={href} className={cn('tv-sidebar__item', currentPage === page && 'is-active')} aria-current={currentPage === page ? 'page' : undefined} title={label}>
              <NavIcon>{icon}</NavIcon><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="tv-sidebar__library">
          <p className="tv-sidebar__label">资料库</p>
          <Link href="/#my-watchlist" className="tv-sidebar__item" title="我的片单"><NavIcon><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" /></NavIcon><span>我的片单</span></Link>
          <button type="button" className="tv-sidebar__item" onClick={() => setHistoryOpen(true)} aria-label="观看历史" aria-haspopup="dialog" title="观看历史"><Icon name="clock" /><span>观看历史</span></button>
          <button type="button" className="tv-sidebar__item" onClick={requestShowDownloadManager} aria-label="下载管理" title="下载管理"><Icon name="download" /><span>下载管理</span></button>
        </div>
        <div className="tv-sidebar__bottom">
          <div className="tv-sidebar__profile"><span className="tv-sidebar__avatar"><Icon name="play" /></span><div><strong>你的影院</strong><span>好故事，随时继续。</span></div></div>
          <div className="tv-sidebar__preferences">
            <button type="button" className="tv-sidebar__item" onClick={() => setSettingsOpen(true)} aria-label="设置" aria-haspopup="dialog" title="设置"><Icon name="gear" /><span>设置</span></button>
            <ThemeToggle />
            <Link href="/about" className="tv-sidebar__info" aria-label="关于 幕里" title="关于 幕里"><NavIcon><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></NavIcon></Link>
          </div>
        </div>
        <div className="tv-sidebar__mobile-tools">
          <button type="button" onClick={() => setHistoryOpen(true)} aria-label="观看历史"><Icon name="clock" /></button>
          <details className="tv-mobile-more">
            <summary aria-label="更多工具" title="更多工具"><NavIcon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></NavIcon></summary>
            <div className="tv-mobile-more__menu">
              <button type="button" onClick={requestShowDownloadManager}><Icon name="download" />下载管理</button>
              <div><span>外观</span><ThemeToggle /></div>
              <Link href="/about"><NavIcon><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></NavIcon>关于 幕里</Link>
            </div>
          </details>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="设置"><Icon name="gear" /></button>
        </div>
      </header>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const searchHistory = useSearchHistory(query);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);
  useBodyScrollLock(true);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopFocusLayer(panelRef.current)) { event.preventDefault(); onClose(); } };
    panelRef.current?.querySelector('input')?.focus();
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onClose]);
  const submit = (text: string) => {
    const value = text.trim().slice(0, 100);
    if (!value) return;
    searchHistory.record(value);
    router.push(`/?s=${encodeURIComponent(value)}`, { scroll: false });
    onClose();
  };
  return (
    <div className="tv-search-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="tv-search-dialog" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" tabIndex={-1}>
        <div className="tv-search-dialog__heading"><h2 id="search-dialog-title">寻找下一个好故事。</h2><button type="button" onClick={onClose} aria-label="关闭搜索"><Icon name="close" /></button></div>
        <p>搜索电影、剧集与综艺</p>
        <div ref={searchHistory.containerRef} className="relative">
          <form role="search" onSubmit={(event) => { event.preventDefault(); submit(query); }}>
            <div className="tv-search-field">
              <Icon name="search" className="tv-search-field__icon" />
              <input className="min-w-0 flex-1 bg-transparent pr-2 text-content outline-none" aria-label="搜索影片" placeholder="片名、剧集，或你想看的故事" value={query} maxLength={100} onChange={(event) => { setQuery(event.target.value); searchHistory.resetActive(); }} onFocus={searchHistory.onFocus} onKeyDown={(event) => searchHistory.onKeyDown(event, submit)} role="combobox" aria-expanded={searchHistory.visible} aria-controls="header-search-history" aria-autocomplete="list" aria-activedescendant={searchHistory.visible && searchHistory.activeIndex >= 0 ? `header-search-history-${searchHistory.activeIndex}` : undefined} />
              <button type="submit" className="tv-search-field__submit">搜索</button>
            </div>
          </form>
          {searchHistory.visible && <SearchHistoryDropdown id="header-search-history" matches={searchHistory.matches} activeIndex={searchHistory.activeIndex} onPick={submit} onRemove={searchHistory.remove} onClearAll={searchHistory.clearAll} />}
        </div>
        <div className="tv-search-dialog__hint"><Icon name="film" /><span>所有已启用的播放源，一次搜索。</span></div>
      </div>
    </div>
  );
}
