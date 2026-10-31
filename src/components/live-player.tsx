'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Artplayer from 'artplayer';
import Hls, { type HlsConfig } from 'hls.js';
import { Spinner } from './states';
import { PlayerChrome } from './player-chrome';
import { builtinLiveFormat } from '@/lib/default-live-sources';

/**
 * 直播播放器：与点播 player-shell 完全独立。
 * - 引擎分发：.m3u8 → hls.js（直播参数）；.flv → mpegts.js（动态加载，按需 ~150KB）；
 *   mp4/webm 等原生容器 → <video> 直接播放；
 * - 无扩展名的地址（如 /channel/xxx?token=...）默认按 HLS 处理，
 *   HLS 直连与代理均失败后**回退原生播放**一次（覆盖"内容是 MP4 却无 .m3u8 后缀"的源）；
 * - 每级直连失败自动切换到 /api/live/stream 代理通道重试一次；
 * - 直播态 UI：无进度条、无倍速、无截图、无连播。
 */

/** 代理地址前缀（新旧形式 /api/live/stream/… 与 /api/live/stream?url=… 的共同前缀，用于防二次代理） */
const STREAM_PROXY_PREFIX = '/api/live/stream';
/** 代理地址（查询串形式：路径里的 %2F 会被 EdgeOne 等网关归一化，查询串不受影响） */
const STREAM_PROXY_BASE = '/api/live/stream?url=';

export function isFlvUrl(url: string): boolean {
  return builtinLiveFormat(url) === 'flv' || /\.flv(\?|$)/i.test(url);
}

/** 浏览器原生可播的直链容器（非 HLS/FLV） */
const NATIVE_MEDIA_RE = /\.(mp4|m4v|webm|ogv|ogg|mov)(\?|$)/i;

type Engine = 'hls' | 'flv' | 'native';

function engineOf(url: string): Engine {
  if (isFlvUrl(url)) return 'flv';
  if (NATIVE_MEDIA_RE.test(url)) return 'native';
  return 'hls';
}

function proxyUrl(url: string): string {
  return STREAM_PROXY_BASE + encodeURIComponent(url);
}

interface LivePlayerProps {
  /** 上游直播流地址（直连优先，失败自动走代理） */
  url: string;
  title: string;
  /** 上一台/下一台：传入时注册为播放器控制条按钮（全屏内也可操作） */
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  onNextLine?: () => void;
  items?: readonly string[];
  currentItem?: number;
  onSelectItem?: (index: number) => void;
  onBack?: () => void;
}

