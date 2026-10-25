import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateUrlForSSRF } from '@/lib/ssrf';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const slug = params?.slug?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'Relay slug is required' }, { status: 400 });
  }

  let targetUrl: string | null = null;

  if (UUID_REGEX.test(slug)) {
    // 1. Valid UUID: query database by ID without catching/swallowing DB errors
    const record = await prisma.url.findUnique({
      where: { id: slug },
      select: { normalizedUrl: true, originalUrl: true },
    });

    if (!record) {
      return NextResponse.json({ error: 'Target URL not found' }, { status: 404 });
    }

    targetUrl = record.normalizedUrl || record.originalUrl;
  } else {
    // 2. Non-UUID: safely attempt base64url decoding without querying UUID DB column
    let decoded = '';
    try {
      decoded = Buffer.from(slug, 'base64url').toString('utf-8');
    } catch {
      return NextResponse.json({ error: 'Malformed base64url relay slug' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(decoded);
    } catch {
      return NextResponse.json({ error: 'Relay slug did not decode to a valid URL' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { error: `Unsupported protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are permitted.` },
        { status: 400 }
      );
    }

    targetUrl = decoded;
  }

  if (!targetUrl) {
    return NextResponse.json({ error: 'Target URL not found' }, { status: 404 });
  }

  // 3. Validate against SSRF policies (prohibits private subnets, localhost, and cloud metadata)
  const ssrf = await validateUrlForSSRF(targetUrl);
  if (!ssrf.isSafe) {
    return NextResponse.json(
      { error: `URL blocked by security policy: ${ssrf.reason}` },
      { status: 400 }
    );
  }

  // 4. 301 Permanent Redirect to target 3rd party URL for Googlebot and crawlers
  const response = NextResponse.redirect(targetUrl, 301);
  response.headers.set('X-Robots-Tag', 'index, follow');
  response.headers.set('Link', `<${targetUrl}>; rel="canonical"`);
  response.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');

  return response;
}
