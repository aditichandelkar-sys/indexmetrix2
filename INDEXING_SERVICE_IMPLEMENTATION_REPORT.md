# INDEX MATRIX — Commercial Indexing & Discovery SaaS Implementation Report

**Document Status:** Production Verified & Acceptance Tested  
**System Architecture:** Next.js 14 (App Router) + Prisma + SQLite (Dev) / PostgreSQL (Prod) + BullMQ Worker + Real Google Search Console & Indexing API  
**Integration Status:** LIVE & VERIFIED with Google Cloud Project (`212659915152`) and verified domain property `https://www.indexmetrix.com/`

---

## 1. Executive Summary

INDEX MATRIX has been successfully transformed into an original, enterprise-grade, commercial URL indexing and discovery SaaS inspired by modern indexing workflows (such as Quick Indexing) without copying any proprietary code and strictly complying with official Google Webmaster guidelines.

### Fundamental Principle: Absolute Status Truthfulness
* **No Fake Indexing:** A URL is marked `INDEXED` **only and exclusively** when the official Google Search Console URL Inspection API returns a verdict of `PASS` or an explicit indexed coverage state (e.g., `"Submitted and indexed"`).
* **Official Google Indexing API Policy:** Per official Google documentation, the Google Indexing API (`https://indexing.googleapis.com/v3/urlNotifications:publish`) is strictly limited to pages with `JobPosting` or `BroadcastEvent` embedded in `VideoObject`. General web pages, blogs, forums, eCommerce products, and PDFs are blocked from direct Indexing API calls to prevent domain penalties.
* **Legitimate Discovery Workflow for Normal URLs:** Normal URLs are guided through technical crawlability audits, robots.txt verification, HTTP header inspection, sitemap/feed inclusion, Search Console property matching, real-time Google URL inspection, and scheduled reinspection.
* **Notification Submission vs. Indexing:** A successful Google Indexing API submission is explicitly labeled as `"Notification Accepted by Google"`, never as `"Indexed"`.

---

## 2. Architecture & System Flow

```
User Action (Dashboard / /projects / /urls)
  │
  ├── 1. Project Management (/projects)
  │      └── Connect domain & link verified Search Console property
  │
  ├── 2. URL Ingestion & Bulk Import (/urls, /api/urls/import)
  │      ├── Formats: Single URL, Newline Text, CSV (column auto-detection), Sitemap XML (recursive), RSS/Atom Feeds
  │      ├── Normalization: Lowercase host, strip trailing slashes, validate HTTP/HTTPS
  │      ├── Multi-Layer SSRF Defense: Blocks loopback, private IPv4/IPv6, link-local, cloud metadata
  │      └── Deduplication: In-batch Set deduplication + DB project scope deduplication
  │
  ├── 3. Batch Indexing Job Dispatch (/api/jobs)
  │      ├── Pre-checks customer wallet (1 credit/URL; 0 for Owner UNLIMITED)
  │      ├── Enqueues IndexingJob & IndexingJobItem records with status: QUEUED
  │      └── Dispatches to Queue Worker (in-process fallback or BullMQ + Redis)
  │
  ├── 4. Worker Processing Engine
  │      ├── Step A: Technical Crawlability Audit (HTTP status, redirect chain, robots meta, canonical)
  │      ├── Step B: GSC Property Matching (Domain properties vs. Exact URL prefixes)
  │      │     └── If not covered: Marks NOT_INDEXED (PROPERTY_NOT_AUTHORIZED), no Google API call
  │      ├── Step C: Execution by Workflow Type:
  │      │     ├── Standard Discovery: Live Google URL Inspection (https://searchconsole.googleapis.com/v1/urlInspection/index:inspect)
  │      │     └── Official Indexing API: Schema eligibility check -> Google Publish Notification
  │      ├── Step D: Honest Status Persistence (GoogleInspection, Url, UrlStatusHistory)
  │      └── Step E: Credit Accounting (Atomic deduction with idempotency; automatic refund on permanent failures)
  │
  └── 5. Live Telemetry & Reinspection (/jobs, /urls)
         ├── Real-time job progress bar & breakdown (completed, processing, failed)
         ├── Reinspect Now or Scheduled Reinspection (1h, 6h, 24h, 72h)
         └── Direct inspection telemetry modal with Google verdict & deep link
```

---

## 3. Database Schema Changes

The Prisma schema was updated (`prisma/schema.sqlite.prisma` and `prisma/schema.prisma`) using non-destructive schema synchronization (`prisma db push`):

1. **`Project` Model:**
   * Added `googlePropertyId String?`: Foreign key to linked `SearchConsoleProperty`.
   * Added `googlePropertyUrl String?`: Canonical property identifier (e.g. `sc-domain:indexmetrix.com` or `https://www.indexmetrix.com/`).
   * Added relation `indexingJobs IndexingJob[]`.

