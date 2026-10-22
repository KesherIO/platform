-- Analyzer connector: per-lab revocable credentials, raw message store, explicit
-- sample links and parameter mappings. Additive only; no existing table changes.
-- (The INSTRUMENT_RESULTS_IMPORTED timeline value is in the previous migration.)


-- CreateEnum
CREATE TYPE "InstrumentMessageStatus" AS ENUM ('RECEIVED', 'INCOMPLETE', 'DUPLICATE', 'UNMATCHED', 'AMBIGUOUS', 'NEEDS_REVIEW', 'IMPORTED', 'DISMISSED', 'FAILED');

-- CreateTable
CREATE TABLE "connector_credentials" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "analyzerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenAddress" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_messages" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "analyzerId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "receivedAtConnector" TIMESTAMP(3) NOT NULL,
    "connectorLocalId" TEXT,
    "remoteAddress" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT true,
    "incompleteReason" TEXT,
    "status" "InstrumentMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "reasons" TEXT[],
    "controlId" TEXT,
    "sampleId" TEXT,
    "messageTime" TEXT,
    "observationTime" TIMESTAMP(3),
    "contentHash" TEXT,
    "hasAnalyzerEdits" BOOLEAN NOT NULL DEFAULT false,
    "hasExpiredReagent" BOOLEAN NOT NULL DEFAULT false,
    "parsed" JSONB,
    "diff" JSONB,
    "previousMessageId" TEXT,
    "orderId" TEXT,
    "orderedTestId" TEXT,
    "sampleLinkId" TEXT,
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_message_payloads" (
    "messageId" TEXT NOT NULL,
    "compression" TEXT NOT NULL DEFAULT 'gzip',
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "instrument_message_payloads_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "instrument_sample_links" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "analyzerId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_sample_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_parameter_mappings" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "analyzerId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "analyzerUnit" TEXT NOT NULL,
    "catalogItemCode" TEXT NOT NULL,
    "analyteCode" TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_parameter_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connector_credentials_tokenPrefix_key" ON "connector_credentials"("tokenPrefix");

-- CreateIndex
CREATE INDEX "connector_credentials_labTenantId_idx" ON "connector_credentials"("labTenantId");

-- CreateIndex
CREATE INDEX "connector_credentials_analyzerId_idx" ON "connector_credentials"("analyzerId");

-- CreateIndex
CREATE INDEX "instrument_messages_labTenantId_status_idx" ON "instrument_messages"("labTenantId", "status");

-- CreateIndex
CREATE INDEX "instrument_messages_labTenantId_analyzerId_sampleId_idx" ON "instrument_messages"("labTenantId", "analyzerId", "sampleId");

-- CreateIndex
CREATE INDEX "instrument_messages_labTenantId_analyzerId_controlId_idx" ON "instrument_messages"("labTenantId", "analyzerId", "controlId");

-- CreateIndex
CREATE INDEX "instrument_messages_labTenantId_createdAt_idx" ON "instrument_messages"("labTenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_messages_labTenantId_analyzerId_sha256_key" ON "instrument_messages"("labTenantId", "analyzerId", "sha256");

-- CreateIndex
CREATE INDEX "instrument_sample_links_labTenantId_analyzerId_sampleId_idx" ON "instrument_sample_links"("labTenantId", "analyzerId", "sampleId");

-- CreateIndex
CREATE INDEX "instrument_sample_links_orderId_idx" ON "instrument_sample_links"("orderId");

-- CreateIndex
CREATE INDEX "instrument_parameter_mappings_labTenantId_analyzerId_idx" ON "instrument_parameter_mappings"("labTenantId", "analyzerId");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_parameter_mappings_analyzerId_parameterCode_anal_key" ON "instrument_parameter_mappings"("analyzerId", "parameterCode", "analyzerUnit", "catalogItemCode");

-- AddForeignKey
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_analyzerId_fkey" FOREIGN KEY ("analyzerId") REFERENCES "analyzers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_messages" ADD CONSTRAINT "instrument_messages_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_messages" ADD CONSTRAINT "instrument_messages_analyzerId_fkey" FOREIGN KEY ("analyzerId") REFERENCES "analyzers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_messages" ADD CONSTRAINT "instrument_messages_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "connector_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_messages" ADD CONSTRAINT "instrument_messages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_message_payloads" ADD CONSTRAINT "instrument_message_payloads_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "instrument_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_sample_links" ADD CONSTRAINT "instrument_sample_links_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_sample_links" ADD CONSTRAINT "instrument_sample_links_analyzerId_fkey" FOREIGN KEY ("analyzerId") REFERENCES "analyzers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_sample_links" ADD CONSTRAINT "instrument_sample_links_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_parameter_mappings" ADD CONSTRAINT "instrument_parameter_mappings_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_parameter_mappings" ADD CONSTRAINT "instrument_parameter_mappings_analyzerId_fkey" FOREIGN KEY ("analyzerId") REFERENCES "analyzers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API lockdown (docs/SECURITY_LOCKDOWN.md): RLS on, no policies = deny-all.
ALTER TABLE "connector_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instrument_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instrument_message_payloads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instrument_sample_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instrument_parameter_mappings" ENABLE ROW LEVEL SECURITY;
