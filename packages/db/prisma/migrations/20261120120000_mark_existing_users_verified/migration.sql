-- Manor: accounts that exist before email verification is enforced were
-- provisioned or admitted by the operator, so they are trusted as verified.
-- Without this, a deployment with a signup allowlist would refuse every
-- existing password account its next session, because Manor never asked
-- anyone to verify an address.
--
-- Data only: no table, column, constraint or index changes. Idempotent: a
-- second run matches no rows. Internal messaging identities (the reserved
-- @messaging.invalid addresses) have no mailbox and stay unverified.
UPDATE "user"
SET "emailVerified" = true
WHERE "emailVerified" = false
  AND lower("email") NOT LIKE '%@messaging.invalid';
