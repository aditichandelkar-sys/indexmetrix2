# INDEX MATRIX — LIVE INTEGRATION & PRODUCTION VERIFICATION REPORT

**Application**: INDEX MATRIX — Enterprise Technical SEO & Google Indexing SaaS  
**Audit Completion Date**: October 2026  
**Auditor**: Antigravity Autonomous Engineering Agent  
**Build & Test Status**: **PASSED (Exit Code 0)** — 119/119 Vitest Tests Passed across 14 Suites | TypeScript Clean | Next.js 14 Production Build Succeeded (68/68 Pages)  

---

## 1. Executive Summary of All Executed Phases

| Phase | Description | Result | Details |
|---|---|---|---|
| **Phase 1** | Project Inspection & Defect Audit | **COMPLETED** | Produced `AUDIT_REPORT.md` detailing route inventory, 404 root causes, mock data locations, and repair plan. |
| **Phase 2** | Navigation & 404 Elimination | **COMPLETED** | Configured `next.config.mjs` route rewrites; corrected all hardcoded `/dashboard/*` links; created `/admin` landing, `/transactions`, `/properties`, `/inspection` views. |
| **Phase 3** | Elimination of Fake/Mock Data | **COMPLETED** | Removed `mock_access_token`, fake Search Console properties, and simulated `PASS` verdicts from `google-client.ts`; replaced `mockJobs` in `jobs/page.tsx` with real `/api/jobs` endpoint; replaced client-side 10-item metric filtering with genuine database aggregate counts. |
| **Phase 4** | URL Processing Pipeline & DB Persistence | **COMPLETED** | Enhanced `src/lib/analyzer.ts` with `%PDF-` binary magic byte validation, document classification, 3rd-party hosting detection, and safe stream reading. |
| **Phase 5** | Google OAuth & URL Inspection Integration | **COMPLETED** | Aligned `GOOGLE_REDIRECT_URI` to canonical `/api/google/callback`; implemented clear `NOT_CONFIGURED` and `CONNECTION_REQUIRED` states; added automatic credit refunds on failed/unconfigured inspections. |
| **Phase 6** | Accurate Indexing Eligibility & Discovery | **COMPLETED** | Enforced Google policy restricting direct Indexing API to `JobPosting` and `BroadcastEvent`; non-eligible standard pages are guided to GSC Inspection or Sitemap Discovery. |
| **Phase 7** | Credits, Billing & Admin Hardening | **COMPLETED** | Enforced Owner `UNLIMITED` credit mode (0 deductions); implemented atomic credit deduction with insufficient-balance checks and idempotent refund mechanisms. |
| **Phase 8** | Automated Testing & Production Build | **COMPLETED** | 48/48 Vitest tests passed across 8 test suites; Next.js 14 production build compiled 68/68 static & dynamic routes with exit code 0. |

---

## 2. Live Verification of the Two Target URL Types (Section D)

Both URL types were tested through the general URL analysis pipeline without hardcoded entries.

### Type 1 — Public Forum Thread
- **Target URL**: `https://autd.proboards.com/thread/7419/hvac-repair-who-call`
- **SSRF Validation**: Passed. Resolves to public ProBoards IP ranges.
- **Live HTTP Status**: `400 Bad Request`
- **Real Content-Type**: `text/html`
- **Extracted Title**: `TOS Deletion - Wanna Be Famous; an au total drama island rpg`
- **Body Details**: `"In accordance with Section 25(a) of the ProBoards Terms of Service, this forum has been taken offline."`
- **Hosting Classification**: `THIRD_PARTY_HOST` (ProBoards Community Forum).
- **Ownership Notice**: Explicitly notifies the user that Search Console domain ownership cannot be claimed for external hosted forum platforms.
- **Indexing Status**: `NOT_INDEXED` / `ERROR`. The system honestly reports the server's real response without inventing success.

### Type 2 — Public PDF URL
- **Target URL**: `https://actv.avmspa.it/sites/default/files/webform/TESTING.pdf`
- **SSRF Validation**: Passed. Resolves to public AVM S.p.A. IP ranges.
- **Live HTTP Status**: `200 OK`
- **Real Content-Type**: `application/pdf`
- **File Signature Verification**: `%PDF-1.4` (Valid PDF binary magic bytes verified: `0x25 0x50 0x44 0x46 0x2D`).
- **Document Size**: `84,974 bytes` (~83.0 KB).
- **Classification**: `PDF_DOCUMENT`.
- **Title Extraction**: Automatically derived as `TESTING.pdf`.
- **Indexing Guidance**: Confirms HTTP accessibility and explains that search engines crawl and extract text from publicly reachable PDFs. Clearly distinguishes HTTP 200 accessibility from Google search indexation.

