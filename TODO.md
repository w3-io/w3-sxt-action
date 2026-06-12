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

## State entity commands (w3-give Story 1.1, W3-767)

`put-entity` / `get-entity` / `query-entities` (+ NOT_SUPPORTED guards) landed
in `src/state.js`, wired in `src/index.js`, declared in both manifests, and
covered by `test/state.test.js` (35 cases: append/latest, partial-merge, CAS,
idempotency-replay, filter-operator parity, sort/limit, tenant isolation, typed
errors). `node --test` is green. See `docs/state-commands.md`.

- [ ] **External blocker — `npm ci` / `action-lint` / `build` are gated on the
      GitHub Packages registry token.** `npm install` 401s pulling private
      `@w3-io/action-core` (no valid `W3_NPM_TOKEN` on this machine/CI — same
      infra gap as `w3-pii-action`). The dependency-free unit tests run via
      `node --test`, but `format:check` / `lint` / `build` (dist) and publishing
      `@v0` need Audie to provision the registry token. Tag `@v0` after.
- [ ] **⚠️ `dist/index.js` is NOT yet rebuilt for the state commands.** The action
      runs the committed ncc bundle (`runs.main: dist/index.js`), so the new
      `put-entity`/`get-entity`/`query-entities` will not execute until
      `npm run build` regenerates `dist/` — which needs the registry token above.
      Run `npm ci && npm run build` and commit `dist/` once auth is provisioned.
- [ ] **Real-SxT conformance is gated on the W3-823 broker** (Audie-provisioning):
      the dedicated w3-give PoSQL account + single-session JWT broker + the two
      scope-separated biscuits (runtime `dql_select`+`dml_insert`; bootstrap
      `ddl_create`+insert) + `SXT_PUBLIC_KEY`. Until then conformance runs against
      the unit suite + any reachable SxT path.
- [ ] **Bootstrap + seed:** run the `ENTITY_VERSIONS` DDL + `Asset`/`Recipient`
      seed once with the bootstrap biscuit (`docs/state-commands.md`). Seed the
      `Recipient` vault address only when provisioned — no placeholder.
- [ ] **Deferred:** `query-entities` cursor pagination (results currently cap at
      `limit`/500, no `next_cursor`); SQL `LIMIT`/filter pushdown (filter is
      client-side because SxT has no JSON functions).
