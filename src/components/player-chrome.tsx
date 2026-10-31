'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type Artplayer from 'artplayer';
import { formatTime } from '@/lib/utils';

interface PlayerChromeProps {
  player: Artplayer;
  title: string;
  mediaKey: string;
  live?: boolean;
  unavailable?: boolean;
  items?: readonly string[];
  currentItem?: number;
  onSelectItem?: (index: number) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onBack?: () => void;
  onSwitchSource?: () => void;
  onNextLine?: () => void;
  autoplayNext?: boolean;
  onAutoplayChange?: (enabled: boolean) => void;
  onHint?: (message: string) => void;
}

type Panel = 'speed' | 'episodes' | 'settings' | null;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const RATE_KEY = 'kongwotv.player.rate';
const FIT_KEY = 'kongwotv.player.fit';
const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value: number, maximum = 1) => Math.max(0, Math.min(maximum, value));

function storedRate() {
  try { const rate = Number(localStorage.getItem(RATE_KEY)); if (RATES.includes(rate)) return rate; } catch { /* Storage can be disabled. */ }
  return 1;
}

function snapshot(player: Artplayer) {
  const video = player.video;
  let buffered = 0;
  try { if (video.buffered.length) buffered = video.buffered.end(video.buffered.length - 1); } catch { /* Media may be switching. */ }
  return {
    paused: video.paused, position: finite(video.currentTime), duration: finite(video.duration),
    buffered: finite(buffered), volume: video.volume, muted: video.muted,
    rate: video.playbackRate, fullscreen: !!player.fullscreen, webFullscreen: !!player.fullscreenWeb,
    pip: document.pictureInPictureElement === video,
  };
}

function PlayerIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    back: <path d="m15 5-7 7 7 7" />,
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: <path d="M7 5v14M17 5v14" strokeWidth="4" />,
    next: <><path d="m5 5 10 7-10 7Z" fill="currentColor" stroke="none" /><path d="M18 5v14" /></>,
    previous: <><path d="m19 5-10 7 10 7Z" fill="currentColor" stroke="none" /><path d="M6 5v14" /></>,
    volume: <><path d="M11 4 6 8H3v8h3l5 4Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="M11 4 6 8H3v8h3l5 4Z" /><path d="m16 9 6 6m0-6-6 6" /></>,
    fullscreen: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    exit: <path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6" />,
    web: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /></>,
    pip: <><rect x="2" y="4" width="20" height="16" rx="2" /><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" /></>,
    more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="#202024" /><circle cx="15" cy="17" r="3" fill="#202024" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** The controls stay in Artplayer's fullscreen root while its media engine stays mounted. */
