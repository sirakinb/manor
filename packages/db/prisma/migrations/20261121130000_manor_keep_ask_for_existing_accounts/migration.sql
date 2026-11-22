-- Manor: an account with no saved approval preference now defaults to upstream's Auto. Before
-- this sync every such account asked a person before acting, so existing accounts (including
-- shared-space accounts) get an explicit Ask row. Rows copied by 20261025200000_account_settings
-- are left alone. Runs as the table owner, which row-level security does not restrict.
INSERT INTO "user_action_auto_review_preferences"
  ("userId", "enabled", "skipApprovals", "createdAt", "updatedAt")
SELECT u."id", false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "user" u
ON CONFLICT ("userId") DO NOTHING;

-- A Space that overrides "confirmations" reads its own row, and a missing one is also Auto now.
-- Give those members an explicit Ask row there; the reply-check columns keep their defaults.
INSERT INTO "action_auto_review_preferences"
  ("id", "spaceId", "userId", "enabled", "skipApprovals", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."spaceId", o."userId", false, false,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "space_setting_overrides" o
WHERE o."setting" = 'confirmations'
ON CONFLICT ("spaceId", "userId") DO NOTHING;
