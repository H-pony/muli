'use client';

import { useBodyScrollLock } from './use-body-scroll-lock';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';
import { isTopFocusLayer, useFocusTrap } from './use-focus-trap';

/**
 * 通用右侧抽屉骨架：
 * - 布局为 flex 纵向三段（标题栏 / 可选副标题栏 / 内容区），只有内容区滚动，
 *   调用方无需再用 sticky + 魔法数字偏移去贴标题栏；
 * - 打开时锁定 body 滚动，关闭后归还焦点，Tab 键在抽屉内循环（focus trap）；
 * - 带进入/退出过渡（水平滑入 + 遮罩淡入），退出动画结束后才卸载内容。
 */

/** 退出过渡时长，需与下方 duration-200 保持一致 */
const EXIT_MS = 200;

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
  subheader,
  closeOnOverlay = true,
  resetScrollKey,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 抽屉最大宽度类（如 max-w-lg） */
  width?: string;
  /** 固定在标题栏下方的非滚动区（如 Tab 条），随抽屉一起保持可见 */
  subheader?: ReactNode;
  /** 点击遮罩是否关闭（默认 true） */
  closeOnOverlay?: boolean;
  /** 该值变化时内容区滚回顶部（如切换设置分组 / 面板） */
  resetScrollKey?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open && mounted, panelRef);

  // 切换面板时滚回顶部：新面板不应继承上一个面板的滚动位置
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [resetScrollKey]);

  // 进入：先挂载（保持 slide-out 初态）再于下一帧切换为进入态，触发过渡
  // 退出：先回到初态，过渡结束后卸载并归还焦点
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const timer = setTimeout(() => {
      setMounted(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // 打开期间锁定背景滚动（移动端可避免滚动穿透）
  useBodyScrollLock(mounted);

  // Only the topmost dialog handles dismissal; confirmations keep their own focus.
  useEffect(() => {
    if (!open || !mounted) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopFocusLayer(panelRef.current)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, mounted, onClose]);

  if (!mounted) return null;

  return (
    <div className="tv-drawer fixed inset-0 z-50">
      <div
        className={cn(
          'tv-drawer__backdrop absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none',
          entered ? 'opacity-100' : 'opacity-0'
        )}
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'tv-drawer__panel absolute inset-y-3 right-3 flex w-[calc(100%-1.5rem)] flex-col rounded-[1.75rem] border border-line/70 bg-surface text-content shadow-[0_24px_100px_rgba(0,0,0,0.4)] outline-none sm:inset-y-5 sm:right-5 sm:w-[calc(100%-2.5rem)]',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          width,
          entered ? 'translate-x-0' : 'translate-x-[calc(100%+1.5rem)] sm:translate-x-[calc(100%+2.5rem)]'
        )}
      >
        <div className="tv-drawer__header flex shrink-0 items-center justify-between gap-4 border-b border-line/60 px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
          <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-content">{title}</h2>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon name="close" />
          </button>
        </div>
        {subheader && (
          <div className="tv-drawer__subheader shrink-0 border-b border-line/60 bg-surface px-6 py-5 sm:px-7">
            {subheader}
          </div>
        )}
        {/* 唯一滚动区：内容再长也只在这一层滚动，避免与列表内滚形成嵌套滚动 */}
        <div ref={contentRef} className="tv-drawer__content min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-7 pt-6 scrollbar-thin sm:px-7">
          {children}
        </div>
      </div>
    </div>
  );
}