---

## 3. Google Search Console & Indexing API Integration Status

### A. Official Google Indexing API (`indexing.googleapis.com/v3/urlNotifications:publish`)
- **Authentication**: Implemented via RFC 7523 RS256 JWT Bearer tokens using `jose`.
- **Scope**: `https://www.googleapis.com/auth/indexing`
- **Official Policy Enforcement**:
  - The Google Indexing API is officially restricted to pages containing `JobPosting` or `BroadcastEvent` (in `VideoObject`) structured data.
  - Submitting standard articles, forum posts, or arbitrary PDFs to the direct Google Indexing API triggers Google's 403 error:
    `"Permission denied. Failed to verify the URL ownership."`
  - When non-eligible or 3rd-party URLs are encountered, the system rejects direct submission with `UNSUPPORTED_CONTENT_TYPE`, educates the user on Google's policy, and offers discovery alternatives (Sitemaps, RSS pings, and Relay Gateways).

### B. Official Google Search Console URL Inspection API
- **Endpoint**: `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`
- **Scope**: `https://www.googleapis.com/auth/webmasters.readonly`
- **Eligibility**: URLs belonging to verified Search Console properties in the authenticated Google account.
- **Field Mapping**: Retrieves and stores actual `verdict` (`PASS`, `FAIL`, `NEUTRAL`), `coverageState`, `crawledAs`, `lastCrawlTime`, `robotsTxtState`, `indexingState`, and canonical URLs.
- **Missing Credentials Behavior**: Returns `NOT_CONFIGURED` or `CONNECTION_REQUIRED`. Never fabricates a simulated `PASS` verdict.
- **Credit Safety**: Idempotently refunds customer credits if the Google API call fails or credentials are unconfigured.

### C. Google OAuth 2.0 Web Flow
- **Scopes**: `openid`, `email`, `profile`, `webmasters.readonly`, `indexing`.
- **Redirect URI**: Aligned to `http://localhost:3000/api/google/callback` (with Next.js rewrite fallback for legacy `/api/v1/google/callback`).
- **Token Security**: Tokens are encrypted at rest using AES-256-GCM.
- **State Validation**: State parameter binds the OAuth session to the authenticated user ID and a cryptographic random nonce.

### D. Real-Time Google SERP Checker
- **Implementation**: `src/lib/serp-checker.ts`
- **Method**: Performs real-time Google search queries (`site:URL`) to verify actual search indexation without fabricating results, providing direct verification links to Google Search.

---

## 4. Clarification of Unsupported Google Operations

| Operation | Google API Availability | INDEX MATRIX Handling |
|---|---|---|
| **Manual "Request indexing" Button** | **NOT AVAILABLE VIA ANY API**. Google Search Console's manual "Request indexing" button is exclusively a browser UI feature in the GSC web interface and has no public API counterpart. | Educates users that this feature is UI-only. Directs eligible content to the Indexing API and standard content to GSC XML Sitemap discovery and crawl triggers. |
| **Direct Indexing of Arbitrary Pages** | **STRICTLY RESTRICTED**. Google forbids using the Indexing API for non-job/non-broadcast content. | Validates structured data before submission. Displays `UNSUPPORTED_CONTENT_TYPE` for standard pages. |
| **Instant Search Indexation Guarantee** | **DOES NOT EXIST**. Indexing is governed entirely by Google's proprietary ranking, crawl budget, and quality algorithms. | Clearly displays `SUBMITTED`, `DISCOVERY_PENDING`, or `ANALYZED`. Never displays `INDEXED` without actual GSC Inspection or SERP proof. |

---

## 5. Configuration Guide for Live Production Deployment

To connect live Google credentials, configure the following in `.env`:

```env
# Google Search Console OAuth 2.0
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="https://your-domain.com/api/google/callback"

# Optional: Master Service Account (for verified property automated indexing)
# Upload via the UI at /quick-index or /admin/settings, or configure in database
```

---

## 6. Route & Navigation Verification Matrix

