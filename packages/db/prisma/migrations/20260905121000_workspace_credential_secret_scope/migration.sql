-- Workspace credentials are organization-scoped: their secrets hang off the
-- workspace_credentials row (cascade) and carry no spaceId, like the
-- user-scoped model and voice credentials do.
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_scope_check";
ALTER TABLE "secrets"
  ADD CONSTRAINT "secrets_scope_check"
  CHECK (
    ("kind" IN ('model', 'voice', 'workspace-credential') AND "spaceId" IS NULL)
    OR ("kind" NOT IN ('model', 'voice', 'workspace-credential') AND "spaceId" IS NOT NULL)
  );
