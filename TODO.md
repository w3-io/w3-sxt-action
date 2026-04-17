# TODO

## v0.2.0 — Discovery commands

SxT's Discovery REST endpoints return schema metadata that isn't
reachable via standard SQL (no `SHOW TABLES` / `INFORMATION_SCHEMA`).
Exposing them as action commands lets workflows introspect what's
there before issuing queries — useful for codegen, health checks, and
"describe this schema" steps.

- [x] `discover-schemas` — list all schemas visible to the caller
- [x] `discover-tables` — list tables in a schema (supersedes the
      non-functional `list-tables`, which relies on `SHOW TABLES` that
      SxT doesn't implement)
- [x] `discover-columns` — list columns for a given schema.table
- [x] `discover-primary-keys` — list primary-key columns
- [x] `discover-indexes` — list indexes for a table
- [x] `discover-relationships` — list foreign-key relationships
- [x] Remove the current non-functional `list-tables` command once
      `discover-tables` lands

Endpoints live under the same `api-url` the SDK targets (`BASEURL_GENERAL`
in the SxT NodeJS SDK), and should reuse the same three-mode auth
resolver the SQL commands already have.

## CI — api-key reads

- [ ] Reconfirm `SXT_API_KEY` scope and rotate if revoked; flip
      `vars.SXT_API_KEY_ENABLED` back to `true` so the reads CI job
      exercises api-key mode against `ETHEREUM.BLOCKS`. The code path
      is unit-tested; only live-cred CI is currently gated off.
