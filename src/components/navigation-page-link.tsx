'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { isPlainNavigation, preparePageNavigation, watchUrlWithReturnTo } from '@/lib/navigation';
import { useNavigationLocation } from '@/lib/navigation-hooks';

/** 普通点击记录来路与滚动；新标签页保留有效的站内返回地址。 */
export function NavigationPageLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const router = useRouter();
  const current = useNavigationLocation();
  const target = current ? watchUrlWithReturnTo(href, current, window.location.origin) : href;
  return <Link {...props} href={target} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || !isPlainNavigation(event) || props.target === '_blank') return;
    event.preventDefault();
    router.push(preparePageNavigation(href));
  }} />;
}
