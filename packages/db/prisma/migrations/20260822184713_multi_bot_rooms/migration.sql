-- Retired. Manor's custom multi-bot rooms were replaced by upstream group
-- chats, and 0012b_retire_custom_rooms dropped everything this migration
-- created. Databases that ran the original version have it recorded and skip
-- this file; on fresh databases the numbered migrations (including 0012b)
-- sort first, so recreating the room schema here would only reintroduce
-- drift that nothing cleans up. Intentionally a no-op.
SELECT 1;
