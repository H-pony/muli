'use client';

import { Children, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { NavigationPageLink } from './navigation-page-link';

export interface ContentRailProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  /** 对应分类的完整筛选页；提供时以“全部”入口替代左右翻页按钮。 */
  allHref?: string;
  allLabel?: string;
}

function scrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

/** 可触摸滚动的海报横排；分类栏使用“全部”链接，个人横排保留翻页与键盘导航。 */
export function ContentRail({ title, subtitle, children, className, allHref, allLabel = '全部' }: ContentRailProps) {
  const titleId = useId();
  const trackId = useId();
  const keyboardHintId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const itemCount = Children.count(children);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const update = () => {
      const left = track.scrollLeft > 1;
      const right = track.scrollLeft + track.clientWidth < track.scrollWidth - 1;
      setCanScroll((previous) => (
        previous.left === left && previous.right === right ? previous : { left, right }
      ));
    };

    update();
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(track);

    return () => {
      track.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [itemCount]);

  const scroll = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: scrollBehavior() });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const track = trackRef.current;
    if (!track) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const scope = track.closest('[role="dialog"]') ?? track.closest('main') ?? document;
      const shelves = Array.from(scope.querySelectorAll<HTMLElement>('[data-tv-shelf]')).filter((shelf) => shelf.querySelector('[data-tv-card]'));
      const currentShelf = track.closest('[data-tv-shelf]');
      const index = shelves.findIndex((shelf) => shelf === currentShelf);
      const next = shelves[index + (event.key === 'ArrowDown' ? 1 : -1)];
      const currentRect = target.getBoundingClientRect();
      const center = currentRect.left + currentRect.width / 2;
      const candidates = next ? Array.from(next.querySelectorAll<HTMLElement>('[data-tv-card]')) : [];
      const nextTrack = next?.querySelector('.tv-rail__track')?.getBoundingClientRect();
      const visible = candidates.filter((card) => {
        const rect = card.getBoundingClientRect();
        return nextTrack && rect.right > nextTrack.left && rect.left < nextTrack.right;
      });
      const nearest = visible.sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.clientWidth / 2 - center) - Math.abs(b.getBoundingClientRect().left + b.clientWidth / 2 - center))[0]
        ?? (index === 0 && event.key === 'ArrowUp' ? scope.querySelector<HTMLElement>('.tv-premiere__play') : null);
      if (nearest) {
        event.preventDefault();
        nearest.focus({ preventScroll: true });
        nearest.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'nearest' });
      }
      return;
    }
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const cards = Array.from(track.children).flatMap((container) => {
      const card = container.querySelector<HTMLElement>('[data-tv-card], button:not([disabled]), a[href], [tabindex="0"]');
      return card ? [{ container, card }] : [];
    });
    if (cards.length === 0) return;

    const currentIndex = cards.findIndex(({ container }) => container.contains(target));
    if (currentIndex === 0 && direction === -1 && !track.closest('[role="dialog"]')) {
      const navigation = document.querySelector<HTMLElement>('.tv-sidebar__navigation [aria-current="page"]');
      if (navigation) { event.preventDefault(); navigation.focus({ preventScroll: true }); return; }
    }
    const nextIndex = currentIndex < 0
      ? (direction === 1 ? 0 : cards.length - 1)
      : Math.max(0, Math.min(cards.length - 1, currentIndex + direction));
    event.preventDefault();
    const nextCard = cards[nextIndex].card;
    nextCard.focus({ preventScroll: true });
    nextCard.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'nearest' });
  };

  return (
    <section className={cn('tv-rail min-w-0 max-w-full', className)} data-tv-shelf="" aria-labelledby={titleId}>
      <div className="tv-rail__header mb-1 flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h3 id={titleId} className="tv-rail__title text-lg font-semibold tracking-tight text-content sm:text-xl">{title}</h3>
          {subtitle && <p className="tv-rail__subtitle mt-1 text-xs leading-relaxed text-muted sm:text-sm">{subtitle}</p>}
        </div>
        <div className="tv-rail__controls flex shrink-0 items-center gap-2">
          {allHref && (
            <NavigationPageLink
              href={allHref}
              className="tv-rail__all inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-chip/60 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={`${title}：${allLabel}`}
            >
              {allLabel}
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="m9 5 7 7-7 7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </NavigationPageLink>
          )}
          <button
            type="button"
            className="tv-rail__arrow flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface/80 text-content transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-25 motion-reduce:transition-none sm:h-9 sm:w-9"
            aria-label={`${title}：向左滚动`}
            aria-controls={trackId}
            disabled={!canScroll.left}
            onClick={() => scroll(-1)}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m14 6-6 6 6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="tv-rail__arrow flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface/80 text-content transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-25 motion-reduce:transition-none sm:h-9 sm:w-9"
            aria-label={`${title}：向右滚动`}
            aria-controls={trackId}
            disabled={!canScroll.right}
            onClick={() => scroll(1)}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m10 6 6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <p id={keyboardHintId} className="sr-only">使用左右方向键在海报间移动，按 Enter 或空格键选择。</p>
      <div
        ref={trackRef}
        id={trackId}
        className="tv-rail__track flex min-w-0 max-w-full snap-x snap-proximity items-start gap-3 overflow-x-auto overscroll-x-contain rounded-xl px-1 pb-6 pt-3 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 motion-reduce:scroll-auto sm:gap-4"
        role="list"
        aria-labelledby={titleId}
        aria-describedby={keyboardHintId}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {Children.map(children, (child) => child == null ? null : (
          <div role="listitem" className="tv-rail__item w-[144px] shrink-0 snap-start sm:w-[176px] lg:w-[196px] xl:w-[208px]">
            {child}
          </div>
        ))}
      </div>
    </section>
  );
}
