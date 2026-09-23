-- Opt-in check of bot replies against the tool results they cite.
ALTER TABLE "action_auto_review_preferences" ADD COLUMN "checkAnswers" BOOLEAN NOT NULL DEFAULT false;
