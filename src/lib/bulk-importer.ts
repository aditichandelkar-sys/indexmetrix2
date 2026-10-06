import { prisma } from './db';
import { normalizeUrl, findBestMatchingProperty } from './property-matcher';
import { validateUrlForSSRF } from './ssrf';
import { parseSitemap, parseFeed } from './sitemap-parser';

export type ImportSourceType = 'RAW_TEXT' | 'TXT_FILE' | 'CSV_FILE' | 'SITEMAP' | 'RSS_FEED';

export interface BulkImportOptions {
  projectId: string;
  userId: string;
  sourceType: ImportSourceType;
  content?: string;
  sourceUrl?: string;
  maxUrls?: number;
}

export interface BulkImportResult {
  success: boolean;
  importId?: string;
  sourceType: ImportSourceType;
  totalExtracted: number;
  accepted: number;
  duplicates: number;
  invalid: number;
  blocked: number;
  invalidItems?: Array<{ url: string; reason: string }>;
  createdUrls?: Array<{ id: string; url: string; normalizedUrl: string; status: string }>;
  error?: string;
}

const DEFAULT_MAX_IMPORT_URLS = 10000;

/**
 * Extracts raw candidate URLs from text, CSV, sitemap, or RSS feeds
 */
export async function extractCandidateUrls(
  sourceType: ImportSourceType,
  content?: string,
  sourceUrl?: string
): Promise<{ candidates: string[]; extractionError?: string }> {
  const candidates: string[] = [];

  if (sourceType === 'SITEMAP') {
    if (!sourceUrl && !content) {
      return { candidates: [], extractionError: 'Sitemap URL is required' };
    }
    const targetUrl = sourceUrl || content?.trim();
    if (!targetUrl) return { candidates: [], extractionError: 'Missing sitemap target URL' };

    const parsed = await parseSitemap(targetUrl);
    if (parsed.error && parsed.urls.length === 0) {
      return { candidates: [], extractionError: parsed.error };
    }
    return { candidates: parsed.urls };
  }

  if (sourceType === 'RSS_FEED') {
    if (!sourceUrl && !content) {
      return { candidates: [], extractionError: 'RSS/Atom feed URL is required' };
    }
    const targetUrl = sourceUrl || content?.trim();
    if (!targetUrl) return { candidates: [], extractionError: 'Missing feed target URL' };

    const parsed = await parseFeed(targetUrl);
    if (parsed.error && parsed.urls.length === 0) {
      return { candidates: [], extractionError: parsed.error };
    }
    return { candidates: parsed.urls };
  }

  if (!content) {
    return { candidates: [] };
  }

  if (sourceType === 'CSV_FILE') {
    // Parse CSV rows and extract URL column
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { candidates: [] };

    // Detect header if present
    const firstLineCols = lines[0].split(',').map((c) => c.replace(/^["']|["']$/g, '').trim().toLowerCase());
    let urlColIndex = firstLineCols.findIndex((col) =>
      ['url', 'link', 'loc', 'location', 'page', 'address', 'target'].includes(col)
    );

    const hasHeader = urlColIndex !== -1;
    const startLine = hasHeader ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      const row = lines[i];
      // Basic CSV token parser handling quotes
      const cells: string[] = [];
      let inQuotes = false;
      let current = '';
      for (let c = 0; c < row.length; c++) {
        const char = row[c];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim());

      let extracted = '';
      if (hasHeader && cells[urlColIndex]) {
        extracted = cells[urlColIndex].replace(/^["']|["']$/g, '').trim();
      } else {
        // Fallback: search for first cell that starts with http:// or https://
        const httpCell = cells.find((c) => /^https?:\/\//i.test(c.replace(/^["']|["']$/g, '').trim()));
        if (httpCell) {
          extracted = httpCell.replace(/^["']|["']$/g, '').trim();
        } else if (cells[0]) {
          extracted = cells[0].replace(/^["']|["']$/g, '').trim();
        }
      }

      if (extracted) {
        candidates.push(extracted);
      }
    }

    return { candidates };
  }

  // RAW_TEXT or TXT_FILE: one per line, comma, or semicolon
  const lines = content.split(/[\r\n,;]+/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const clean = trimmed.replace(/^["']|["']$/g, '').trim();
    if (clean) candidates.push(clean);
  }

  return { candidates };
}

/**
 * Universal bulk importer executing normalization, SSRF filtering, deduplication,
 * Search Console property matching, and persistent recording.
 */
export async function executeBulkImport(options: BulkImportOptions): Promise<BulkImportResult> {
  const { projectId, userId, sourceType, content, sourceUrl, maxUrls = DEFAULT_MAX_IMPORT_URLS } = options;

  // 1. Verify project exists and user has access
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...(userId === 'OWNER' ? {} : { userId }),
    },
    include: {
      properties: true,
    },
  });

  if (!project) {
    return {
      success: false,
      sourceType,
      totalExtracted: 0,
      accepted: 0,
      duplicates: 0,
      invalid: 0,
      blocked: 0,
      error: 'Project not found or unauthorized',
    };
  }

  // 2. Extract candidate URLs
  const { candidates, extractionError } = await extractCandidateUrls(sourceType, content, sourceUrl);
  if (extractionError) {
    return {
      success: false,
      sourceType,
      totalExtracted: 0,
      accepted: 0,
      duplicates: 0,
      invalid: 0,
      blocked: 0,
      error: extractionError,
    };
  }

  const boundedCandidates = candidates.slice(0, maxUrls);

  // 3. Process each candidate URL
  const seenInBatch = new Set<string>();
  const validCandidates: Array<{ original: string; normalized: string; hostname: string; path: string }> = [];
  const invalidItems: Array<{ url: string; reason: string }> = [];
  let duplicates = 0;
  let blocked = 0;
  let invalid = 0;

  for (const candidate of boundedCandidates) {
    // Basic normalization check
    const { url: parsedUrl, error: normError } = normalizeUrl(candidate);
    if (!parsedUrl || normError) {
      invalid++;
      invalidItems.push({ url: candidate, reason: normError || 'Malformed URL format' });
      continue;
    }

    const normalizedStr = parsedUrl.toString();

    // Check duplicate within incoming batch
    if (seenInBatch.has(normalizedStr)) {
      duplicates++;
      continue;
    }
    seenInBatch.add(normalizedStr);

    // SSRF verification (no localhost, loopback, private IPs, metadata endpoints)
    const ssrf = await validateUrlForSSRF(normalizedStr);
    if (!ssrf.isSafe) {
      blocked++;
      invalidItems.push({ url: candidate, reason: `SSRF Block: ${ssrf.reason}` });
      continue;
    }

    validCandidates.push({
      original: candidate,
      normalized: normalizedStr,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
    });
  }

  // 4. Check for duplicates already present in the database for this project
  const candidateNormalizedList = validCandidates.map((c) => c.normalized);
  const existingRows = await prisma.url.findMany({
    where: {
      projectId: project.id,
      normalizedUrl: { in: candidateNormalizedList },
    },
    select: { normalizedUrl: true },
  });

  const existingNormalizedSet = new Set(existingRows.map((r) => r.normalizedUrl));
  const trulyNewItems = validCandidates.filter((item) => {
    if (existingNormalizedSet.has(item.normalized)) {
      duplicates++;
      return false;
    }
    return true;
  });

  // 5. Bulk insert new URLs into database
  const createdUrls: Array<{ id: string; url: string; normalizedUrl: string; status: string }> = [];

  for (const item of trulyNewItems) {
    const match = findBestMatchingProperty(item.normalized, project.properties);

    const record = await prisma.url.create({
      data: {
        projectId: project.id,
        originalUrl: item.original,
        normalizedUrl: item.normalized,
        hostname: item.hostname,
        path: item.path,
        status: 'IMPORTED',
        matchedPropertyId: match.property?.id || null,
      },
    });

    createdUrls.push({
      id: record.id,
      url: record.originalUrl,
      normalizedUrl: record.normalizedUrl,
      status: record.status,
    });
  }

  // 6. Record import entry
  const importRecord = await prisma.import.create({
    data: {
      projectId: project.id,
      sourceType,
      totalUrls: boundedCandidates.length,
      validUrls: createdUrls.length,
      invalidUrls: invalid + blocked,
      status: 'COMPLETED',
      errorReport: invalidItems.length > 0 ? JSON.stringify(invalidItems.slice(0, 100)) : null,
    },
  });

  return {
    success: true,
    importId: importRecord.id,
    sourceType,
    totalExtracted: boundedCandidates.length,
    accepted: createdUrls.length,
    duplicates,
    invalid,
    blocked,
    invalidItems: invalidItems.slice(0, 50),
    createdUrls,
  };
}