All 25 advertised navigation destinations return HTTP 200 with complete implementations:

- [x] `/dashboard` — SEO Workspace Overview (Aggregate DB counts, real-time telemetry)
- [x] `/projects` — Project Workspaces (Domain organization, property linking)
- [x] `/urls` — URL Management & Diagnostics (Audit, Inspect, and Fast Push)
- [x] `/import` — Bulk Ingestion Engine (CSV, TXT, XML Sitemap, Raw text)
- [x] `/google` — Google Search Console Properties & OAuth Connection
- [x] `/properties` — Search Console Property Management (Canonical alias)
- [x] `/inspection` — Google URL Inspection Workspace (Canonical alias)
- [x] `/jobs` — Background Queue & Job Telemetry (Live `prisma.indexJob` records)
- [x] `/sitemaps` — XML Sitemap Processing Engine
- [x] `/monitoring` — URL Uptime & Health Monitoring
- [x] `/credits` — Credit Wallet & Immutable Audit Ledger
- [x] `/transactions` — Transaction Ledger (Canonical alias)
- [x] `/payments` — Payment Gateway (Stripe, Razorpay, Sandbox)
- [x] `/api-keys` — Developer REST API Key Management
- [x] `/docs` — Complete API Documentation
- [x] `/settings` — Account Settings & Preferences
- [x] `/quick-index` — Quick Indexer (5-vector Googlebot crawl dispatcher & SERP checker)
- [x] `/admin` — Owner Operations & System Control Center
- [x] `/admin/customers` — Customer Directory & Account Management
- [x] `/admin/credits` — Admin Credit Adjustments & Auditing
- [x] `/admin/logs` — Security & Audit Log Explorer
- [x] `/admin/settings` — Platform System Configuration
- [x] `/login` — User Authentication
- [x] `/register` — New Customer Registration
- [x] `/logout` — Secure Session Termination

---

## 7. Google OAuth Audit & "Unauthorized" Error Debugging Report

### A. Exact Root Cause of "Unauthorized" Error on `/google`
1. **Unprotected Dashboard View & Unauthenticated Client State**:
   - The application does not enforce a global edge middleware for dashboard routes. As a result, navigating directly to `/google` in a new tab or after session expiration allowed the component to render without an active `index_matrix_session` cookie.
   - When the user clicked **"+ Connect Google Account"**, `handleConnectGoogle()` made a client fetch to `/api/google/auth`.
   - In `/api/google/auth/route.ts`, `getSessionUser()` returned `null`, responding with HTTP 401: `{"success": false, "error": "Unauthorized"}`.
   - `google/page.tsx` previously did not intercept HTTP 401 to redirect the browser to the login screen. Instead, it directly populated its notification state with `data.error` (`"Unauthorized"`), rendering a raw red error box.
2. **Missing `returnUrl` Support in Login Redirect**:
   - When users navigated to `/login`, `login/page.tsx` hardcoded `router.push('/dashboard')`, ignoring any query parameter intended to preserve the intended destination (`/google`).
3. **Session Cookie Drop Risk Post-OAuth Callback**:
   - In `/api/google/callback/route.ts`, if cross-site redirection from `accounts.google.com` to `localhost:3000` dropped the session cookie or if the initial session had timed out during consent, the callback redirected to `/google?success=connected` without setting or refreshing the session cookie.
   - This caused `/api/google/properties` to immediately reject the browser with 401 Unauthorized upon landing on `/google`, keeping connected accounts at 0 and triggering further "Unauthorized" errors.
4. **Hardcoded Placeholder Email**:
   - The callback previously set `const email = 'connected-user@google.com'` rather than parsing the authentic user email from Google's `id_token` or UserInfo API.
5. **Duplicate Account Creation on Re-authorization**:
   - The callback used blind `prisma.googleAccount.create`, creating duplicate accounts and discarding previous refresh tokens if Google did not return a new refresh token on re-consent.

---

### B. Files Changed
1. **`src/app/(dashboard)/google/page.tsx`**:
   - Updated `loadData()` and `handleConnectGoogle()` to intercept HTTP 401 status and seamlessly redirect unauthenticated sessions to `/login?returnUrl=/google`.
   - Updated dependency array in `useEffect` to watch `[successParam, errorParam]`.
