'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';

/** 幕里 独立版本信息；项目来源与许可证在关于页说明。 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="tv-site-footer border-t border-line py-4">
      <p className="text-center text-xs text-faint">
        <Link href="/about" className="hover:text-accent">
          幕里{version ? ` v${version}` : ''}
        </Link>
        {' · '}AGPL-3.0 License
      </p>
    </footer>
  );
}
