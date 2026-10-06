import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAppBaseUrl, getPublicFeedUrl } from '@/lib/app-config';

export async function GET() {
  try {
    const urls = await prisma.url.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        originalUrl: true,
        normalizedUrl: true,
        updatedAt: true,
      },
    });

    const rssItems = urls
      .map(
        (u) => `    <item>
      <title>Crawl Dispatch: ${escapeXml(u.normalizedUrl)}</title>
      <link>${escapeXml(u.normalizedUrl)}</link>
      <guid isPermaLink="true">${escapeXml(u.normalizedUrl)}</guid>
      <pubDate>${u.updatedAt.toUTCString()}</pubDate>
      <description>Immediate crawler ping signal for ${escapeXml(u.normalizedUrl)}</description>
    </item>`
      )
      .join('\n');

    const appUrl = getAppBaseUrl();
    const feedSelfUrl = getPublicFeedUrl();

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>INDEX MATRIX Rapid Feed</title>
    <link>${appUrl}</link>
    <description>Realtime indexing and crawl notification stream</description>
    <atom:link rel="self" href="${feedSelfUrl}" type="application/rss+xml" />
    <atom:link rel="hub" href="https://pubsubhubbub.appspot.com/" />
${rssItems}
  </channel>
</rss>`;

    return new NextResponse(rssXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err: any) {
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

function escapeXml(unsafe: string) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}
