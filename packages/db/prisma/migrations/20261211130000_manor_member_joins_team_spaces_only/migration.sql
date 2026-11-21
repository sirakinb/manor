-- Manor: every space is either a team space (a shared account plus people) or one person's own
-- space. Upstream's shared spaces (v0.9.0) dropped the per-person filters on bots, chats, groups,
-- routines and memory and treat everything in a space as visible to its members, so a second
-- person in a space without a shared account would see and use the first person's work.
--
-- A new organization member used to join the organization's default space and its team spaces.
-- Now they join its team spaces, and its default space only while nobody is in it yet (the owner
-- of a new organization). A person joining an organization gets a space of their own from the
-- application (`joinOrganization` / `ensureOwnSpace` in packages/db/src/bootstrap-user.ts).
CREATE OR REPLACE FUNCTION ensure_default_space_membership() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "space_members" ("id", "spaceId", "organizationId", "userId", "role", "createdAt")
  SELECT CASE WHEN space."isDefault" THEN 'default-space-member:' || NEW."id"
         ELSE 'space-member:' || NEW."id" || ':' || space."id" END, space."id",
    NEW."organizationId", NEW."userId", NEW."role", NEW."createdAt"
  FROM "spaces" AS space
  WHERE space."organizationId" = NEW."organizationId"
    AND NEW."role" <> 'service'
    AND (
      space."accountUserId" IS NOT NULL
      OR (
        space."isDefault"
        AND NOT EXISTS (
          SELECT 1 FROM "space_members" AS person
          JOIN "user" AS account ON account."id" = person."userId"
          WHERE person."spaceId" = space."id" AND NOT account."isSpaceAccount"
        )
      )
    )
  ON CONFLICT ("spaceId", "userId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
