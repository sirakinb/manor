-- Organization-owned public signup and scorecard forms.
-- CreateTable
CREATE TABLE "public_forms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crmTag" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "message" TEXT,
    "notifyEmail" TEXT,
    "senderName" TEXT,
    "signature" TEXT,
    "eventStartsAt" TIMESTAMP(3),
    "eventMinutes" INTEGER,
    "eventTimeZone" TEXT,
    "joinUrl" TEXT,
    "bookingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_forms_slug_key" ON "public_forms"("slug");

-- CreateIndex
CREATE INDEX "public_forms_organizationId_idx" ON "public_forms"("organizationId");

-- AddForeignKey
ALTER TABLE "public_forms" ADD CONSTRAINT "public_forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

