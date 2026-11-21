-- Manor: new accounts default to the robot avatar style, which shows Manor's
-- sprite avatars. Upstream moved the default to organic in
-- 20261015120000_organic_avatar_default; this restores Manor's default on top.
--
-- Changes only the column default. Existing rows keep their stored choice.
ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'robot';
