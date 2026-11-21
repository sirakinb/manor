-- Manor: every space is either a team space (a shared account plus people) or one person's own
-- space (see 20261211130000_manor_member_joins_team_spaces_only). Existing spaces without a shared
-- account that hold several people are brought to one person here. Authored content is never
-- moved or deleted, and the migration never chooses between two people who both have some.
--
-- Authored content: a row the person owns in that space in bots, bot_sections, chat_groups,
-- threads, tasks, runs, routines, scratchpad_items, taught_skills, agent_imports, connections,
-- capability_installs, mcp_servers, secrets, bot_credentials, bot_secrets, vault_credentials,
-- artifacts, pages, computers, agent_homes, browser_profiles, external_conversations,
-- messaging_identities, messaging_installations, cloud_agents, local_devices, purchases, payments;
-- any agent_skills row and any memory_documents row except the derived ones below.
--
-- Derived, not content (re-created by the product, never edited):
--   * the seeded memory file: memory_documents scope 'user', path 'MEMORY.md', no bot, revision 1;
--   * the organization's Workspace knowledge that importWorkspaceKnowledge
--     (packages/db/src/workspace-knowledge.ts) copies into each person's memory: scope 'user',
--     path 'workspace/…', no bot, revision 1, with that person's workspace_knowledge_imports row;
--   * the Workspace playbooks the same import creates: agent_skills source 'user', no install,
--     not available everywhere, named 'workspace-…', containing the import's fixed
--     "# Using this imported playbook" preamble, and never updated (createdAt = updatedAt);
--   * the workspace_knowledge_imports row itself.
-- An edited copy (memory revision > 1, a playbook updated after its creation) is content.
--
-- Per space: one person with content keeps it; nobody with content keeps the earliest member; two
-- or more people with content stop the deploy, so an operator resolves it first
-- (docs/upstream-sync.md). Spaces shared by an accepted invite are left alone. For each removed
-- person the migration deletes, in that space only: their derived rows above (memory revisions go
-- with their documents, availability rows with their skills), their notification_preferences,
-- action_auto_review_preferences and action_approval_rules, their agent_skill_spaces,
-- mcp_server_spaces and capability_install_spaces rows (which would offer their skills and
-- servers from other spaces here), and their space_members row, which cascades to their
-- thread_reads, space_model_preferences, space_voice_preferences, ai_data_consents,
-- space_model_role_choices, space_setting_overrides and workspace_knowledge_imports. They keep
-- their organization membership and get a space of their own at their next sign-in
-- (bootstrapUserSpace / ensureOwnSpace), where the Workspace import runs again.
CREATE OR REPLACE FUNCTION pg_temp.manor_derived_memory(doc "memory_documents") RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT doc."scope" = 'user' AND doc."botId" IS NULL AND doc."revision" = 1
    AND (
      doc."path" = 'MEMORY.md'
      OR (
        doc."path" LIKE 'workspace/%'
        AND EXISTS (
          SELECT 1 FROM "workspace_knowledge_imports" k
          WHERE k."spaceId" = doc."spaceId" AND k."userId" = doc."userId"
        )
      )
    )
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.manor_derived_skill(skill "agent_skills") RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT skill."source" = 'user' AND skill."installId" IS NULL AND NOT skill."allSpaces"
    AND skill."name" LIKE 'workspace-%'
    AND skill."createdAt" = skill."updatedAt"
    AND strpos(skill."content", '# Using this imported playbook') > 0
    AND EXISTS (
      SELECT 1 FROM "workspace_knowledge_imports" k
      WHERE k."spaceId" = skill."spaceId" AND k."userId" = skill."userId"
    )
$fn$;

DO $$
DECLARE
  target RECORD;
  removed TEXT[];
BEGIN
  FOR target IN
    WITH people AS (
      SELECT m."spaceId", m."userId", m."createdAt", m."id",
        (
          EXISTS (SELECT 1 FROM "bots" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "bot_sections" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "chat_groups" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "threads" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "tasks" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "runs" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "routines" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "scratchpad_items" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "taught_skills" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "agent_imports" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "connections" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "capability_installs" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "mcp_servers" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "secrets" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "bot_credentials" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "bot_secrets" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "vault_credentials" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "artifacts" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "pages" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "computers" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "agent_homes" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "browser_profiles" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "external_conversations" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "messaging_identities" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "messaging_installations" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "cloud_agents" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "local_devices" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "purchases" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (SELECT 1 FROM "payments" x WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId")
          OR EXISTS (
            SELECT 1 FROM "agent_skills" x
            WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId"
              AND NOT pg_temp.manor_derived_skill(x)
          )
          OR EXISTS (
            SELECT 1 FROM "memory_documents" x
            WHERE x."spaceId" = m."spaceId" AND x."userId" = m."userId"
              AND NOT pg_temp.manor_derived_memory(x)
          )
        ) AS "hasContent"
      FROM "space_members" m
      JOIN "user" u ON u."id" = m."userId" AND NOT u."isSpaceAccount"
      JOIN "spaces" s ON s."id" = m."spaceId" AND s."accountUserId" IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM "space_invites" i WHERE i."spaceId" = m."spaceId" AND i."acceptedAt" IS NOT NULL
      )
    )
    SELECT "spaceId",
      count(*) AS "people",
      count(*) FILTER (WHERE "hasContent") AS "owners",
      (array_agg("userId" ORDER BY "hasContent" DESC, "createdAt", "id"))[1] AS "keeper"
    FROM people
    GROUP BY "spaceId"
    HAVING count(*) > 1
  LOOP
    IF target."owners" > 1 THEN
      RAISE EXCEPTION 'Manor: space % has % people, % of whom own content there; a space without a shared account holds one person. Resolve it before deploying (docs/upstream-sync.md, deploy checklist).',
        target."spaceId", target."people", target."owners";
    END IF;

    SELECT array_agg(m."userId") INTO removed
    FROM "space_members" m
    JOIN "user" u ON u."id" = m."userId" AND NOT u."isSpaceAccount"
    WHERE m."spaceId" = target."spaceId" AND m."userId" <> target."keeper";

    -- Derived rows first: the Workspace test reads the import marker, which goes with the
    -- membership.
    DELETE FROM "memory_documents" x
    WHERE x."spaceId" = target."spaceId" AND x."userId" = ANY (removed)
      AND pg_temp.manor_derived_memory(x);
    DELETE FROM "agent_skills" x
    WHERE x."spaceId" = target."spaceId" AND x."userId" = ANY (removed)
      AND pg_temp.manor_derived_skill(x);
    DELETE FROM "workspace_knowledge_imports"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "notification_preferences"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "action_auto_review_preferences"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "action_approval_rules"
    WHERE "spaceId" = target."spaceId" AND "createdByUserId" = ANY (removed);
    DELETE FROM "agent_skill_spaces"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "mcp_server_spaces"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "capability_install_spaces"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
    DELETE FROM "space_members"
    WHERE "spaceId" = target."spaceId" AND "userId" = ANY (removed);
  END LOOP;
END $$;