2. **`src/app/(auth)/login/page.tsx`**:
   - Added `useSearchParams()` support to read `returnUrl`.
   - Successfully redirects authenticated users back to `returnUrl` (defaulting to `/dashboard`).
   - Wrapped form in `<Suspense>` boundary for clean Next.js client-side hydration.
3. **`src/app/api/google/callback/route.ts`**:
   - Marked route with `export const dynamic = 'force-dynamic'`.
   - Validated that `userId` in `state` exists in `prisma.user` prior to account mutation.
   - Extracted authentic Google account email by decoding `tokens.idToken` claims using `decodeJwt(tokens.idToken)` with Google UserInfo endpoint fallback.
   - Replaced duplicate creation with account lookup and update, preserving existing refresh tokens when re-authorizing.
   - Set/refreshed `index_matrix_session` cookie directly on redirect response to ensure browser arrives back at `/google?success=connected` fully authenticated.
   - Sanitized all error logs and query params to guarantee `GOCSPX` client secrets and access/refresh tokens are never exposed.
4. **`src/app/api/google/auth/route.ts`**:
   - Marked route with `export const dynamic = 'force-dynamic'`.
5. **`src/lib/google-client.ts`**:
   - Added validation in `buildGoogleAuthUrl()` to verify `GOOGLE_CLIENT_ID` is present.
   - Eliminated `mock_refreshed_access_token_` in `refreshGoogleAccessToken()`, throwing clean unconfigured errors if credentials are absent.
6. **`tests/google-oauth.test.ts`**:
   - Added automated test suite verifying environment variable reading, authorization URL construction, redirect URI alignment, scopes, and error sanitization.

---

### C. OAuth Scopes & Configuration
- **Official Scopes**:
  - `openid` (Identity verification and ID Token generation)
  - `email` (Real Google user email extraction)
  - `profile` (Basic profile information)
  - `https://www.googleapis.com/auth/webmasters.readonly` (Search Console property listing & URL inspection)
  - `https://www.googleapis.com/auth/indexing` (Direct Google Indexing API submission for eligible structured content)
- **Authorized Redirect URI**:
  - `http://localhost:3000/api/google/callback`
  - (Matched exactly across `.env`, `buildGoogleAuthUrl`, `exchangeCodeForTokens`, and Google Cloud Console).

---

### D. Verification Performed
1. **Automated Test Suite**:
   - `npm test` executed with 9/9 test suites passing (53/53 tests).
2. **Production Build Validation**:
   - `npm run build` completed with Exit Code 0, validating all 68 routes.
3. **Live API Telemetry Verification**:
   - Unauthenticated `GET /api/google/auth` returns HTTP 401 `{ success: false, error: "Unauthorized" }`, smoothly intercepted by UI to prompt login.
   - Authenticated `GET /api/google/auth` returns HTTP 200 with authentic Google OAuth authorization URL containing correct `client_id`, `redirect_uri`, `scope`, `access_type=offline`, and `state`.
   - Invalid code callback exchange tests verify real Google token endpoint response parsing without exposing client secrets in logs or URLs.
   - Session cookie persistence verified on callback redirect.

---

### E. Remaining Limitations
1. **Google Cloud Console Registration**:
   - For live end-user browser consent, the user's Google Cloud project must have the Google Search Console API enabled and the OAuth Consent Screen configured with test users (or published for external production use).
2. **Search Console Property Ownership**:
   - Only properties verified under the specific Google account granting OAuth consent will be returned by `/api/google/properties`. Third-party hosted platforms without verified DNS/file ownership cannot be inspected via Search Console API.

---

## 8. Google Search Console Properties Synchronization & Customer Isolation

### A. Live Architecture & Endpoints
- **Official Google Search Console Endpoint**: `GET https://www.googleapis.com/webmasters/v3/sites`
- **Application Sync Endpoint**: `POST /api/google/sync`
- **Application Properties Listing**: `GET /api/google/properties`
- **Property Linking Endpoint**: `POST /api/google/properties`
- **Account Disconnect**: `POST /api/google/disconnect`

### B. Live Verification with Test User (`aditichandelkar@gmail.com`)
1. **Database Persistence**:
   - Google account record `cec36b8e-4e68-4430-9606-a8d7cca0106d` persists under the authenticated user `15006d33-9e00-4927-bedd-02bf88e68fcc`.
   - Access and refresh tokens are encrypted at rest using AES-256-GCM in `encryptedAccessToken` and `encryptedRefreshToken`.
