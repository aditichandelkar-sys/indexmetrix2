import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

const updateProjectSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim().optional(),
  domain: z.string().min(3, 'Domain must be valid').toLowerCase().trim().optional(),
  description: z.string().optional().nullable(),
  googlePropertyId: z.string().optional().nullable(),
  googlePropertyUrl: z.string().optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const project = await prisma.project.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: {
        properties: true,
        sitemaps: true,
        indexingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: {
          select: { urls: true, sitemaps: true, indexingJobs: true, imports: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Aggregate URL statuses for honest project statistics
    const statusGroups = await prisma.url.groupBy({
      by: ['status'],
      where: { projectId: project.id },
      _count: { _all: true },
    });

    const statusCounts: Record<string, number> = {
      TOTAL: project._count.urls,
      INDEXED: 0,
      NOT_INDEXED: 0,
      DISCOVERY_PENDING: 0,
      UNINSPECTED: 0,
      BLOCKED: 0,
      ERROR: 0,
      PROCESSING: 0,
      PENDING: 0,
    };

    for (const group of statusGroups) {
      statusCounts[group.status] = group._count._all;
    }

    return NextResponse.json({
      success: true,
      project,
      statistics: statusCounts,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const project = await prisma.project.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data: any = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.domain !== undefined) {
      data.domain = parsed.data.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }

    let propertyId = parsed.data.googlePropertyId;
    let propertyUrl = parsed.data.googlePropertyUrl;

    if (propertyId || propertyUrl) {
      const prop = await prisma.searchConsoleProperty.findFirst({
        where: {
          ...(propertyId ? { id: propertyId } : {}),
          ...(propertyUrl ? { propertyUrl } : {}),
          googleAccount: user.role === 'OWNER' ? {} : { userId: user.id },
        },
      });

      if (!prop) {
        return NextResponse.json(
          { success: false, error: 'Selected Search Console property does not exist or is not authorized for your account.' },
          { status: 403 }
        );
      }
      data.googlePropertyId = prop.id;
      data.googlePropertyUrl = prop.propertyUrl;

      // Associate property with project
      await prisma.searchConsoleProperty.update({
        where: { id: prop.id },
        data: { projectId: project.id },
      });
    } else if (propertyId === null) {
      data.googlePropertyId = null;
      data.googlePropertyUrl = null;
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data,
    });

    return NextResponse.json({ success: true, project: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const project = await prisma.project.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    await prisma.project.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true, message: 'Project deleted' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
