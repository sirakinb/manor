-- Manor: stamp each author-less user message with its thread's owner, the rule upstream's team-space
-- conversion already applies (`space-account.ts`). Upstream's routines read only messages whose
-- author speaks for the routine's owner, and its approval checks treat an author-less message as
-- someone else's words; before this, `authorUserId` was filled only in team spaces, so a person's
-- own older messages in their own space counted as nobody's.
--
-- Left alone:
-- * Threads owned by a team space's shared account. The conversion stamped their messages with the
--   person who owned the thread before it; a remaining author-less row there is not a person's, and
--   the shared account is never a person author.
-- * Rows that are not the owner's own words, told apart by their blocks (the `kind` key stays
--   readable when blocks are encrypted): a message from a connected chat channel
--   (`channel_message`), a webhook, email or chat-app delivery that woke the bot (`delivery`), a
--   message from another bot (`bot_message_received`) and a handoff. Rows whose blocks are not an
--   array of entries with a kind are skipped, as upstream's routine filter skips them. A linked chat
--   app message already carries its person's id.
-- * `authorName` (Manor's column, used only for the `[name]` prefix in team spaces), and every row
--   that already has an author.
--
-- Display: web and mobile show an author only when it is not the person viewing, so in a one-person
-- space the owner's older messages gain no label. Unread state and notifications are decided when
-- a message is written and do not read this column again. The schema is unchanged.
--
-- One UPDATE over `messages`. It rewrites each matching row and holds row locks until it commits;
-- the deploy runs it with the API and worker stopped. Count the matching rows on the rehearsal copy
-- first; batch it only if that count is in the millions.
UPDATE "messages" AS m
SET "authorUserId" = t."userId"
FROM "threads" AS t
JOIN "user" AS thread_owner ON thread_owner."id" = t."userId"
WHERE m."threadId" = t."id"
  AND m."role" = 'user'
  AND m."authorUserId" IS NULL
  AND NOT thread_owner."isSpaceAccount"
  AND jsonb_typeof(m."blocks") = 'array'
  AND NOT jsonb_path_exists(
    m."blocks",
    '$[*] ? (@.kind == "channel_message" || @.kind == "delivery" || @.kind == "bot_message_received" || @.kind == "handoff" || !(exists(@.kind)))'
  );
