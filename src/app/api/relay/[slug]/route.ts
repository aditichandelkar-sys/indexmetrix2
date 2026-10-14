import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function resolveTargetUrl(slug: string): Promise<string | null> {
  try {
    // 1. Check if slug matches URL ID
    const record = await prisma.url.findUnique({
      where: { id: slug },
      select: { normalizedUrl: true, originalUrl: true },
    });
    if (record) return record.normalizedUrl || record.originalUrl;

    // 2. Decode from base64url
    const decoded = Buffer.from(slug, 'base64url').toString('utf-8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // ignore decoding errors
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const targetUrl = await resolveTargetUrl(params.slug);

  if (!targetUrl) {
    return NextResponse.json({ error: 'Target URL not found' }, { status: 404 });
  }

  // 301 Permanent Redirect to target 3rd party URL for Googlebot and crawlers
  const response = NextResponse.redirect(targetUrl, 301);
  response.headers.set('X-Robots-Tag', 'index, follow');
  response.headers.set('Link', `<${targetUrl}>; rel="canonical"`);
  response.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');

  return response;
}
