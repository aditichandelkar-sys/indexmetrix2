import { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/app-config';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  let baseUrl = 'https://indexmetrix.com';
  try {
    const candidate = getAppBaseUrl();
    if (candidate && !candidate.includes('localhost') && !candidate.includes('127.0.0.1')) {
      baseUrl = candidate;
    }
  } catch {
    baseUrl = 'https://indexmetrix.com';
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/dashboard/',
          '/settings/',
          '/projects/',
          '/urls/',
          '/credits/',
          '/monitoring/',
          '/import/',
          '/inspection/',
          '/quick-index/',
          '/jobs/',
          '/payments/',
          '/transactions/',
          '/api-keys/',
          '/google/',
          '/sitemaps/',
          '/properties/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
