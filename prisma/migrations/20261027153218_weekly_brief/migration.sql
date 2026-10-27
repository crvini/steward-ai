-- CreateTable
CREATE TABLE "WeeklyBrief" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "facts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyBrief_churchId_weekOf_key" ON "WeeklyBrief"("churchId", "weekOf");

