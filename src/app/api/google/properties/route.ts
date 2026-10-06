import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

const linkPropertySchema = z.object({
  propertyId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
});

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const accounts = await prisma.googleAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        userId: true,
        email: true,
        status: true,
        scopes: true,
        tokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        properties: {
          select: {
            id: true,
            googleAccountId: true,
            projectId: true,
            propertyUrl: true,
            permissionLevel: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
            project: { select: { id: true, name: true, domain: true } },
          },
        },
      },
    });

    return NextResponse.json({ success: true, accounts });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = linkPropertySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { propertyId, projectId } = parsed.data;

    // Verify property belongs to user's google account
    const property = await prisma.searchConsoleProperty.findFirst({
      where: {
        id: propertyId,
        googleAccount: { userId: user.id },
      },
    });

    if (!property) {
      return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 });
    }

    if (projectId) {
      // Verify project belongs to user
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: user.id,
        },
      });
      if (!project) {
        return NextResponse.json({ success: false, error: 'Target project not found' }, { status: 404 });
      }
    }

    const updated = await prisma.searchConsoleProperty.update({
      where: { id: propertyId },
      data: { projectId },
      include: { project: true },
    });

    if (projectId) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          googlePropertyId: property.id,
          googlePropertyUrl: property.propertyUrl,
        },
      });
    } else if (property.projectId) {
      await prisma.project.updateMany({
        where: { id: property.projectId, googlePropertyId: property.id },
        data: {
          googlePropertyId: null,
          googlePropertyUrl: null,
        },
      });
    }

    return NextResponse.json({ success: true, property: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