2. **`Url` Model:**
   * Added `lastGoogleVerdict String?`: Actual Google verdict (`PASS`, `NEUTRAL`, `FAIL`).
   * Added `lastCoverageState String?`: Real Google coverage (e.g. `"Crawled - currently not indexed"`).
   * Added `lastIndexedAt DateTime?`: Timestamp when Google confirmed indexing.
   * Added `lastInspectionId String?`: Relation to the latest `GoogleInspection` record.
   * Added `discoveryStatus String?`: Tracks internal discovery progress (`DISCOVERY_PENDING`, `PROPERTY_NOT_AUTHORIZED`, `INDEXED_CONFIRMED`).
   * Added `scheduledReinspectionAt DateTime?`: Supports delayed reinspection intervals.
   * Added relation `jobItems IndexingJobItem[]`.

3. **New Model `IndexingJob`:**
   * Fields: `id`, `userId`, `projectId`, `type` (`DISCOVERY_AND_INSPECTION` | `OFFICIAL_INDEXING_API` | `REINSPECT`), `status` (`QUEUED` | `PROCESSING` | `COMPLETED` | `PARTIAL` | `FAILED` | `CANCELLED`), `totalUrls`, `queuedUrls`, `processingUrls`, `completedUrls`, `failedUrls`, `creditsCharged`, `creditsRefunded`, `idempotencyKey`, `metadata`, `error`, `startedAt`, `completedAt`.

4. **New Model `IndexingJobItem`:**
   * Fields: `id`, `jobId`, `urlId`, `status` (`QUEUED` | `PROCESSING` | `COMPLETED` | `FAILED` | `CANCELLED`), `attempts`, `maxAttempts`, `lastError`, `operationResult`, `startedAt`, `completedAt`, `nextRetryAt`.

---

## 4. API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List projects for authenticated tenant (or all for Owner) |
| `POST` | `/api/projects` | Create project with domain and optional GSC property link |
| `GET` | `/api/projects/[id]` | Get project details and aggregated URL status statistics |
| `PATCH` | `/api/projects/[id]` | Update project name, domain, description, and linked GSC property |
| `DELETE`| `/api/projects/[id]` | Delete project with tenant isolation check |
| `GET` | `/api/urls` | Paginated URL registry with status filters and search |
| `POST` | `/api/urls` | Add single URL and match GSC property |
| `POST` | `/api/urls/import` | Bulk import URLs from TXT, CSV, Sitemap XML, or RSS/Atom feeds |
| `POST` | `/api/urls/bulk` | Legacy bulk import handler (preserved) |
| `POST` | `/api/urls/inspect` | Direct on-demand Google URL Inspection (preserves existing verified endpoint) |
| `GET` | `/api/urls/[id]` | Full URL intelligence profile with audit history and Google telemetry |
| `POST` | `/api/urls/[id]/inspect` | Direct Google inspection for an existing URL record |
| `POST` | `/api/urls/[id]/reinspect` | Immediate or scheduled reinspection (1h, 6h, 24h, 72h) |
| `POST` | `/api/urls/[id]/discovery` | Run technical crawlability audit and generate discovery recommendations |
| `GET` | `/api/jobs` | List batch indexing jobs with progress breakdown |
| `POST` | `/api/jobs` | Create batch indexing job for selected URLs |
| `GET` | `/api/jobs/[id]` | Get detailed job progress and individual item execution results |
| `POST` | `/api/jobs/[id]/cancel`| Safely cancel queued items and refund unspent credits |
| `POST` | `/api/jobs/[id]/retry` | Re-enqueue failed job items for retry with exponential backoff |
| `GET` | `/api/admin/overview` | Platform health indicators, system counters, and ledger status |

---

## 5. Security & SSRF Hardening

* **Protocol Restriction:** Only `http:` and `https:` URLs are permitted. Schemes such as `file:`, `gopher:`, `ftp:`, `javascript:` are strictly rejected.
* **DNS Resolution & IP Validation:** Every target URL and redirect hop resolves DNS before fetching. It blocks:
  * IPv4 loopback (`127.0.0.0/8`)
  * IPv6 loopback (`::1`)
  * RFC 1918 Private Ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  * Link-Local & APIPA (`169.254.0.0/16`)
  * Cloud Metadata Endpoints (`169.254.169.254`, `metadata.google.internal`)
* **Redirect Validation:** Every redirect destination is individually checked for SSRF before following.
* **Bounded Content Fetching:**
  * Request timeout capped at 12 seconds.
  * Maximum response download capped at 2MB to prevent memory exhaustion.
  * PDF signature and header checks download only initial bytes without buffering entire files.
  * Sitemaps recursion capped at `MAX_DEPTH = 3` and `MAX_URLS = 5,000`.

---

## 6. Credit Accounting & Owner Privileges