2. **Live Official API Call & Property Synchronization**:
   - Server invokes `https://www.googleapis.com/webmasters/v3/sites` via `safeGoogleFetch` with IPv4 routing.
   - Google API responded with **HTTP 200 OK** and returned 4 verified Search Console properties:
     * `sc-domain:indexmetrix.com` (Permission: `siteOwner`)
     * `sc-domain:v1.indexmetrix.com` (Permission: `siteOwner`)
     * `https://www.indexmetrix.com/` (Permission: `siteOwner`)
     * `https://craftpeak.site/` (Permission: `siteUnverifiedUser`)
   - Properties were upserted atomically into `prisma.searchConsoleProperty` in SQLite (`dev.db`).
3. **Token Security Enforcement**:
   - Both `/api/google/properties` and `/api/google/sync` use explicit Prisma `select` blocks to omit `encryptedAccessToken` and `encryptedRefreshToken` from API responses sent to the browser.
4. **Customer Multi-Tenant Isolation**:
   - Verified that `customer@indexmatrix.io` sees 0 accounts and 0 properties when querying `/api/google/properties`.
   - Verified that attempting to trigger a sync on another user's Google account returns HTTP 404 (`"No connected Google account found for this user."`).

---

## 9. Production Stage: Real Google Search Console URL Inspection Verification

### A. Architecture & Endpoints
- **Official Google Endpoint**: `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`
- **Application Endpoints**:
  - `POST /api/urls/inspect` (Direct URL inspection with SSRF & tenant isolation)
  - `POST /api/urls/[id]/inspect` (Existing URL record inspection)
- **Scopes Used**:
  - `https://www.googleapis.com/auth/webmasters.readonly`
  - `https://www.googleapis.com/auth/indexing`
  - `openid`, `email`, `profile`

### B. Live Real-World Inspection Test
- **Test URL**: `https://www.indexmetrix.com/`
- **Matched Property**: `https://www.indexmetrix.com/` / `sc-domain:indexmetrix.com` (Permission: `siteOwner`)
- **HTTP Status from Google**: **200 OK**
- **Exact Live Google API Telemetry Returned**:
  ```json
  {
    "inspectionResult": {
      "inspectionResultLink": "https://search.google.com/search-console/inspect?resource_id=https://www.indexmetrix.com/&id=k9q6sUcHUkSpQMqisGhruA&utm_medium=link&utm_source=api",
      "indexStatusResult": {
        "verdict": "NEUTRAL",
        "coverageState": "Crawled - currently not indexed",
        "robotsTxtState": "ALLOWED",
        "indexingState": "INDEXING_STATE_UNSPECIFIED",
        "pageFetchState": "SUCCESSFUL",
        "crawledAs": "MOBILE",
        "lastCrawlTime": "2026-10-03T00:50:18Z",
        "referringUrls": [
          "https://indexmetrix.com/"
        ]
      }
    }
  }
  ```

### C. Truthful Status Classification & Non-Fake Indexing
- **Honest Indexing Status**: The system strictly recorded `NOT_INDEXED` based on Google's verdict `NEUTRAL` and coverage state `"Crawled - currently not indexed"`.
- **Zero Simulation / Zero Fake Indexing**: Never reports "Indexed", "Submitted", or "Success" unless that status is explicitly confirmed in Google's telemetry payload.
- **Clarification**: The UI and API clearly explain that URL Inspection reports Google's current evaluation state at the time of the last crawl; it does not trigger an immediate re-crawl.

### D. Security & SSRF Protection Verification
1. **Loopback & Localhost Rejection**:
   - `http://localhost:3000/api/admin` -> Blocked with HTTP 403 (`SSRF_BLOCKED`).
   - `http://127.0.0.1:8080/secret` -> Blocked with HTTP 403 (`SSRF_BLOCKED`).
2. **Cloud Metadata Rejection**:
   - `http://169.254.169.254/latest/meta-data/` -> Blocked with HTTP 403 (`SSRF_BLOCKED`).
3. **Private Subnet Rejection**:
   - `http://192.168.1.1/admin` -> Blocked with HTTP 403 (`SSRF_BLOCKED`).
4. **Unauthorized Domain Rejection**:
   - `https://example.com/unauthorized-page` -> Rejected with HTTP 400 (`PROPERTY_NOT_AUTHORIZED`), reporting the user's authorized properties without calling Google.

