import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { normalizeUrl, findBestMatchingProperty } from '@/lib/property-matcher';
import { validateUrlForSSRF } from '@/lib/ssrf';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const addUrlSchema = z.object({
  projectId: z
    .string({
      required_error: 'Please select a project before submitting a URL.',
      invalid_type_error: 'Please select a project before submitting a URL.',
    })
    .trim()
    .min(1, 'Please select a project before submitting a URL.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
  url: z.string({ required_error: 'URL is required' }).min(4, 'URL is required').trim(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Scope to user's projects unless OWNER
    if (user.role !== 'OWNER') {
      where.project = { userId: user.id };
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      where.normalizedUrl = { contains: search };
    }

    const baseProjectWhere = user.role === 'OWNER'
      ? (projectId ? { projectId } : {})
      : { project: { userId: user.id }, ...(projectId ? { projectId } : {}) };

    const [urls, total, statusGroups] = await Promise.all([
      prisma.url.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, domain: true } },
          matchedProperty: { select: { id: true, propertyUrl: true } },
          analyses: {
            orderBy: { analyzedAt: 'desc' },
            take: 1,
            select: { httpStatus: true, passedAudit: true, issues: true, analyzedAt: true },
          },
          inspections: {
            orderBy: { inspectedAt: 'desc' },
            take: 1,
            select: { verdict: true, coverageState: true, inspectedAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.url.count({ where }),
      prisma.url.groupBy({
        by: ['status'],
        where: baseProjectWhere,
        _count: { _all: true },
      }),
    ]);

    const stats: Record<string, number> = {};
    for (const g of statusGroups) {
      stats[g.status] = g._count._all;
    }

    return NextResponse.json({
      success: true,
      urls,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    // Safe diagnostic logging (strictly no tokens, keys, passwords, or secrets)
    console.log('[Safe Diagnostic] POST /api/urls:', {
      projectIdExists: body?.projectId !== undefined && body?.projectId !== null && body?.projectId !== '',
      projectIdType: typeof body?.projectId,
      projectIdFormatValidUUID: typeof body?.projectId === 'string' && UUID_REGEX.test(body.projectId),
      submittedUrlType: typeof body?.url,
      authenticatedUserExists: !!user,
    });

    const parsed = addUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { projectId, url: rawUrl } = parsed.data;

    // Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: {
        properties: true,
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found or unauthorized' }, { status: 404 });
    }

    const { url: parsedUrl, error } = normalizeUrl(rawUrl);
    if (!parsedUrl || error) {
      return NextResponse.json({ success: false, error: `Invalid URL: ${error}` }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ success: false, error: 'Only HTTP and HTTPS protocols are supported.' }, { status: 400 });
    }

    const normalizedUrl = parsedUrl.toString();

    // SSRF Protection
    const ssrfCheck = await validateUrlForSSRF(normalizedUrl);
    if (!ssrfCheck.isSafe) {
      return NextResponse.json(
        { success: false, error: `URL security policy violation: ${ssrfCheck.reason}` },
        { status: 403 }
      );
    }

    const hostname = parsedUrl.hostname;
    const path = parsedUrl.pathname + parsedUrl.search;

    // Check if property matches
    const match = findBestMatchingProperty(normalizedUrl, project.properties);

    const urlRecord = await prisma.url.upsert({
      where: {
        projectId_normalizedUrl: {
          projectId: project.id,
          normalizedUrl,
        },
      },
      update: {
        matchedPropertyId: match.property?.id || null,
      },
      create: {
        projectId: project.id,
        originalUrl: rawUrl,
        normalizedUrl,
        hostname,
        path,
        status: 'IMPORTED',
        matchedPropertyId: match.property?.id || null,
      },
    });

    return NextResponse.json({ success: true, url: urlRecord });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
