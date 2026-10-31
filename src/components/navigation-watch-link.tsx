'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { isPlainNavigation, prepareWatchNavigation, watchUrlWithReturnTo } from '@/lib/navigation';
import { useNavigationLocation } from '@/lib/navigation-hooks';

/** Modified clicks retain normal Link behavior; only a same-tab visit gets a browser-Back marker. */
export function NavigationWatchLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const router = useRouter();
  const current = useNavigationLocation();
  const target = current ? watchUrlWithReturnTo(href, current, window.location.origin) : href;
  return <Link {...props} href={target} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || !isPlainNavigation(event) || props.target === '_blank') return;
    event.preventDefault();
    router.push(prepareWatchNavigation(href));
  }} />;
}
