'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  subscribeNavigationChanges,
  closeNavigationLayer,
  markNavigationReturn,
  navigationHref,
  openNavigationLayer,
  preserveWatchReturnMarker,
  readNavigationLayer,
  rememberWatchReturn,
  restoreNavigationEntry,
  watchBackPlan,
  type WatchReturnContext,
} from './navigation';

/** Native History API layers also react to browser Back/Forward, without requiring a Suspense boundary. */
export function useNavigationLocation(): string {
  const [href, setHref] = useState('');
  useEffect(() => {
    const update = () => setHref(navigationHref());
    update();
    return subscribeNavigationChanges(update);
  }, []);
  return href;
}

export function useNavigationLayer<T>(name: string) {
  const href = useNavigationLocation();
  const layer = href ? readNavigationLayer<T>(name) : undefined;
  const open = useCallback((data: T) => openNavigationLayer(name, data), [name]);
  const close = useCallback(() => closeNavigationLayer(name), [name]);
  return { layer, open, close };
}

export function useNavigationScrollRestoration(): void {
  const href = useNavigationLocation();
  useEffect(() => {
    if (href) return restoreNavigationEntry();
  }, [href]);
}

export function usePageReturn(query: string, fallbackHref = '/'): () => void {
  const router = useRouter();
  const context = useRef<WatchReturnContext | undefined>(undefined);
  useEffect(() => {
    const remembered = rememberWatchReturn();
    if (remembered) context.current = remembered;
    if (watchBackPlan(window.location.href, window.location.origin, context.current).kind !== 'back') context.current = undefined;
    preserveWatchReturnMarker(context.current);
  }, [query]);
  return useCallback(() => {
    const plan = watchBackPlan(window.location.href, window.location.origin, context.current || rememberWatchReturn(), document.referrer, fallbackHref);
    const entryId = plan.entryId || new URLSearchParams(window.location.search).get('returnEntry');
    if (entryId) markNavigationReturn({ entryId, href: plan.href });
    if (plan.kind === 'back') router.back();
    else router.replace(plan.href, { scroll: false });
  }, [router, fallbackHref]);
}

export const useWatchReturn = usePageReturn;