* **Owner Account:**
  * `creditMode: UNLIMITED`.
  * `deductCredits` checks the user role / credit mode first. If `UNLIMITED` or `OWNER`, exactly 0 credits are deducted, balance is never altered, and the operation immediately proceeds.
* **Customer Accounts:**
  * Strict double-entry accounting in `CreditWallet` and `CreditTransaction`.
  * Pre-execution balance validation prevents enqueuing jobs with insufficient funds.
  * Operations use deterministic idempotency keys (`batch_item_<id>`). Replayed requests return existing balances without double-charging.
  * Automatic Refunds: If an indexing job item fails permanently (exceeding `maxAttempts`), the spent credit is automatically refunded to the customer wallet via an atomic `REFUND` ledger transaction.

---

## 7. Automated Test Verification

All 11 test suites and 77 automated tests pass with 100% success rate:

```
 RUN  v2.1.9 C:/Users/Aditi/baby tool

 ✓ tests/fast-indexer.test.ts (2 tests)
 ✓ tests/property-matcher.test.ts (11 tests)
 ✓ tests/crypto.test.ts (3 tests)
 ✓ tests/ssrf.test.ts (8 tests)
 ✓ tests/google-oauth.test.ts (7 tests)
 ✓ tests/credit-ledger.test.ts (4 tests)
 ✓ tests/navigation-and-security.test.ts (7 tests)
 ✓ tests/indexing-eligibility.test.ts (3 tests)
 ✓ tests/commercial-indexing-service.test.ts (19 tests)
 ✓ tests/url-pipeline-and-audit.test.ts (10 tests)
 ✓ tests/live-integration.test.ts (3 tests)

 Test Files  11 passed (11)
      Tests  77 passed (77)
```

### TypeScript Validation
```bash
npx tsc --noEmit
# Exit Code: 0 (Zero errors)
```

### Next.js Production Build
```bash
npm run build
# Exit Code: 0 (All 68 static and dynamic routes compiled successfully)
```

---

## 8. Live Integration Verification with Real Google API

Live verification was executed directly against Google Search Console using the authenticated account `aditichandelkar@gmail.com` on the verified domain property `https://www.indexmetrix.com/`:

```
Endpoint: POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
Target URL: https://www.indexmetrix.com/
Matched Property: https://www.indexmetrix.com/

Actual Live Google Response Telemetry:
  verdict:           NEUTRAL
  coverageState:     Crawled - currently not indexed
  robotsTxtState:    ALLOWED
  pageFetchState:    SUCCESSFUL
  crawledAs:         MOBILE
  lastCrawlTime:     2026-10-03T00:50:18Z
```

### Verified Behaviors:
1. **Property Detection:** Automatically identified `https://www.indexmetrix.com/` as an authorized Search Console property.
2. **Real Status Mapping:** Status accurately persisted in the database as `NOT_INDEXED` with `verdict = "NEUTRAL"` and `coverageState = "Crawled - currently not indexed"`. Did NOT claim indexed.
3. **Database Records Created:** Created `Url` record, linked `GoogleInspection` record with raw JSON response, and wrote an audit entry to `UrlStatusHistory`.
4. **Batch Job Processing:** Enqueued batch job with `IndexingJobItem` and updated progress correctly.
5. **Credit Behavior:** Owner user charged 0 credits.
6. **Unauthorized URL Test:** `https://some-unauthorized-random-domain.com/article` returned `matchType: null` and prevented calling the Google URL Inspection API.
7. **SSRF Blocking:** `http://127.0.0.1`, `http://localhost:3000`, `http://169.254.169.254`, and `http://10.0.0.1` were blocked by SSRF defense.

---

## 9. Known Google Limitations & Product Truth

1. **Google Indexing API Scope:**
   Google explicitly states in its Search Central documentation:
   > *"Currently, the Indexing API can only be used to crawl pages that include either JobPosting or BroadcastEvent embedded in a VideoObject."*  
   Submitting standard articles or arbitrary pages to this API violates Google's terms and will not result in standard search indexing.

2. **No Guaranteed Instant Indexing:**
   Search engines do not offer guaranteed indexing timelines for arbitrary URLs. Google crawls and indexes URLs based on quality signals, authority, crawl budget, and site structure. INDEX MATRIX provides immediate crawlability audits, Search Console submission, real-time inspection, and scheduled verification, but never falsely promises instantaneous Google indexing.

---

## 10. Future Improvements

1. **Webhooks / Email Notifications:** Send email/Slack notifications to customers when Google alters an inspected URL's coverage state to `INDEXED`.
2. **Automated XML Sitemap Resubmission:** Trigger automatic sitemap pings when batch imports accept new URLs.
3. **Google Indexing API Batching:** Implement multipart batch requests for high-volume `JobPosting` / `BroadcastEvent` feeds.
