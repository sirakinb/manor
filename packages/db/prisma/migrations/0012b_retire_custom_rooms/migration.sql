-- Manor's own multi-bot rooms are retired in favor of upstream group chats.
-- This runs before 0013_group_chats, whose bot-or-group constraint a bot-less
-- room thread would violate. Deletes cascade through messages, runs, and
-- events via their existing foreign keys.
--
-- Guarded: on a fresh database this migration sorts before the (now no-op)
-- 20260822184713_multi_bot_rooms that created these columns, so none of them
-- exist and there is nothing to retire.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'threads' AND column_name = 'kind'
  ) THEN
    DELETE FROM "threads" WHERE "kind" = 'room';
  END IF;
END $$;
DROP TABLE IF EXISTS "thread_participants";
ALTER TABLE "threads" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "threads" DROP COLUMN IF EXISTS "name";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "authorBotId";
