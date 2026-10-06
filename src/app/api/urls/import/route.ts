import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { executeBulkImport } from '@/lib/bulk-importer';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const importSchema = z.object({
  projectId: z
    .string({
      required_error: 'Please select a project before importing URLs.',
      invalid_type_error: 'Please select a project before importing URLs.',
    })
    .trim()
    .min(1, 'Please select a project before importing URLs.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
  sourceType: z.enum(['RAW_TEXT', 'TXT_FILE', 'CSV_FILE', 'SITEMAP', 'RSS_FEED']),
  content: z.string().optional(),
  sourceUrl: z.string().optional(),
  maxUrls: z.number().int().min(1).max(10000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { projectId, sourceType, content, sourceUrl, maxUrls } = parsed.data;

    const result = await executeBulkImport({
      projectId,
      userId: user.role === 'OWNER' ? 'OWNER' : user.id,
      sourceType,
      content,
      sourceUrl,
      maxUrls,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      importId: result.importId,
      sourceType: result.sourceType,
      totalExtracted: result.totalExtracted,
      accepted: result.accepted,
      duplicates: result.duplicates,
      invalid: result.invalid,
      blocked: result.blocked,
      invalidItems: result.invalidItems,
      createdUrls: result.createdUrls,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
