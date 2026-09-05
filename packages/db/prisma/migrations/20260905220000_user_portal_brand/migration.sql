ALTER TABLE "user" ADD COLUMN "portalBrandId" TEXT;

-- Existing client-only accounts inherit their one branded organization's portal.
-- Multi-organization administrators keep their current access until explicitly assigned.
UPDATE "user" AS u SET "portalBrandId" = memberships.brand
FROM (
  SELECT m."userId", min(o."brandId") AS brand
  FROM member m JOIN organization o ON o.id = m."organizationId"
  GROUP BY m."userId"
  HAVING count(DISTINCT o."brandId") = 1 AND count(*) = count(o."brandId")
) memberships
WHERE u.id = memberships."userId"
  AND NOT EXISTS (SELECT 1 FROM deployment_settings d WHERE d."ownerUserId" = u.id);
