-- Manor: 20261116120000_bot_daily_check_ins adds "bots"."dailyCheckIns" defaulting to true, which
-- would let every existing bot start a run on its own once a day when it has untouched open
-- scratchpad items, spending model credit and possibly messaging people. Existing bots keep
-- today's behaviour: check-ins start off for them. Bots created after this migration get
-- upstream's default of true. A person turns it back on per bot in the bot's settings.
--
-- Data only; a no-op on an empty database. Runs as the table owner, which row-level security
-- does not restrict.
UPDATE "bots"
SET "dailyCheckIns" = false
WHERE "dailyCheckIns" = true;
