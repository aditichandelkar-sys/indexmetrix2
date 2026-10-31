/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['bullmq', 'ioredis'],
  },
  async rewrites() {
    return [
      // Rewrite /dashboard/* routes to canonical root paths
      { source: '/dashboard/urls', destination: '/urls' },
      { source: '/dashboard/projects', destination: '/projects' },
      { source: '/dashboard/import', destination: '/import' },
      { source: '/dashboard/google', destination: '/google' },
      { source: '/dashboard/sitemaps', destination: '/sitemaps' },
      { source: '/dashboard/jobs', destination: '/jobs' },
      { source: '/dashboard/monitoring', destination: '/monitoring' },
      { source: '/dashboard/credits', destination: '/credits' },
      { source: '/dashboard/payments', destination: '/payments' },
      { source: '/dashboard/api-keys', destination: '/api-keys' },
      { source: '/dashboard/settings', destination: '/settings' },
      { source: '/dashboard/quick-index', destination: '/quick-index' },
      { source: '/dashboard/admin/:path*', destination: '/admin/:path*' },

      // Navigation aliases
      { source: '/transactions', destination: '/credits' },
      { source: '/properties', destination: '/google' },
      { source: '/search-console-properties', destination: '/google' },
      { source: '/inspection', destination: '/urls' },
      { source: '/url-inspection', destination: '/urls' },
      { source: '/url-import', destination: '/import' },
      { source: '/indexing-jobs', destination: '/jobs' },
      { source: '/api-docs', destination: '/docs' },
      { source: '/api-documentation', destination: '/docs' },

      // API Redirect URI alias
      { source: '/api/v1/google/callback', destination: '/api/google/callback' },
    ];
  },
};

export default nextConfig;
