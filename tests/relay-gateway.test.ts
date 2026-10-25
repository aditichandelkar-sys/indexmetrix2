import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { GET as getRelay } from '../src/app/api/relay/[slug]/route';
import { dispatchFastIndexing } from '../src/lib/fast-indexer';

const VALID_PROJECT_ID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';

describe('Relay Gateway Regression Test Suite', () => {
  let testProject: any;

  beforeEach(async () => {
    // Ensure test project exists in DB
    testProject = await prisma.project.findFirst();
    if (!testProject) {
      const user = await prisma.user.findFirst() || await prisma.user.create({
        data: {
          email: 'relay-tester@example.com',
          passwordHash: 'dummy',
          name: 'Relay Tester',
        },
      });
      testProject = await prisma.project.create({
        data: {
          id: VALID_PROJECT_ID,
          userId: user.id,
          name: 'Relay Test Project',
          domain: 'example.com',
        },
      });
    }
  });

  it('resolves a valid UUID slug to corresponding database URL with 301 redirect', async () => {
    const targetUrl = `https://example.com/blog/article-seo-test-${Date.now()}?page=1&sort=desc`;
    const testRecord = await prisma.url.create({
      data: {
        projectId: testProject.id,
        originalUrl: targetUrl,
        normalizedUrl: targetUrl,
        hostname: 'example.com',
        path: '/blog/article-seo-test?page=1&sort=desc',
        status: 'SUBMITTED',
      },
    });

    const req = new NextRequest(`http://localhost:3000/api/relay/${testRecord.id}`);
    const res = await getRelay(req, { params: { slug: testRecord.id } });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(targetUrl);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(res.headers.get('link')).toBe(`<${targetUrl}>; rel="canonical"`);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('returns 404 when a UUID slug does not exist in the database', async () => {
    const nonExistentUuid = '00000000-0000-4000-a000-000000000000';
    const req = new NextRequest(`http://localhost:3000/api/relay/${nonExistentUuid}`);
    const res = await getRelay(req, { params: { slug: nonExistentUuid } });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Target URL not found');
  });

  it('resolves a non-UUID base64url encoded slug without querying UUID column', async () => {
    const targetUrl = 'https://example.com/products/widget-123';
    const base64Slug = Buffer.from(targetUrl).toString('base64url');

    const req = new NextRequest(`http://localhost:3000/api/relay/${base64Slug}`);
    const res = await getRelay(req, { params: { slug: base64Slug } });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(targetUrl);
    expect(res.headers.get('x-robots-tag')).toBe('index, follow');
    expect(res.headers.get('link')).toBe(`<${targetUrl}>; rel="canonical"`);
  });

  it('preserves full path, PDF filename, and query string without truncation', async () => {
    const longPdfUrl =
      'https://exceptionalhh.com/wp-content/uploads/everest_forms_uploads/tmp/c93a9f5a0463d286267606fbc9472cb1.pdf?download=true&session=abcdef1234567890&token=xyz987';
    
    // Ensure base64url slug is significantly longer than 32 characters
    const fullSlug = Buffer.from(longPdfUrl).toString('base64url');
    expect(fullSlug.length).toBeGreaterThan(60);

    const req = new NextRequest(`http://localhost:3000/api/relay/${fullSlug}`);
    const res = await getRelay(req, { params: { slug: fullSlug } });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(longPdfUrl);
  });

  it('returns 400 when relay slug is malformed or does not decode to a valid URL', async () => {
    const malformedSlug = 'not-a-valid-url-or-uuid';
    const req = new NextRequest(`http://localhost:3000/api/relay/${malformedSlug}`);
    const res = await getRelay(req, { params: { slug: malformedSlug } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Relay slug did not decode to a valid URL');
  });

  it('returns 400 when relay slug decodes to an unsupported protocol', async () => {
    const jsSlug = Buffer.from('javascript:alert(1)').toString('base64url');
    const req = new NextRequest(`http://localhost:3000/api/relay/${jsSlug}`);
    const res = await getRelay(req, { params: { slug: jsSlug } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unsupported protocol');
  });

  it('rejects SSRF attempt to cloud metadata (169.254.169.254) with 400', async () => {
    const metadataUrl = 'http://169.254.169.254/latest/meta-data/';
    const slug = Buffer.from(metadataUrl).toString('base64url');

    const req = new NextRequest(`http://localhost:3000/api/relay/${slug}`);
    const res = await getRelay(req, { params: { slug } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('URL blocked by security policy');
  });

  it('rejects SSRF attempt to localhost with 400', async () => {
    const localhostUrl = 'http://localhost:8080/internal/metrics';
    const slug = Buffer.from(localhostUrl).toString('base64url');

    const req = new NextRequest(`http://localhost:3000/api/relay/${slug}`);
    const res = await getRelay(req, { params: { slug } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('URL blocked by security policy');
  });

  it('fast-indexer does not truncate relaySlug and supports custom relaySlug option', async () => {
    const longUrl = 'https://exceptionalhh.com/wp-content/uploads/test-document-path.pdf?auth=token123';
    const fullExpectedSlug = Buffer.from(longUrl).toString('base64url');

    // Default: full base64url without .slice(0, 32)
    const summaryDefault = await dispatchFastIndexing(longUrl, {
      appBaseUrl: 'https://indexmetrix.com',
      simulated: true,
    });
    const relayVectorDefault = summaryDefault.vectors.find((v) => v.vector === 'RELAY_GATEWAY');
    expect(relayVectorDefault?.message).toContain(`/relay/${fullExpectedSlug}`);
    expect(relayVectorDefault?.message).not.toContain(fullExpectedSlug.slice(0, 32) + ' ');

    // Custom relaySlug option (e.g. server-side UUID)
    const customId = '7b9e0f1a-2b3c-4d5e-6f7a-8b9c0d1e2f3a';
    const summaryCustom = await dispatchFastIndexing(longUrl, {
      appBaseUrl: 'https://indexmetrix.com',
      simulated: true,
      relaySlug: customId,
    });
    const relayVectorCustom = summaryCustom.vectors.find((v) => v.vector === 'RELAY_GATEWAY');
    expect(relayVectorCustom?.message).toContain(`/relay/${customId}`);
  });
});