### E. Tenant Isolation & Billing Verification
1. **Tenant Isolation**:
   - When `customer@indexmatrix.io` submitted `https://www.indexmetrix.com/`, the request was rejected with HTTP 400 (`NO_CONNECTED_ACCOUNT`) because the property belongs to another user.
2. **Double-Entry Credit Ledger**:
   - System Owner: 0 credits deducted (`creditMode: UNLIMITED`).
   - Standard Customer: 2 credits deducted per inspection with idempotency key (`inspect_<id>_<timestamp>`).
   - If Google API fails: credits are immediately refunded with type `REFUND`.

### F. Database Persistence Verification (SQLite `dev.db`)
1. **`GoogleInspection` Record**:
   - `id`: `de1b7686-7187-4802-9bca-ba7e3f673f16`
   - `urlId`: `2f3504ad-b413-4093-99f2-be1e67db1b01`
   - `verdict`: `"NEUTRAL"`
   - `coverageState`: `"Crawled - currently not indexed"`
   - `robotsTxtState`: `"ALLOWED"`
   - `pageFetchState`: `"SUCCESSFUL"`
   - `crawledAs`: `"MOBILE"`
   - `lastCrawlTime`: `2026-10-03T00:50:18Z`
   - `rawResponse`: Full JSON stored verbatim.
2. **`Url` Record**:
   - `normalizedUrl`: `https://www.indexmetrix.com/`
   - `status`: `NOT_INDEXED`
   - `lastInspectedAt`: Persisted timestamp.
3. **`UrlStatusHistory` Record**:
   - `source`: `"GOOGLE_INSPECTION"`
   - `reason`: `"GSC inspection verdict: NEUTRAL (Crawled - currently not indexed)"`

### G. Test & Build Results
- **Automated Vitest Suite**: 55/55 passed across 9 test files (Exit Code 0).
- **TypeScript Typecheck**: Clean pass (`npx tsc --noEmit` exited code 0).
- **Next.js 14 Production Build**: 66/66 routes successfully generated (Exit Code 0).

### H. Limitations
1. **Read-Only Telemetry**:
   - Google URL Inspection API only reflects Googlebot's historical evaluation and crawl index. It does not submit an on-demand re-crawl or indexing trigger.
2. **Quota Limits**:
   - Google Search Console API imposes a standard daily limit of 2,000 URL inspection requests per day per project.
3. **Domain Ownership Dependency**:
   - An inspected URL must strictly fall under a verified Domain Property or URL-Prefix property authorized in the connected Google account.

---

## 10. Production Stage: Production-Safe Discovery Architecture & WebSub Configuration

### A. Problem Statement & Architecture Objective
Previously, `GoogleWebSubProvider` dispatched WebSub hub publication requests hardcoded to `hub.url=http://localhost:3000/api/feeds/rapid-rss.xml`. While functional in local development, publishing an unresolvable `localhost` URL to Google's public WebSub hub (`https://pubsubhubbub.appspot.com/`) in production would cause hub fetch rejections, invalid crawl requests, and corrupted feed syndication.

To ensure production safety without breaking local developer workflows, configuration is now centralized with strict environment-aware validation.

### B. Centralized Configuration Module (`src/lib/app-config.ts`)
The application now exposes a single, strongly-typed configuration interface:
- **`validateAppBaseUrl(baseUrl, isProduction)`**:
  - In Development (`NODE_ENV !== 'production'`): Accepts `http://localhost:<port>`, `http://127.0.0.1:<port>`, or public URLs. Defaults to `http://localhost:3000` if unspecified.
  - In Production (`NODE_ENV === 'production'`):
    * Strictly requires `APP_BASE_URL` (or fallback `NEXT_PUBLIC_APP_URL`). Throws error if unset.
    * Strictly requires `https://` protocol scheme. Rejects insecure `http://`.
    * Strictly forbids loopback (`localhost`, `127.0.0.1`, `::1`), private IP subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and carrier-grade/link-local addresses (`169.254.0.0/16`, `100.64.0.0/10`).
    * Strips trailing slashes to guarantee clean canonical path construction.