export function PlayerChrome(props: PlayerChromeProps) {
  const { player, title, mediaKey, live = false, unavailable = false, items = [], currentItem = 0 } = props;
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState(() => snapshot(player));
  const [visible, setVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [fill, setFill] = useState(false);
  const panelId = useId();
  const uiRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelValue = useRef<Panel>(null);
  panelValue.current = panel;
  const normalRate = useRef(1);
  const scrub = useRef<{ pointer: number; key: string; value: number; canceled: boolean } | null>(null);
  const hold = useRef<{ pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; rate: number; boosted: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const canSeek = !live && !unavailable && state.duration > 0;
  const hint = (message: string) => latest.current.onHint?.(message);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = null; };
  const reveal = () => {
    setVisible(true); clearHide();
    hideTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (!player.video.paused && !latest.current.unavailable && !panelValue.current && !scrub.current && !hold.current
        && !(focused instanceof HTMLElement && uiRef.current?.contains(focused) && focused.matches(':focus-visible'))) setVisible(false);
    }, 3500);
  };
  const cancelScrub = () => { if (scrub.current) scrub.current.canceled = true; setPreview(null); setHoverTime(null); };
  const endHold = () => {
    const active = hold.current;
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    if (active.boosted && !player.isDestroy) { player.video.playbackRate = active.rate; suppressClickUntil.current = Date.now() + 350; }
    hold.current = null;
  };
  const closePanel = () => {
    panelValue.current = null; setPanel(null); reveal();
    if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
  };
  const openPanel = (next: Exclude<Panel, null>, trigger: HTMLButtonElement) => {
    endHold(); triggerRef.current = trigger;
    const value = panelValue.current === next ? null : next;
    panelValue.current = value; setPanel(value); reveal();
  };
  const playPause = () => {
    endHold();
    if (player.video.paused) void player.video.play().catch(() => hint('请再次点击播放，或检查当前播放线路'));
    else player.video.pause();
    reveal();
  };
  const toggleFullscreen = () => {
    endHold(); cancelScrub();
    try { player.fullscreen = !player.fullscreen; } catch { hint('当前窗口无法进入全屏，请使用网页全屏'); }
    reveal();
  };
  const back = async () => {
    endHold(); cancelScrub();
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      if (player.fullscreen) { player.fullscreen = false; return; }
      if (player.fullscreenWeb) { player.fullscreenWeb = false; return; }
    } catch { /* A completed fullscreen transition can race the button. */ }
    latest.current.onBack?.();
  };
  const setRate = (rate: number) => {
    endHold(); normalRate.current = rate;
    player.video.defaultPlaybackRate = rate; player.video.playbackRate = rate;
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* Playback works without storage. */ }
    closePanel(); hint(`已切换至 ${rate} 倍速`);
  };

  useEffect(() => {
    const root = player.template.$player;
    root.classList.add('bili-player-root');
    root.classList.toggle('bili-player-root--live', !!latest.current.live);
    const sync = () => { if (!player.isDestroy) setState(snapshot(player)); };
    const applyRate = () => {
      normalRate.current = latest.current.live ? 1 : storedRate();
      player.video.defaultPlaybackRate = normalRate.current; player.video.playbackRate = normalRate.current; sync();
    };
    const cancelTransient = () => { endHold(); cancelScrub(); };
    const finishHold = () => { const active = !!hold.current; endHold(); if (active) reveal(); };
    const mediaEvents = ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'volumechange', 'ratechange', 'play', 'pause', 'emptied', 'enterpictureinpicture', 'leavepictureinpicture'];
    mediaEvents.forEach((event) => player.video.addEventListener(event, sync));
    player.video.addEventListener('loadedmetadata', applyRate);
    player.video.addEventListener('pause', reveal); player.video.addEventListener('playing', reveal);
    player.video.addEventListener('emptied', cancelTransient);
    const fullscreenError = () => hint('当前窗口无法进入全屏，请使用网页全屏（W）');
    player.on('fullscreen', sync); player.on('fullscreenWeb', sync); player.on('fullscreenError', fullscreenError);
    root.addEventListener('pointermove', reveal); root.addEventListener('focusin', reveal); root.addEventListener('focusout', reveal);
    const pointerDown = (event: PointerEvent) => {
      if (scrub.current && event.pointerId !== scrub.current.pointer) cancelScrub();
      if (!event.isPrimary) { endHold(); return; }
      if ((event.target as Element).closest('[data-player-ui], .art-controls, .art-settings')) return;
      if (event.button !== 0 || latest.current.live || player.video.paused || player.video.readyState < 2 || latest.current.unavailable) return;
      endHold();
      const active = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rate: player.video.playbackRate, boosted: false, timer: null as ReturnType<typeof setTimeout> | null };
      active.timer = setTimeout(() => {
        if (hold.current !== active || player.video.paused) return;
        active.boosted = true; player.video.playbackRate = Math.max(2, active.rate);
        hint(`临时 ${Math.max(2, active.rate)} 倍速 · 松开恢复`);
      }, 500);
      hold.current = active;
    };
    const pointerMove = (event: PointerEvent) => {
      const active = hold.current;
      if (active && !active.boosted && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) endHold();
    };
    const suppressClick = (event: Event) => {
      if (Date.now() < suppressClickUntil.current && !(event.target as Element).closest('[data-player-ui]')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape' && (panelValue.current || scrub.current)) { event.preventDefault(); event.stopPropagation(); cancelScrub(); closePanel(); return; }
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target?.closest('button') && (event.key === ' ' || event.key === 'Enter' || event.key.startsWith('Arrow'))) return;
      if (!root.getClientRects().length || latest.current.unavailable) return;
      const video = player.video;
      switch (event.key.toLowerCase()) {
        case ' ': event.preventDefault(); playPause(); break;
        case 'f': event.preventDefault(); toggleFullscreen(); break;
        case 'w': event.preventDefault(); player.fullscreenWeb = !player.fullscreenWeb; reveal(); break;
        case 'm': event.preventDefault(); video.muted = !video.muted; reveal(); break;
        case 'arrowleft': case 'arrowright':
          if (!latest.current.live && Number.isFinite(video.duration) && video.duration > 0) {
            event.preventDefault(); endHold(); video.currentTime = clamp(video.currentTime + (event.key === 'ArrowRight' ? 5 : -5), video.duration);
            hint(event.key === 'ArrowRight' ? '快进 5 秒' : '快退 5 秒'); reveal();
          }
          break;
        case 'arrowup': case 'arrowdown':
          if (!latest.current.live) { event.preventDefault(); video.muted = false; video.volume = clamp(video.volume + (event.key === 'ArrowUp' ? .1 : -.1)); hint(`音量 ${Math.round(video.volume * 100)}%`); reveal(); }
          break;
      }
    };
    const hidden = () => { if (document.hidden) cancelTransient(); };
    const resized = () => { cancelTransient(); panelValue.current = null; setPanel(null); sync(); reveal(); };
    root.addEventListener('pointerdown', pointerDown, true); root.addEventListener('click', suppressClick, true);
    window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', finishHold, true); window.addEventListener('pointercancel', finishHold, true);
    window.addEventListener('blur', cancelTransient); document.addEventListener('visibilitychange', hidden); document.addEventListener('keydown', keydown);
    document.addEventListener('fullscreenchange', resized); window.addEventListener('resize', resized);
    let initialFill = false;
    try { initialFill = localStorage.getItem(FIT_KEY) === 'cover'; } catch { /* Use the default fit. */ }
    setFill(initialFill); player.video.style.objectFit = initialFill ? 'cover' : 'contain'; applyRate(); reveal();
    return () => {
      clearHide(); endHold(); scrub.current = null;
      mediaEvents.forEach((event) => player.video.removeEventListener(event, sync));
      player.video.removeEventListener('loadedmetadata', applyRate); player.video.removeEventListener('pause', reveal); player.video.removeEventListener('playing', reveal);
      player.video.removeEventListener('emptied', cancelTransient); player.off('fullscreen', sync); player.off('fullscreenWeb', sync); player.off('fullscreenError', fullscreenError);
      root.removeEventListener('pointermove', reveal); root.removeEventListener('focusin', reveal); root.removeEventListener('focusout', reveal); root.removeEventListener('pointerdown', pointerDown, true); root.removeEventListener('click', suppressClick, true);
      window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', finishHold, true); window.removeEventListener('pointercancel', finishHold, true);
      window.removeEventListener('blur', cancelTransient); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('keydown', keydown);
      document.removeEventListener('fullscreenchange', resized); window.removeEventListener('resize', resized);
    };
    // This subscription belongs to the player; changing props are read through latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => {
    endHold(); cancelScrub(); panelValue.current = null; setPanel(null); reveal();
    normalRate.current = live ? 1 : storedRate(); player.video.defaultPlaybackRate = normalRate.current; player.video.playbackRate = normalRate.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, live, player]);
  useEffect(() => {
    if (unavailable) { endHold(); cancelScrub(); reveal(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable]);
  useEffect(() => {
    if (!panel) return;
    const frame = requestAnimationFrame(() => {
      const root = panelRef.current;
      const active = root?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') || root?.querySelector<HTMLButtonElement>('.bili-panel__options button:not(:disabled)') || root?.querySelector<HTMLButtonElement>('button');
      active?.focus({ preventScroll: true });
      const options = root?.querySelector<HTMLElement>('.bili-panel__options');
      if (active && options?.contains(active)) options.scrollTop += active.getBoundingClientRect().top - options.getBoundingClientRect().top - (options.clientHeight - active.clientHeight) / 2;
    });
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-player-ui]')) closePanel(); };
    document.addEventListener('pointerdown', outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const progress = preview ?? state.position;
  const played = state.duration ? clamp(progress / state.duration) * 100 : 0;
  const buffered = state.duration ? clamp(state.buffered / state.duration) * 100 : 0;
  const previewTime = preview ?? hoverTime;
  const pipAvailable = document.pictureInPictureEnabled && typeof player.video.requestPictureInPicture === 'function';
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const finishScrub = (event: ReactPointerEvent<HTMLInputElement>, cancel = false) => {
    const active = scrub.current;
    if (!active || active.pointer !== event.pointerId) return;
    scrub.current = null;
    if (!cancel && !active.canceled && active.key === latest.current.mediaKey && !latest.current.unavailable && !latest.current.live && state.duration > 0) {
      player.video.currentTime = clamp(active.value, state.duration);
      setState(snapshot(player));
    }
    setPreview(null); setHoverTime(null); reveal();
  };

  return (
    <div ref={uiRef} className="bili-player-ui" data-player-ui data-visible={visible || !!panel} onClick={stop} onDoubleClick={stop} onContextMenu={stop}>
      {!live && <div className="bili-mini-progress" aria-hidden="true"><span style={{ width: `${played}%` }} /></div>}
      <div className="bili-topbar" inert={!visible && !panel}>
        <button type="button" className="bili-icon-button" aria-label="返回" title="返回" onClick={() => void back()}><PlayerIcon name="back" /></button>
        <div className="bili-title" title={title}>{title}{items.length > 1 && !live && <span> · 第 {currentItem + 1} 集</span>}</div>
        {live && <span className="bili-live"><i />直播</span>}
        <span className="bili-wordmark">幕里</span>
        <button type="button" className="bili-icon-button" aria-label="更多播放设置" title="更多播放设置" aria-expanded={panel === 'settings'} aria-controls={panelId} onClick={(event) => openPanel('settings', event.currentTarget)}><PlayerIcon name="more" /></button>
      </div>
      <div className="bili-bottom" inert={!visible && !panel}>
        {!live && <div className="bili-timeline" style={{ '--bili-played': `${played}%`, '--bili-buffered': `${buffered}%` } as CSSProperties}>
          {previewTime !== null && <output className="bili-seek-preview" style={{ left: `${state.duration ? clamp(previewTime / state.duration) * 100 : 0}%` }}>{formatTime(previewTime)} / {formatTime(state.duration)}</output>}
          <input type="range" min="0" max={state.duration || 1} step="0.1" value={Math.min(progress, state.duration || 1)} disabled={!canSeek} aria-label="播放进度" aria-valuetext={`${formatTime(progress)}，共 ${formatTime(state.duration)}`}
            onPointerDown={(event) => { if (!event.isPrimary || !canSeek) return; scrub.current = { pointer: event.pointerId, key: mediaKey, value: state.position, canceled: false }; event.currentTarget.setPointerCapture(event.pointerId); reveal(); }}
            onPointerMove={(event) => { if (!canSeek) return; const rect = event.currentTarget.getBoundingClientRect(); setHoverTime(clamp((event.clientX - rect.left) / rect.width) * state.duration); }}
            onPointerLeave={() => { if (!scrub.current) setHoverTime(null); }}
            onChange={(event) => { const value = Number(event.currentTarget.value); if (scrub.current) { if (!scrub.current.canceled) { scrub.current.value = value; setPreview(value); } } else if (canSeek) { player.video.currentTime = value; setState(snapshot(player)); } }}
            onPointerUp={(event) => finishScrub(event)} onPointerCancel={(event) => finishScrub(event, true)} onLostPointerCapture={(event) => finishScrub(event, true)} />
        </div>}
        <div className="bili-toolbar">
          <div className="bili-toolbar__left">
            <button type="button" className="bili-icon-button bili-play" aria-label={state.paused ? '播放' : '暂停'} title={state.paused ? '播放（空格）' : '暂停（空格）'} disabled={unavailable} onClick={playPause}><PlayerIcon name={state.paused ? 'play' : 'pause'} /></button>
            {live && props.onPrevious && <button type="button" className="bili-icon-button" aria-label="上一台" title="上一台" onClick={() => { closePanel(); latest.current.onPrevious?.(); }}><PlayerIcon name="previous" /></button>}
            {props.onNext && <button type="button" className="bili-icon-button" aria-label={live ? '下一台' : '下一集'} title={live ? '下一台' : '下一集'} onClick={() => { closePanel(); latest.current.onNext?.(); }}><PlayerIcon name="next" /></button>}
            {live ? <span className="bili-live-time"><i />正在直播</span> : <span className="bili-time"><span>{formatTime(progress)}</span><span className="bili-time__divider">/</span>{formatTime(state.duration)}</span>}
            {props.autoplayNext && !live && <span className="bili-autoplay">自动连播</span>}
          </div>
          <div className="bili-toolbar__right">
            <div className="bili-volume">
              <button type="button" className="bili-icon-button" aria-label={state.muted ? '取消静音' : '静音'} title={`音量 ${state.muted ? 0 : Math.round(state.volume * 100)}%（M 静音）`} onClick={() => { player.video.muted = !player.video.muted; reveal(); }}><PlayerIcon name={state.muted || state.volume === 0 ? 'muted' : 'volume'} /></button>
              <input type="range" min="0" max="1" step="0.01" aria-label="音量" value={state.muted ? 0 : state.volume} onChange={(event) => { player.video.muted = false; player.video.volume = Number(event.currentTarget.value); reveal(); }} />
            </div>
            {!live && <button type="button" className="bili-text-button" aria-label="播放速度" aria-expanded={panel === 'speed'} aria-controls={panelId} onClick={(event) => openPanel('speed', event.currentTarget)}>{state.rate === 1 ? '倍速' : `${state.rate}x`}</button>}
            {items.length > 0 && props.onSelectItem && <button type="button" className="bili-text-button" aria-label={live ? '频道列表' : '选集'} aria-expanded={panel === 'episodes'} aria-controls={panelId} onClick={(event) => openPanel('episodes', event.currentTarget)}>{live ? '频道' : '选集'}</button>}
            <button type="button" className="bili-icon-button bili-settings-button" aria-label="播放设置" title="播放设置" aria-expanded={panel === 'settings'} aria-controls={panelId} onClick={(event) => openPanel('settings', event.currentTarget)}><PlayerIcon name="settings" /></button>
            {pipAvailable && <button type="button" className="bili-icon-button bili-pip-button" aria-label={state.pip ? '退出画中画' : '画中画'} title="画中画" onClick={() => { const request = document.pictureInPictureElement ? document.exitPictureInPicture() : player.video.requestPictureInPicture(); void request.catch(() => hint('当前媒体暂时无法使用画中画')); reveal(); }}><PlayerIcon name="pip" /></button>}
            <button type="button" className="bili-icon-button bili-web-button" aria-label={state.webFullscreen ? '退出网页全屏' : '网页全屏'} title="网页全屏（W）" onClick={() => { endHold(); player.fullscreenWeb = !player.fullscreenWeb; reveal(); }}><PlayerIcon name="web" /></button>
            <button type="button" className="bili-icon-button" aria-label={state.fullscreen ? '退出全屏' : '全屏'} title="全屏（F）" onClick={toggleFullscreen}><PlayerIcon name={state.fullscreen ? 'exit' : 'fullscreen'} /></button>
          </div>
        </div>
      </div>
      {panel && <div ref={panelRef} id={panelId} className={`bili-panel bili-panel--${panel}`} role="dialog" aria-label={panel === 'speed' ? '播放速度' : panel === 'episodes' ? (live ? '频道列表' : '选集') : '播放设置'} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (event.target as HTMLElement).tagName === 'BUTTON') {
          event.preventDefault(); event.stopPropagation(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = buttons.indexOf(event.target as HTMLButtonElement);
          buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }
      }}>
        <div className="bili-panel__header"><strong>{panel === 'speed' ? '播放速度' : panel === 'episodes' ? (live ? '选择频道' : '选集') : '播放设置'}</strong><button type="button" className="bili-icon-button" aria-label="关闭播放面板" onClick={closePanel}><PlayerIcon name="close" /></button></div>
        {panel === 'speed' && <div className="bili-panel__options bili-rate-options">{RATES.slice().reverse().map((rate) => <button type="button" key={rate} aria-pressed={normalRate.current === rate} onClick={() => setRate(rate)}>{rate}x{rate === 1 && <span>正常</span>}</button>)}</div>}
        {panel === 'episodes' && <div className="bili-panel__options bili-episode-options">{items.map((label, index) => <button type="button" key={index} title={label} aria-pressed={index === currentItem} onClick={() => { endHold(); cancelScrub(); closePanel(); latest.current.onSelectItem?.(index); }}>{label}</button>)}</div>}
        {panel === 'settings' && <div className="bili-panel__options bili-setting-options">
          <div className="bili-fit-options"><button type="button" aria-pressed={!fill} onClick={() => { setFill(false); player.video.style.objectFit = 'contain'; try { localStorage.setItem(FIT_KEY, 'contain'); } catch { /* optional */ } }}>适应画面</button><button type="button" aria-pressed={fill} onClick={() => { setFill(true); player.video.style.objectFit = 'cover'; try { localStorage.setItem(FIT_KEY, 'cover'); } catch { /* optional */ } }}>铺满屏幕</button></div>
          {props.onAutoplayChange && !live && <label className="bili-setting-row">自动播放下一集<input type="checkbox" checked={!!props.autoplayNext} onChange={(event) => latest.current.onAutoplayChange?.(event.currentTarget.checked)} /></label>}
          {props.onNextLine && <button type="button" onClick={() => { closePanel(); latest.current.onNextLine?.(); }}>切换下一线路</button>}
          {props.onSwitchSource && <button type="button" onClick={() => { closePanel(); latest.current.onSwitchSource?.(); }}>切换播放源</button>}
          {!live && <button type="button" disabled={player.video.readyState < 2} onClick={() => { void player.screenshot().catch(() => hint('当前视频源不允许截取画面')); }}>截取当前画面</button>}
          <p className="bili-shortcut-hint">空格 播放 / 暂停 · F 全屏 · W 网页全屏 · M 静音{!live && <><br />← / → 调整进度 · ↑ / ↓ 调整音量<br />播放中长按画面临时倍速</>}</p>
        </div>}
      </div>}
    </div>
  );
}