export function LivePlayer({ url, title, onPrevChannel, onNextChannel, onNextLine, items, currentItem, onSelectItem, onBack }: LivePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);
  const loadMediaRef = useRef<((video: HTMLVideoElement) => void) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mpegtsRef = useRef<any>(null);
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);
  // 手动重试计数：变化时重建整个播放器实例（比 location.reload() 轻得多）
  const [retryNonce, setRetryNonce] = useState(0);
  // 起播前的品牌占位图（与点播 player-shell 共用 /player-poster.png），实际开始播放后隐藏
  const [showPoster, setShowPoster] = useState(true);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(''), 2500);
  };

  useEffect(() => {
    if (!containerRef.current || !url) return;
    setError('');
    setHint('');
    setLoading(true);
    setShowPoster(true);

    // HTTPS 页面上的 HTTP IPTV 必须直接走同源代理，避免混合内容被浏览器拦截。
    const proxyFirst = window.location.protocol === 'https:' && /^http:/i.test(url);
    const initialMediaUrl = proxyFirst ? proxyUrl(url) : url;
    let playbackStarted = false;
    let disposed = false;
    let destroyed = false;
    /** 原生播放注册的 error 监听清理函数（切台/销毁时调用） */
    let nativeCleanup: (() => void) | null = null;

    const cleanupEngines = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (mpegtsRef.current) {
        try { mpegtsRef.current.pause(); } catch { /* 忽略 */ }
        try { mpegtsRef.current.destroy(); } catch { /* 忽略 */ }
        mpegtsRef.current = null;
      }
      if (nativeCleanup) {
        try { nativeCleanup(); } catch { /* 忽略 */ }
        nativeCleanup = null;
      }
    };

    /**
     * 原生播放：mp4/webm 等容器交给 <video> 直接播放。
     * 也作为 HLS 两级都失败后的兜底——覆盖"地址没有 .m3u8 后缀但内容其实是 MP4"的源。
     * 直连失败（CORS/混合内容）时再走一次代理。
     */
    const setupNative = (
      video: HTMLVideoElement,
      mediaUrl: string,
      allowProxyFallback: boolean,
      failMessage?: string
    ) => {
      cleanupEngines();
      const onError = () => {
        video.removeEventListener('error', onError);
        nativeCleanup = null;
        if (disposed || destroyed) return;
        if (allowProxyFallback && !mediaUrl.startsWith(STREAM_PROXY_PREFIX)) {
          showHint('直连失败，改用代理重试...');
          setupNative(video, proxyUrl(url), false, failMessage);
          return;
        }
        setError(failMessage || '该地址不是可播放的直播流（内容可能是文件或错误提示）');
      };
      video.addEventListener('error', onError);
      nativeCleanup = () => video.removeEventListener('error', onError);
      video.src = mediaUrl;
      video.load();
      video.play().catch(() => {});
    };

    /** HLS 直播参数：小缓冲、快速追帧；与点播（大缓冲、进度恢复）刻意区分 */
    const setupHls = (video: HTMLVideoElement, mediaUrl: string, stage: 'direct' | 'proxy') => {
      cleanupEngines();
      if (!Hls.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          setupNative(video, mediaUrl, stage === 'direct');
        } else {
          setError('当前浏览器不支持此直播格式，请尝试其他浏览器或线路');
        }
        return;
      }
      let liveNetRetryCount = 0;
      let mediaRecoverCount = 0;
      const hlsConfig: Partial<HlsConfig> = {
        debug: false,
        enableWorker: true,
        liveSyncDurationCount: 3,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 800,
      };
      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;
      hls.loadSource(mediaUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, manifestData) => {
        // H.265 检测：大量国内 IPTV 源为 HEVC 编码，Chromium 内核通常无法软解
        const videoCodecs = (manifestData.levels || []).map((l) => l.videoCodec || '').join(',');
        if (/hvc1|hev1|hevc/i.test(videoCodecs)) {
          const support = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
          if (!support) {
            showHint('该频道为 H.265 编码，当前浏览器可能无法解码，建议用 Edge/Safari');
          }
        }
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (disposed || destroyed) return;
        const httpCode = data.response?.code;
        const codeHint = httpCode ? `（HTTP ${httpCode}）` : '';
        if (!data.fatal) return;
        // 媒体错误：起播前后统一尝试恢复，次数受限防止无限 recover 循环
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoverCount < 2) {
            mediaRecoverCount++;
            hls.recoverMediaError();
            return;
          }
          setError('直播流解码失败，可能该频道编码不受当前浏览器支持，请尝试其他频道');
          return;
        }
        if (!playbackStarted) {
          if (
            stage === 'direct' &&
            !mediaUrl.startsWith(STREAM_PROXY_PREFIX) &&
            (data.details === 'manifestLoadError' || data.type === Hls.ErrorTypes.NETWORK_ERROR)
          ) {
            showHint('直连失败，改用代理重试...');
            // 直播 manifest 重写需要本站前缀，交给代理通道
            setupHls(video, proxyUrl(url), 'proxy');
            return;
          }
          // HLS 直连与代理均失败：可能是"无 .m3u8 后缀但内容是 MP4"的源，回退原生播放
          showHint('HLS 解析失败，尝试原生播放...');
          setupNative(video, initialMediaUrl, !proxyFirst, `直播流加载失败${codeHint}，可尝试切换线路`);
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // 播放中网络抖动：尝试恢复拉流；连续失败达到阈值则报错退出
          liveNetRetryCount++;
          if (liveNetRetryCount > 5) {
            setError(`直播流中断${codeHint}，该源可能已失效，请尝试其他频道`);
            return;
          }
          hls.startLoad();
        }
      });
    };

    const setupFlv = async (
      video: HTMLVideoElement,
      mediaUrl: string,
      allowProxyFallback: boolean
    ) => {
      cleanupEngines();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let Mpegts: any;
      try {
        Mpegts = (await import('mpegts.js')).default;
      } catch {
        setError('FLV 播放模块加载失败，请检查网络后重试');
        return;
      }
      if (disposed || destroyed) return;
      if (!Mpegts.getFeatureList().mseLivePlayback) {
        setError('当前浏览器不支持 FLV 直播播放');
        return;
      }
      const player = Mpegts.createPlayer(
        {
          type: 'flv',
          isLive: true,
          url: mediaUrl,
        },
        {
          enableWorker: false,
          enableStashBuffer: false,
          stashInitialSize: 128,
          liveBufferLatencyChasing: true,
          lazyLoad: false,
        }
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      player.on(Mpegts.Events.ERROR, (errType: string) => {
        if (disposed || destroyed) return;
        if (!playbackStarted && allowProxyFallback && !mediaUrl.startsWith(STREAM_PROXY_PREFIX)) {
          showHint('直连失败，改用代理重试...');
          void setupFlv(video, proxyUrl(url), false);
          return;
        }
        setError(`直播流加载失败（${errType}），请尝试其他频道`);
      });
      player.play().catch(() => {});
    };

    const engine = engineOf(url);
    let sourceLoaded = false;
    const loadMedia = (video: HTMLVideoElement) => {
      if (disposed || destroyed) return;
      sourceLoaded = true;
      if (engine === 'flv') void setupFlv(video, initialMediaUrl, !proxyFirst);
      else if (engine === 'native') setupNative(video, initialMediaUrl, !proxyFirst);
      else setupHls(video, initialMediaUrl, proxyFirst ? 'proxy' : 'direct');
    };
    loadMediaRef.current = loadMedia;
    const art = artRef.current || new Artplayer({
      container: containerRef.current,
      url: '',
      type: 'kongwotv-live',
      customType: { 'kongwotv-live': (video: HTMLVideoElement) => loadMediaRef.current?.(video) },
      isLive: true,
      volume: 0.9,
      autoplay: true,
      pip: true,
      screenshot: false,
      setting: false,
      playbackRate: false,
      aspectRatio: false,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: false,
      hotkey: false,
      mutex: true,
      backdrop: true,
      playsInline: true,
      airplay: true,
      theme: '#ff6699',
      lang: navigator.language.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en',
      moreVideoAttr: { playsInline: true },
    });
    if (!artRef.current) {
      artRef.current = art;
      art.template.$player.style.isolation = 'isolate';
      setOverlayRoot(art.template.$player);
    }
    const onMetadata = () => {
      try { art.title = title; } catch { /* Metadata does not gate playback. */ }
    };
    const onPlaying = () => {
      if (disposed) return;
      playbackStarted = true; setLoading(false); setShowPoster(false); setError('');
    };
    const onWaiting = () => { if (!disposed) setLoading(true); };
    const onVideoError = () => {
      if (!disposed && !mpegtsRef.current) setError('视频播放失败，请尝试其他频道');
    };
    art.on('video:loadedmetadata', onMetadata);
    art.on('video:playing', onPlaying);
    art.on('video:waiting', onWaiting);
    art.on('video:error', onVideoError);
    art.option.url = url;
    if (!sourceLoaded) loadMedia(art.video);

    const startTimer = setTimeout(() => {
      if (!playbackStarted && !disposed && !destroyed) setError('频道加载超时，可能该源已失效，请尝试其他频道');
    }, 15000);
    return () => {
      disposed = true; destroyed = true;
      clearTimeout(startTimer);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      art.off('video:loadedmetadata', onMetadata); art.off('video:playing', onPlaying);
      art.off('video:waiting', onWaiting); art.off('video:error', onVideoError);
      if (loadMediaRef.current === loadMedia) loadMediaRef.current = null;
      cleanupEngines(); art.video.pause();
    };
    // The media engine changes per source; the control root is released only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, retryNonce]);

  useEffect(() => () => {
    const art = artRef.current;
    if (!art) return;
    try { if (art.fullscreenWeb) art.fullscreenWeb = false; } catch { /* Already closed. */ }
    try {
      if (document.fullscreenElement && art.template.$player.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
      else if (art.fullscreen) art.fullscreen = false;
    } catch { /* The browser may have ended fullscreen. */ }
    art.destroy(); artRef.current = null;
  }, []);

  return (
    <div className="tv-live-player relative h-full w-full min-w-0 overflow-hidden rounded-3xl bg-black">
      <div ref={containerRef} className="w-full h-full" />
      {overlayRoot && createPortal(<>
      <PlayerChrome player={artRef.current} title={title} mediaKey={url} live unavailable={!!error}
        items={items} currentItem={currentItem} onSelectItem={onSelectItem} onBack={onBack}
        onPrevious={onPrevChannel} onNext={onNextChannel} onNextLine={onNextLine} onHint={showHint} />
      {/* 起播前的品牌占位图 */}
      {showPoster && !error && (
        <div
          className="absolute inset-0 z-10 bg-black pointer-events-none"
          style={{
            backgroundImage: 'url(/player-poster.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
          <Spinner size="lg" tone="onDark" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 sm:gap-4 sm:p-6">
          <p className="max-w-md text-center text-xs leading-relaxed text-white/70 sm:text-sm">{error}</p>
          <button
            className="btn-ghost !rounded-full !border-transparent !bg-[#f3f4f7] !px-5 !py-2 text-xs !text-[#15151a] hover:!bg-white"
            onClick={() => {
              // 重建播放器实例即可，无需整页刷新
              setError('');
              setHint('');
              setRetryNonce((n) => n + 1);
            }}
          >
            重新加载
          </button>
          {onNextLine && (
            <button className="btn-ghost !rounded-full !border-white/20 !text-white/85 text-xs" onClick={onNextLine}>
              切换下一线路
            </button>
          )}
        </div>
      )}
      {hint && (
        <div className="bili-player-hint" role="status">
          {hint}
        </div>
      )}
      </>, overlayRoot)}
    </div>
  );
}
