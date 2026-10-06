import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { createBatchIndexingJob } from '@/lib/queue';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createJobSchema = z.object({
  projectId: z
    .string({
      required_error: 'Please select a project before submitting an indexing job.',
      invalid_type_error: 'Please select a project before submitting an indexing job.',
    })
    .trim()
    .min(1, 'Please select a project before submitting an indexing job.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
  urlIds: z.array(z.string().regex(UUID_REGEX, 'Invalid URL ID')).min(1, 'At least one URL must be selected'),
  type: z.enum(['DISCOVERY_AND_INSPECTION', 'OFFICIAL_INDEXING_API', 'REINSPECT']).default('DISCOVERY_AND_INSPECTION'),
  idempotencyKey: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const skip = (page - 1) * limit;
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');

    const where: any = {};
    if (user.role !== 'OWNER') {
      where.userId = user.id;
    }
    if (projectId) {
      where.projectId = projectId;
    }
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const [jobs, total] = await Promise.all([
      prisma.indexingJob.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, domain: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.indexingJob.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      jobs,
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
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { projectId, urlIds, type, idempotencyKey } = parsed.data;

    const result = await createBatchIndexingJob({
      userId: user.id,
      projectId,
      urlIds,
      type,
      idempotencyKey,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, job: result.job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
