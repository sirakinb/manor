<!-- Modified for Manor: contribution scope, project links, and reporting contacts. -->
# Contributing to Manor

Manor is a template you can adapt for your own service business. The maintainer
continues to develop the core product; using or customizing a fork does not require
contributing changes back.

Suggestions and bug reports are welcome in
[the Manor repository](https://github.com/sirakinb/manor). Before investing in a
large pull request, open an issue to discuss whether it fits the
[product priorities](WISHLIST.md). Business-specific features can stay in your fork.
Pull requests are considered for fit with the product direction; acceptance and
ongoing support for custom deployments are not guaranteed. Keep changes focused
and testable.
For vulnerabilities, use the private reporting process in [SECURITY.md](SECURITY.md).

## Run locally

See [README.md](README.md) for full details. Quick start from the repo root:

```bash
cp .env.example .env
# Configure the required secrets and sandbox token as described in README.md.
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

## Checks before you open a PR

| Command | When to run |
| --- | --- |
| `pnpm test` | Default. Units, properties, and in-process contracts. Scripted runtime, fake sandbox, in-memory wakeup — no live connector or model-provider calls. |
| `pnpm test:integration` | Postgres via Testcontainers: product journeys, authorization, executor lifecycle, Graphile / LISTEN/NOTIFY. Needs Docker. |
| `pnpm test:e2e` | Playwright against the emulated API. Needs Docker. |
| `pnpm test:topology` | Local product-path smoke: Docker computer + Graphile worker recovery. Needs Docker. Not PR CI. |
| `pnpm test:canary` | Live OpenRouter / E2B canaries. Needs keys. Not PR CI. |
| `pnpm test:computer` | Real vision model + E2B desktop. Needs keys; see README. Not PR CI. |
| `pnpm check` | TypeScript (`tsc`) across the monorepo. |
| `pnpm lint` | Biome lint and format check. |

CI runs `pnpm lint`, `pnpm check`, production builds (including Electron preload smoke), `pnpm test`, `pnpm test:integration`, and `pnpm test:e2e` on every PR.

## Secrets and configuration

- **Never** commit `.env` files or secrets.
- **Never** paste API keys, tokens, or passwords in issues or PRs.
- Use placeholders in examples (`your-openrouter-key`, etc.).

The product path is **Pi + Docker + Graphile**. Emulator settings (`AGENT_RUNTIME=scripted`, `SANDBOX_PROVIDER=fake`, `WAKEUP_DRIVER=memory`) are for tests only.

**Integrations** can use [Composio](https://composio.dev/) or Pipedream Connect as optional managed
app catalogs. Users can also install HTTPS MCP servers (including Treg) and bounded OpenAPI tool
sources. Connector tests must stay deterministic and offline. Never put connector credentials in
capability config, fixtures, logs, or snapshots; use the encrypted secret store and fake placeholders.

## Pull requests

- Keep PRs small and easy to review.
- Target the `main` branch.
- Describe why the change is needed, what changed, and **how you tested** (e.g. `pnpm test`, manual steps).
- Link related issues when applicable.
- Cover web, desktop, and mobile wherever the change applies. Explain any platform limitations.
- For UI changes, include the relevant CI screenshot. Wait for required checks and automated reviews
  to finish, and address actionable findings before merging.

## Help and security

| Where | Use for |
| --- | --- |
| [Private vulnerability report](https://github.com/sirakinb/manor/security/advisories/new) | Security issues — see [SECURITY.md](SECURITY.md) |
| [Manor issues](https://github.com/sirakinb/manor/issues/new/choose) | Bugs and self-hosting help; redact secrets and private data |

Workspace package names such as `@rakazo/desktop` and configuration keys beginning with
`RAKAZO_` remain compatibility identifiers. Use the names in the checked-in scripts and examples.

## Licenses and attribution

Contributions are provided under this repository’s Apache-2.0 license unless explicitly agreed
otherwise. Retain existing copyright and attribution notices, and mark changes to upstream files.
For copied code, fonts, images, or other assets, record the source and applicable license; do not
assume the repository license covers third-party material. Include required full license texts in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) or an adjacent license file.

See the [distribution review](docs/licensing.md) before publishing downloadable builds.
