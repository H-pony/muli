'use client';

import { useEffect } from 'react';

let locks = 0;
let previousOverflow = '';

/** Overlay transitions can overlap; only the last closing overlay unlocks the page. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) previousOverflow = document.body.style.overflow;
    locks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
