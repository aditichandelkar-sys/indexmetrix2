-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CreditMode" AS ENUM ('LIMITED', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UrlStatus" AS ENUM ('IMPORTED', 'QUEUED', 'ANALYZING', 'ANALYZED', 'READY', 'SUBMISSION_PENDING', 'SUBMITTED', 'DISCOVERY_PENDING', 'CRAWL_DETECTED', 'INSPECTION_PENDING', 'INDEXED', 'NOT_INDEXED', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "JobOperation" AS ENUM ('ANALYZE', 'INSPECT', 'SUBMIT_SUPPORTED', 'SITEMAP_DISCOVERY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PURCHASE', 'USAGE', 'ADMIN_ADD', 'ADMIN_REMOVE', 'REFUND', 'BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "creditMode" "CreditMode" NOT NULL DEFAULT 'LIMITED',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeUsed" INTEGER NOT NULL DEFAULT 0,
    "lifetimePurchased" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "idempotencyKey" TEXT,
    "reason" TEXT,
    "referenceId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "googlePropertyId" TEXT,
    "googlePropertyUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchConsoleProperty" (
    "id" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "projectId" TEXT,
    "propertyUrl" TEXT NOT NULL,
    "permissionLevel" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchConsoleProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Url" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" "UrlStatus" NOT NULL DEFAULT 'IMPORTED',
    "httpStatus" INTEGER,
    "lastCrawl" TIMESTAMP(3),
    "lastInspectedAt" TIMESTAMP(3),
    "lastAnalyzedAt" TIMESTAMP(3),
    "lastIndexedAt" TIMESTAMP(3),
    "lastGoogleVerdict" TEXT,
    "lastCoverageState" TEXT,
    "lastInspectionId" TEXT,
    "discoveryStatus" TEXT,
    "scheduledReinspectionAt" TIMESTAMP(3),
    "matchedPropertyId" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Url_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlStatusHistory" (
    "id" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "oldStatus" "UrlStatus",
    "newStatus" "UrlStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlAnalysis" (
    "id" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "redirectChain" TEXT NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "contentType" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "robotsMeta" TEXT,
    "canonicalUrl" TEXT,
    "xRobotsTag" TEXT,
    "robotsTxtStatus" TEXT,
    "issues" TEXT NOT NULL,
    "passedAudit" BOOLEAN NOT NULL DEFAULT false,
    "hasStructuredJob" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleInspection" (
    "id" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "coverageState" TEXT,
    "indexingState" TEXT,
    "robotsTxtState" TEXT,
    "pageFetchState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "crawledAs" TEXT,
    "lastCrawlTime" TIMESTAMP(3),
    "rawResponse" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexingJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DISCOVERY_AND_INSPECTION',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "totalUrls" INTEGER NOT NULL DEFAULT 0,
    "queuedUrls" INTEGER NOT NULL DEFAULT 0,
    "processingUrls" INTEGER NOT NULL DEFAULT 0,
    "completedUrls" INTEGER NOT NULL DEFAULT 0,
    "failedUrls" INTEGER NOT NULL DEFAULT 0,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "creditsRefunded" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "metadata" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexingJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "operationResult" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexingJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "urlId" TEXT,
    "operation" "JobOperation" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT,
    "error" TEXT,
    "metadata" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sitemap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sitemapUrl" TEXT NOT NULL,
    "isIndex" BOOLEAN NOT NULL DEFAULT false,
    "urlCount" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sitemap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "totalUrls" INTEGER NOT NULL DEFAULT 0,
    "validUrls" INTEGER NOT NULL DEFAULT 0,
    "invalidUrls" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "errorReport" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlEvent" (
    "id" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userAgent" TEXT,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTxId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "creditsGranted" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_userId_key" ON "CreditWallet"("userId");

-- CreateIndex
CREATE INDEX "CreditWallet_userId_idx" ON "CreditWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditTransaction_walletId_idx" ON "CreditTransaction"("walletId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "CreditTransaction_idempotencyKey_idx" ON "CreditTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Project_domain_idx" ON "Project"("domain");

-- CreateIndex
CREATE INDEX "GoogleAccount_userId_idx" ON "GoogleAccount"("userId");

-- CreateIndex
CREATE INDEX "GoogleAccount_email_idx" ON "GoogleAccount"("email");

-- CreateIndex
CREATE INDEX "SearchConsoleProperty_projectId_idx" ON "SearchConsoleProperty"("projectId");

-- CreateIndex
CREATE INDEX "SearchConsoleProperty_propertyUrl_idx" ON "SearchConsoleProperty"("propertyUrl");

-- CreateIndex
CREATE UNIQUE INDEX "SearchConsoleProperty_googleAccountId_propertyUrl_key" ON "SearchConsoleProperty"("googleAccountId", "propertyUrl");

-- CreateIndex
CREATE INDEX "Url_projectId_idx" ON "Url"("projectId");

-- CreateIndex
CREATE INDEX "Url_normalizedUrl_idx" ON "Url"("normalizedUrl");

-- CreateIndex
CREATE INDEX "Url_status_idx" ON "Url"("status");

-- CreateIndex
CREATE INDEX "Url_hostname_idx" ON "Url"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "Url_projectId_normalizedUrl_key" ON "Url"("projectId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "UrlStatusHistory_urlId_idx" ON "UrlStatusHistory"("urlId");

-- CreateIndex
CREATE INDEX "UrlStatusHistory_createdAt_idx" ON "UrlStatusHistory"("createdAt");

-- CreateIndex
CREATE INDEX "UrlAnalysis_urlId_idx" ON "UrlAnalysis"("urlId");

-- CreateIndex
CREATE INDEX "GoogleInspection_urlId_idx" ON "GoogleInspection"("urlId");

-- CreateIndex
CREATE UNIQUE INDEX "IndexingJob_idempotencyKey_key" ON "IndexingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IndexingJob_userId_idx" ON "IndexingJob"("userId");

-- CreateIndex
CREATE INDEX "IndexingJob_projectId_idx" ON "IndexingJob"("projectId");

-- CreateIndex
CREATE INDEX "IndexingJob_status_idx" ON "IndexingJob"("status");

-- CreateIndex
CREATE INDEX "IndexingJobItem_jobId_idx" ON "IndexingJobItem"("jobId");

-- CreateIndex
CREATE INDEX "IndexingJobItem_urlId_idx" ON "IndexingJobItem"("urlId");

-- CreateIndex
CREATE INDEX "IndexingJobItem_status_idx" ON "IndexingJobItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IndexJob_idempotencyKey_key" ON "IndexJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IndexJob_userId_idx" ON "IndexJob"("userId");

-- CreateIndex
CREATE INDEX "IndexJob_urlId_idx" ON "IndexJob"("urlId");

-- CreateIndex
CREATE INDEX "IndexJob_status_idx" ON "IndexJob"("status");

-- CreateIndex
CREATE INDEX "IndexAttempt_jobId_idx" ON "IndexAttempt"("jobId");

-- CreateIndex
CREATE INDEX "Sitemap_projectId_idx" ON "Sitemap"("projectId");

-- CreateIndex
CREATE INDEX "Import_projectId_idx" ON "Import"("projectId");

-- CreateIndex
CREATE INDEX "CrawlEvent_urlId_idx" ON "CrawlEvent"("urlId");

-- CreateIndex
CREATE INDEX "CrawlEvent_timestamp_idx" ON "CrawlEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTxId_key" ON "Payment"("providerTxId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_providerTxId_idx" ON "Payment"("providerTxId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventId_idx" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_idx" ON "WebhookEvent"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "SystemSetting_key_idx" ON "SystemSetting"("key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleProperty" ADD CONSTRAINT "SearchConsoleProperty_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleProperty" ADD CONSTRAINT "SearchConsoleProperty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Url" ADD CONSTRAINT "Url_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Url" ADD CONSTRAINT "Url_matchedPropertyId_fkey" FOREIGN KEY ("matchedPropertyId") REFERENCES "SearchConsoleProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlStatusHistory" ADD CONSTRAINT "UrlStatusHistory_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlAnalysis" ADD CONSTRAINT "UrlAnalysis_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleInspection" ADD CONSTRAINT "GoogleInspection_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJobItem" ADD CONSTRAINT "IndexingJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IndexingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJobItem" ADD CONSTRAINT "IndexingJobItem_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexJob" ADD CONSTRAINT "IndexJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexJob" ADD CONSTRAINT "IndexJob_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexAttempt" ADD CONSTRAINT "IndexAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IndexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sitemap" ADD CONSTRAINT "Sitemap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlEvent" ADD CONSTRAINT "CrawlEvent_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
