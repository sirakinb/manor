# Weekly dependency updates

`weekly-dependencies.yml` runs the Codex CLI on a GitHub-hosted Ubuntu runner
every Tuesday and supports manual dispatch from `main`. The prompt in
`prompts/weekly-dependencies.md` owns the investigation, updates, and validation.
An existing weekly update PR pauses new batches. PRs require review and merge.

Configure two repository Actions secrets, then set the `WEEKLY_DEPENDENCIES_ENABLED` variable to `true`:

- `CODEX_SUBSCRIPTION_AUTH`: refreshable Codex ChatGPT login (`auth.json`).
- `GH_DEPENDENCY_UPDATES_PAT`: a fine-grained GitHub personal access token limited
  to this repository, with **Contents**, **Pull requests**, and **Secrets** write
  permissions. It persists refreshed login credentials and publishes PRs whose
  checks start automatically.

Create a separate file-backed Codex login for this workflow using a temporary
`CODEX_HOME`, then upload it without printing credentials:

```sh
updater_home=$(mktemp -d)
CODEX_HOME="$updater_home" codex -c 'cli_auth_credentials_store="file"' login --device-auth
gh secret set CODEX_SUBSCRIPTION_AUTH < "$updater_home/auth.json"
rm -rf "$updater_home"
gh secret set GH_DEPENDENCY_UPDATES_PAT
```

Use that login only for this serialized workflow. Codex refreshes the cache;
the workflow writes it back to the secret even after an update failure. If
authentication is revoked or refresh fails, repeat the login and replace the
secret. No OpenAI API key is used, so requests use the Codex subscription.

Codex runs as a separate unprivileged user without the GitHub write token.
A fresh publishing job applies the patch after rejecting workflow, agent
instruction, and environment-file changes. Only the patch and PR description
are uploaded; authentication and session logs are never artifacts.

## Workflows and what turns them on

Automation that needs a token Manor has not set up stays off behind a repository variable, so it
skips instead of failing or acting with the default token. Set the variable only after its
secrets exist.

| Workflow                                                                   | Runs on                                               | Needs                                                                         | Turned on by                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `ci.yml`                                                                   | pull requests, pushes to `main`                       | `EXPO_TOKEN` for mobile updates; production deploy secrets                    | always on                                |
| `playwright.yml`                                                           | called by `ci.yml` and the nightly run                | S3 settings only to publish reports                                           | always on                                |
| `nightly-verification.yml`                                                 | nightly, manual                                       | S3 settings                                                                   | `S3_BUCKET` variable                     |
| `publish-playwright-report.yml`                                            | after `ci`                                            | S3 settings                                                                   | `S3_BUCKET` variable                     |
| `publish-server-image.yml`                                                 | called by `ci.yml` on `main`                          | workflow token                                                                | always on                                |
| `vps-release.yml`                                                          | pull requests touching the release controller, manual | none                                                                          | always on                                |
| `release-desktop.yml`                                                      | release tags                                          | signing secrets, `DESKTOP_RELEASE_TOKEN`                                      | fails early without signing settings     |
| `release-mobile.yml`, `release-android-apk.yml`, `release-google-play.yml` | manual                                                | Expo and store credentials                                                    | manual only                              |
| `computer-replay.yml`, `desktop-macos-screenshot.yml`                      | pull requests touching their paths                    | none                                                                          | always on                                |
| `mobile-android-screenshots.yml`, `topology-verification.yml`              | manual                                                | S3 settings for screenshots                                                   | manual only                              |
| `review-bot.yml`                                                           | comments from Qodo or CodeRabbit on pull requests     | workflow token (labels only)                                                  | acts only when those review apps comment |
| `issue-triage.yml`                                                         | new issues                                            | `CLAUDE_CODE_OAUTH_TOKEN`                                                     | `ISSUE_TRIAGE_ENABLED=true`              |
| `translation-catalogs.yml`                                                 | pushes to `main` touching web sources                 | `GH_DEPENDENCY_UPDATES_PAT`                                                   | `CATALOG_SYNC_ENABLED=true`              |
| `weekly-dependencies.yml`                                                  | Tuesdays, manual                                      | `CODEX_SUBSCRIPTION_AUTH`, `GH_DEPENDENCY_UPDATES_PAT`                        | `WEEKLY_DEPENDENCIES_ENABLED=true`       |
| `model-catalog-bump.yml`                                                   | Mondays, manual                                       | `GH_DEPENDENCY_UPDATES_PAT`                                                   | `MODEL_CATALOG_BUMP_ENABLED=true`        |
| `preview-build.yml`                                                        | pull requests touching app code                       | none                                                                          | `FLY_PREVIEW_ORG` variable               |
| `preview-deploy.yml`, `preview-cleanup.yml`                                | after a preview build; closed pull requests, daily    | `FLY_PREVIEW_TOKEN`, Fly variables, `CLAUDE_CODE_OAUTH_TOKEN` for screenshots | skip without `FLY_PREVIEW_TOKEN`         |
