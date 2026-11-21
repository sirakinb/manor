-- Manor: Workspace credentials are organization-wide, so their secrets never belong to a Space.
-- 20261029150000_space_availability loosened secrets_scope_check and dropped this rule; it comes
-- back as its own constraint so it never collides with upstream's.
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_workspace_credential_scope_check"
  CHECK ("kind" <> 'workspace-credential' OR "spaceId" IS NULL) NOT VALID;
ALTER TABLE "secrets" VALIDATE CONSTRAINT "secrets_workspace_credential_scope_check";
