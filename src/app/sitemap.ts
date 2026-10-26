import { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/app-config';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  let baseUrl = 'https://indexmetrix.com';
  try {
    const candidate = getAppBaseUrl();
    if (candidate && !candidate.includes('localhost') && !candidate.includes('127.0.0.1')) {
      baseUrl = candidate;
    }
  } catch {
    baseUrl = 'https://indexmetrix.com';
  }

  // Real, publicly accessible, canonical pages on indexmetrix.com
  const routes = [
    { path: '', priority: 1.0, changeFrequency: 'daily' as const },
    { path: '/features', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/pricing', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/how-it-works', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/docs', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/faq', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/contact', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/privacy', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/terms', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/refund', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/login', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/register', priority: 0.5, changeFrequency: 'monthly' as const },
  ];

  const now = new Date();

  return routes.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
