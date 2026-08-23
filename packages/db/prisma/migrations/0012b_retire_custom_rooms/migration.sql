-- Manor's own multi-bot rooms are retired in favor of upstream group chats.
-- This runs before 0013_group_chats, whose bot-or-group constraint a bot-less
-- room thread would violate. Deletes cascade through messages, runs, and
-- events via their existing foreign keys.
DELETE FROM "threads" WHERE "kind" = 'room';
DROP TABLE IF EXISTS "thread_participants";
ALTER TABLE "threads" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "threads" DROP COLUMN IF EXISTS "name";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "authorBotId";
