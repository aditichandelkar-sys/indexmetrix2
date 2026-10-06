import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { normalizeUrl, findBestMatchingProperty } from '@/lib/property-matcher';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bulkSchema = z.object({
  projectId: z
    .string({
      required_error: 'Please select a project before adding URLs.',
      invalid_type_error: 'Please select a project before adding URLs.',
    })
    .trim()
    .min(1, 'Please select a project before adding URLs.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
  rawContent: z.string().min(1, 'No content provided'),
  sourceType: z.enum(['RAW_TEXT', 'CSV', 'XML_SITEMAP', 'RSS']).default('RAW_TEXT'),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { projectId, rawContent, sourceType } = parsed.data;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: { properties: true },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Split by newlines, commas, or semicolons
    const lines = rawContent.split(/[\r\n,;]+/);
    const validMap = new Map<string, { original: string; normalized: string; hostname: string; path: string }>();
    const invalidList: Array<{ url: string; reason: string }> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Extract url from possible CSV quote
      const cleanLine = trimmed.replace(/^"|"$/g, '').trim();
      const { url: parsedUrl, error } = normalizeUrl(cleanLine);

      if (!parsedUrl || error) {
        invalidList.push({ url: cleanLine, reason: error || 'Syntax error' });
        continue;
      }

      const normalized = parsedUrl.toString();
      if (!validMap.has(normalized)) {
        validMap.set(normalized, {
          original: cleanLine,
          normalized,
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
        });
      }
    }

    const validUrls = Array.from(validMap.values());
    let importedCount = 0;

    // Insert valid URLs in transaction batches
    for (const item of validUrls) {
      const match = findBestMatchingProperty(item.normalized, project.properties);

      await prisma.url.upsert({
        where: {
          projectId_normalizedUrl: {
            projectId: project.id,
            normalizedUrl: item.normalized,
          },
        },
        update: {
          matchedPropertyId: match.property?.id || null,
        },
        create: {
          projectId: project.id,
          originalUrl: item.original,
          normalizedUrl: item.normalized,
          hostname: item.hostname,
          path: item.path,
          status: 'IMPORTED',
          matchedPropertyId: match.property?.id || null,
        },
      });
      importedCount++;
    }

    // Create Import record
    const importRecord = await prisma.import.create({
      data: {
        projectId: project.id,
        sourceType,
        totalUrls: lines.length,
        validUrls: importedCount,
        invalidUrls: invalidList.length,
        status: 'COMPLETED',
        errorReport: invalidList.length > 0 ? JSON.stringify(invalidList.slice(0, 100)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      importId: importRecord.id,
      totalProcessed: lines.length,
      importedCount,
      invalidCount: invalidList.length,
      invalidSamples: invalidList.slice(0, 10),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
