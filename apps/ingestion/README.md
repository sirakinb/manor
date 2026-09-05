# Manor ingestion service

The deterministic pipelines behind the Workspace (Zoho CRM call logs, Zoho
Campaigns, Instagram, Buildium, the REMA/sheet listings, WRD water bills, and
the monthly voice recap), run on request by Manor's worker. The service holds
no credentials of its own: every request carries the decrypted provider
fields the pipeline needs, and every write is scoped by the `workspaceId` in
that request.

## Endpoints

- `GET /health` – open; lists the pipelines.
- `POST /run/{pipeline}` – body `{ runId, workspaceId, credentials, options }`,
  signed with `X-Manor-Timestamp` (unix seconds) and `X-Manor-Signature`
  (hex HMAC-SHA256 of `timestamp.body` with `INGESTION_SECRET`, constant-time
  compared, 5-minute skew). Returns `{ ok, recordsLoaded, notes }` or
  `{ ok: false, recordsLoaded: 0, error }` (sanitized). `401` on a bad
  signature, `404` on an unknown pipeline, `409` while the same pipeline is
  already running for that workspace.

Pipelines: `zoho-agent-logs` (credential `zoho-crm`: clientId, clientSecret,
refreshToken), `zoho-campaigns` (`zoho-campaigns`: same fields), `instagram`
(`instagram`: pageToken, igUserId), `buildium` (`buildium`: clientId,
clientSecret), `listings` (no credential; options `remaUrl`, `sheetId` or
`sheetCsvUrl`, from the Listings source config), `water` (`gmail`: clientId,
clientSecret, refreshToken; option `gmailQuery`), `recap` (`openrouter`:
apiKey, optional `model`).

## Environment

- `DATABASE_URL` – Manor's Postgres.
- `INGESTION_SECRET` – shared with the API and worker.
- `DLT_PIPELINES_DIR` – scratch dir for dlt (default `/tmp/dlt`); state is
  also stored in the destination, so it may be ephemeral.

## Run locally

```
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest
DATABASE_URL=postgres://... INGESTION_SECRET=dev uvicorn ingestion.app:app --port 8080
```

The tests are offline: parsers, the address normalizer (parity with the SQL
used at import time), response mapping, gating, and the signature check.

For warehouse conformance, apply Manor's migrations to a disposable local
database and set `INGESTION_TEST_DATABASE_URL` when running pytest. These
tests use fictional workspaces and mocked provider APIs, exercise the actual
SQL writes, and verify dlt resumes after losing its local working directory.
They clean up their rows and raw datasets afterwards.

The image runs as an unprivileged user with dlt telemetry disabled. Run one
Uvicorn process per deployment: per-workspace pipeline locks are process-local.
Blocking pipeline work runs in a thread so health checks remain responsive.