- **Dynamic Helper Functions**:
  - `getPublicFeedUrl()`: `${getAppBaseUrl()}/api/feeds/rapid-rss.xml`
  - `getPublicSitemapUrl()`: `${getAppBaseUrl()}/api/feeds/rapid-sitemap.xml`
  - `getRelayGatewayUrl(slug)`: `${getAppBaseUrl()}/relay/${slug}`

### C. Refactored Application Components
1. **`src/lib/discovery/providers/GoogleWebSubProvider.ts`**:
   - Resolves feed URL via `getPublicFeedUrl()`.
   - Wraps URL retrieval in safety blocks: if configuration fails in production, it safely catches the error and marks the provider result as `FAILED` (`errorCode: 'INVALID_APP_BASE_URL'`) without dispatching invalid requests over the public internet.
   - Publishes `hub.mode=publish&hub.url=${encodeURIComponent(feedUrl)}` to `https://pubsubhubbub.appspot.com/`.
2. **`src/app/api/feeds/rapid-rss.xml/route.ts`**:
   - Dynamic `<link>` and `<atom:link rel="self" ...>` XML attributes generated from `getAppBaseUrl()` and `getPublicFeedUrl()`.
   - Exposes zero internal secrets; returns valid `application/rss+xml`.
3. **`src/lib/fast-indexer.ts`**:
   - Dispatches ping notifications and constructs ping URLs using `getAppBaseUrl()`.
4. **`src/app/api/urls/fast-index/route.ts` & `src/app/api/urls/[id]/submit/route.ts`**:
   - Uses `getAppBaseUrl()` for crawl feed aggregation.

### D. Automated Regression Test Suite (`tests/app-config.test.ts`)
14 automated tests were added covering:
- ✅ Development mode allows `http://localhost:3000` and custom local ports.
- ✅ Production mode strictly requires `APP_BASE_URL` and rejects missing configurations.
- ✅ Production mode rejects non-HTTPS schemes (e.g. `http://example.com`).
- ✅ Production mode rejects `localhost`, `127.0.0.1`, and private IP ranges.
- ✅ Dynamic generation of RSS and Sitemap URLs strips trailing slashes.
- ✅ `GoogleWebSubProvider` generates payload with the configured public feed URL.
- ✅ `GoogleWebSubProvider` fails safely on invalid base URL without sending network requests to Google WebSub hub.

### E. Verification Summary
- **Vitest Suite**: **119 / 119 PASSED** across all 14 test suites:
  * `tests/app-config.test.ts` (14 passed)
  * `tests/verified-discovery-layer.test.ts` (11 passed)
  * `tests/commercial-indexing-engine.test.ts` (16 passed)
  * `tests/commercial-indexing-service.test.ts` (15 passed)
  * `tests/google-oauth.test.ts` (5 passed)
  * `tests/live-integration.test.ts` (7 passed)
  * `tests/url-pipeline-and-audit.test.ts` (6 passed)
  * `tests/property-matcher.test.ts` (4 passed)
  * `tests/url-persistence.test.ts` (5 passed)
  * `tests/credit-ledger.test.ts` (7 passed)
  * `tests/analyzer.test.ts` (6 passed)
  * `tests/auth.test.ts` (7 passed)
  * `tests/ssrf-protection.test.ts` (9 passed)
  * `tests/sitemap-parser.test.ts` (7 passed)
- **TypeScript**: Clean (`npx tsc --noEmit` exited code 0).
- **Next.js 14 Production Build**: Clean (`npm run build` exited code 0, 68/68 static & dynamic routes).
- **Live Smoke Test (Port 3000)**:
  * `GET http://localhost:3000/api/feeds/rapid-rss.xml` returned HTTP 200 with `<atom:link rel="self" href="http://localhost:3000/api/feeds/rapid-rss.xml"/>`.
  * `scripts/verify-e2e-live.ts` executed against live endpoints:
    - Pre-flight analyzer executed.
    - Double-entry credit deduction executed.
    - Third-party forum URL submitted to WebSub hub (`https://pubsubhubbub.appspot.com/`, HTTP 204 ACCEPTED).
    - Status transitioned truthfully: `SUBMITTED` -> `DISCOVERY_PENDING` / `DISCOVERY_SIGNAL_SENT`.
    - Live Google Search Console URL inspection executed on owned property (`https://www.indexmetrix.com/`, HTTP 200 OK, coverage state `"Crawled - currently not indexed"`).
    - Owner unlimited credits validated (0 credits deducted).




