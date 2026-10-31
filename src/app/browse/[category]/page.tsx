import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { CatalogBrowser } from '@/components/catalog-browser';
import { isDiscoveryCategory } from '@/lib/discovery-model';

export default async function BrowsePage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isDiscoveryCategory(category)) notFound();
  return <Suspense><CatalogBrowser category={category} /></Suspense>;
}
