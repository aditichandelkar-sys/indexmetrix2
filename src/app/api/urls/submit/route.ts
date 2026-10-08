import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { normalizeUrl, findBestMatchingProperty } from '@/lib/property-matcher';
import { validateUrlForSSRF } from '@/lib/ssrf';
import { isThirdPartyProject } from '@/lib/project-utils';
import { createBatchIndexingJob } from '@/lib/queue';
import { submitUrls } from '@/lib/indexinstantly';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const submitUrlSchema = z.object({
  url: z.string({ required_error: 'Target URL is required' }).min(4, 'Target URL is required').trim(),
  projectId: z
    .string({
      required_error: 'Please select a project before submitting a URL.',
      invalid_type_error: 'Please select a project before submitting a URL.',
    })
    .trim()
    .min(1, 'Please select a project before submitting a URL.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const parsed = submitUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.error.errors[0].message } },
        { status: 400 }
      );
    }

    const { url: rawUrl, projectId } = parsed.data;

    // 1. Syntax & Protocol Validation
    const { url: parsedUrl, error: urlError } = normalizeUrl(rawUrl);
    if (!parsedUrl || urlError) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_URL', message: `Invalid URL: ${urlError || 'Malformed syntax'}` } },
        { status: 400 }
      );
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PROTOCOL', message: 'Only HTTP and HTTPS protocols are supported.' } },
        { status: 400 }
      );
    }

    const normalizedUrl = parsedUrl.toString();

    // 2. SSRF Protection (localhost, 127.0.0.1, private ranges, link-local, cloud metadata)
    const ssrfCheck = await validateUrlForSSRF(normalizedUrl);
    if (!ssrfCheck.isSafe) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: `URL security policy violation: ${ssrfCheck.reason}`,
          },
        },
        { status: 403 }
      );
    }

    // 3. Verify Project & Tenant Isolation
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
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Project not found or you do not have permission to access it.',
          },
        },
        { status: 404 }
      );
    }

    const isThirdParty = isThirdPartyProject(project);

    // 4. Branch Logic Based on Project / Submission Type
    let matchedPropertyId: string | null = null;

    if (!isThirdParty) {
      // OWNED / GSC FLOW: Strictly validate Google Search Console property coverage
      const userProperties = await prisma.searchConsoleProperty.findMany({
        where: {
          googleAccount: {
            userId: user.id,
            status: 'ACTIVE',
          },
          isVerified: true,
        },
        include: {
          googleAccount: true,
        },
      });

      if (userProperties.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'NO_CONNECTED_ACCOUNT',
              message: 'No active Google Search Console accounts connected. Connect your Google account on the /google page first.',
            },
          },
          { status: 400 }
        );
      }

      const match = findBestMatchingProperty(normalizedUrl, userProperties);
      if (!match.property) {
        const authorizedList = userProperties.map((p) => p.propertyUrl).join(', ');
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'PROPERTY_NOT_AUTHORIZED',
              message: `The submitted URL is not covered by any authorized Google Search Console property connected to your account. Your authorized properties: [${authorizedList}].`,
            },
          },
          { status: 400 }
        );
      }

      matchedPropertyId = match.property.id;
    }

    // 5. Upsert URL Record
    const urlRecord = await prisma.url.upsert({
      where: {
        projectId_normalizedUrl: {
          projectId: project.id,
          normalizedUrl,
        },
      },
      update: {
        matchedPropertyId,
      },
      create: {
        projectId: project.id,
        originalUrl: rawUrl,
        normalizedUrl,
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        status: 'IMPORTED',
        matchedPropertyId,
      },
    });

    if (isThirdParty) {
      // 6a. THIRD-PARTY URL FLOW: Submit to IndexInstantly API
      const providerRes = await submitUrls([normalizedUrl]);
      if (!providerRes.success) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: providerRes.error?.code || 'PROVIDER_ERROR',
              message: providerRes.error?.message || 'Failed to submit URL to IndexInstantly',
            },
          },
          { status: providerRes.error?.statusCode || 400 }
        );
      }

      const batch = providerRes.data!;
      const batchId = batch.batch_id;

      // Update URL with provider tracking (IndexInstantly)
      const updatedUrl = await prisma.url.update({
        where: { id: urlRecord.id },
        data: {
          provider: 'INDEXINSTANTLY',
          providerBatchId: batchId,
          providerStatus: batch.status || 'queued',
          status: 'SUBMITTED',
          submittedAt: new Date(),
          lastCheckedAt: new Date(),
          providerError: null,
        } as any,
      });

      await prisma.urlStatusHistory.create({
        data: {
          urlId: urlRecord.id,
          newStatus: 'SUBMITTED',
          source: 'INDEXINSTANTLY',
          reason: `Submitted to IndexInstantly (Batch ID: ${batchId}, Status: ${batch.status || 'queued'})`,
        },
      });

      // Enqueue status monitoring in existing BullMQ queue / worker
      const jobResult = await createBatchIndexingJob({
        userId: user.id,
        projectId: project.id,
        urlIds: [urlRecord.id],
        type: 'DISCOVERY_AND_INSPECTION',
        idempotencyKey: `submit_${urlRecord.id}_${Date.now()}`,
        metadata: {
          provider: 'INDEXINSTANTLY',
          batchId,
          submittedAt: new Date().toISOString(),
        },
      });

      if (!jobResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'JOB_CREATION_FAILED',
              message: jobResult.error || 'Failed to dispatch indexing job',
            },
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        submissionType: 'THIRD_PARTY_DISCOVERY',
        url: updatedUrl,
        job: jobResult.job,
        batchId,
        provider: 'INDEXINSTANTLY',
        message: 'Third-party public URL accepted by IndexInstantly. Status monitoring enqueued.',
      });
    }

    // 6b. OWNED / GSC FLOW (Completely unchanged):
    const jobResult = await createBatchIndexingJob({
      userId: user.id,
      projectId: project.id,
      urlIds: [urlRecord.id],
      type: 'DISCOVERY_AND_INSPECTION',
      idempotencyKey: `submit_${urlRecord.id}_${Date.now()}`,
    });

    if (!jobResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'JOB_CREATION_FAILED',
            message: jobResult.error || 'Failed to dispatch indexing job',
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      submissionType: 'OWNED_GSC',
      url: urlRecord,
      job: jobResult.job,
      message: 'Owned URL successfully submitted for Google Search Console inspection and indexing discovery.',
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Unexpected submission error',
        },
      },
      { status: 500 }
    );
  }
}
