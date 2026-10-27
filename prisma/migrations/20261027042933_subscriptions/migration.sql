-- AlterEnum
ALTER TYPE "GiftStatus" ADD VALUE 'ACTIVE';

-- AlterEnum
ALTER TYPE "TransactionSource" ADD VALUE 'SUBSCRIPTION';

-- AlterTable
ALTER TABLE "Church" ADD COLUMN     "paypalProductId" TEXT;

-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "paypalPlanId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Fund_paypalPlanId_key" ON "Fund"("paypalPlanId");

