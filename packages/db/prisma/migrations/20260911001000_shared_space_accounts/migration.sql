ALTER TABLE "user" ADD COLUMN "isSpaceAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "authorUserId" TEXT, ADD COLUMN "authorName" TEXT;
ALTER TABLE "runs" ADD COLUMN "initiatedByUserId" TEXT;
ALTER TABLE "spaces" ADD COLUMN "accountUserId" TEXT;
CREATE UNIQUE INDEX "spaces_accountUserId_key" ON "spaces"("accountUserId");
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_accountUserId_fkey"
  FOREIGN KEY ("accountUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Organization membership includes team spaces, including for future teammates.
CREATE OR REPLACE FUNCTION ensure_default_space_membership() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "space_members" ("id", "spaceId", "organizationId", "userId", "role", "createdAt")
  SELECT CASE WHEN space."isDefault" THEN 'default-space-member:' || NEW."id"
         ELSE 'space-member:' || NEW."id" || ':' || space."id" END, space."id",
    NEW."organizationId", NEW."userId", NEW."role", NEW."createdAt"
  FROM "spaces" AS space
  WHERE space."organizationId" = NEW."organizationId"
    AND NEW."role" <> 'service'
    AND (space."isDefault" OR space."accountUserId" IS NOT NULL)
  ON CONFLICT ("spaceId", "userId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
