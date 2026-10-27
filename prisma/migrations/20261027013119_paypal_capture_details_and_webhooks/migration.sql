-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('CAPTURE', 'WEBHOOK', 'PAYOUT', 'SEED');

-- AlterTable
ALTER TABLE "Gift" ADD COLUMN     "payerEmail" TEXT,
ADD COLUMN     "payerId" TEXT,
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "rawCapture" JSONB,
ADD COLUMN     "rawOrder" JSONB;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "feeCents" INTEGER,
ADD COLUMN     "netCents" INTEGER,
ADD COLUMN     "source" "TransactionSource" NOT NULL DEFAULT 'CAPTURE';

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "WebhookEvent_resourceId_idx" ON "WebhookEvent"("resourceId");
