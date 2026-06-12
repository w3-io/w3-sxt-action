# State entity commands

The state commands turn this action into the **append-only entity store** for
the w3-give v0 steel thread (Story 1.1). They sit on top of the existing
SQL/auth/biscuit substrate: `put-entity` / `get-entity` / `query-entities`
compose the same `query` / `execute` the action already exposes.

- `put-entity` — append a new version row (never an in-place update)
- `get-entity` — read the latest version of an entity by id
- `query-entities` — PostgREST-style filter/sort/limit over the latest versions
- `transaction`, `object-store-put`, `object-store-get` — **NOT_SUPPORTED**
  (SxT has no multi-entity transaction; object storage is the `cloud:` syscall /
  Storj, handled by Story 1.2's `w3-pii-action`)

## The model

Every entity is stored as an **immutable version row** in a single generic table
`<schema-name>.ENTITY_VERSIONS`. `entity_type` is a **data value** (a column),
never a table name — so there is no reserved-word hazard (`User`) and no
identifier-injection surface. The business fields live as a JSON string in the
`FIELDS` column.

- **Append-only:** `put-entity` reads the current latest version, merges the
  incoming (possibly partial) `fields` onto it, and INSERTs a new monotonic
  `VERSION`. History is retained. A replay appends a NEW version — it is **not** a
  storage no-op; de-duplication is the orchestrator's job via a correlation key.
- **Enforced, not by convention:** the action never emits UPDATE/DELETE, and the
  **runtime biscuit grants only `dql_select` + `dml_insert`** (no update/delete),
  so mutating history is physically rejected by SxT (403 — verified on real SxT),
  layered on top of Proof-of-SQL tamper-evidence.
- **CAS:** pass `expected-version` to `put-entity`; if it doesn't equal the
  current latest version, the command fails `PRECONDITION_FAILED` and does not
  write. (Optimistic, read-compare-insert — SxT has no transactions, so this is
  best-effort under concurrent writers; acceptable for v0.)
- **Tenant isolation:** `tenant-id` is bound on every read and write; a read
  scoped to tenant A structurally cannot return tenant B's rows.
- **No JSON functions, no parameterized queries:** SxT exposes neither, so
  filtering happens client-side over the latest-version set, and every
  interpolated value is single-quote-escaped (ANSI `''` doubling) with control
  characters rejected. SxT uses ANSI string literals, so a backslash is not an
  escape character and a backslash-breakout is not possible.

## Invocation contract

```yaml
- uses: w3-io/w3-sxt-action@v0
  id: put
  with:
    command: put-entity
    tenant-id: hope-give
    entity-type: Gift
    id: gift-123
    fields: ${{ toJSON(fromJSON('{"status":"settling","amount":100}')) }}
    expected-version: '0' # optional; omit to skip CAS
    # auth (explicit-JWT mode):
    auth-url: ${{ secrets.SXT_AUTH_URL }}
    auth-secret: ${{ secrets.SXT_AUTH_SECRET }}
    biscuit: ${{ secrets.SXT_BISCUIT }}
    schema-name: ${{ secrets.SXT_SCHEMA }}

# read the new version:
- run: echo "v=${{ fromJSON(steps.put.outputs.result).version }}"
```

`get-entity` → `result` is `{ entity, version }` or `{ entity: null }`.
`query-entities` → `result` is an array of the latest entity per id.

`query-entities` filter operators: `eq`, `neq`, `in`, `like` (SQL `%`/`_`
wildcards), `contains` (array membership / array containment / string substring),
`gt`, `gte`, `lt`, `lte`, `is_null`. `{ "field": null }` is shorthand for
`{ "field": { "is_null": true } }`. Unknown operators or mistyped operands raise
`INVALID_INPUT` (fail-closed) rather than silently dropping rows.

## Bootstrap (run once, with the bootstrap biscuit)

The live action holds the append-only runtime biscuit (`dql_select` +
`dml_insert`). Table creation and seeding use a **separate bootstrap biscuit**
(`ddl_create` + `dml_insert`) that is not held by the live action. SxT requires
the `WITH "public_key=…,access_type=permissioned"` clause on every permissioned
`CREATE TABLE`, and does not honor `IF NOT EXISTS` — re-runs tolerate the
"already exists" error.

```sql
-- command: ddl   (bootstrap biscuit; public_key = the bootstrap keypair's hex pubkey)
CREATE TABLE <SCHEMA>.ENTITY_VERSIONS (
  TENANT_ID    VARCHAR NOT NULL,
  ENTITY_TYPE  VARCHAR NOT NULL,
  ID           VARCHAR NOT NULL,
  VERSION      BIGINT  NOT NULL,
  FIELDS       VARCHAR NOT NULL,   -- JSON-serialized entity
  CREATED_AT   BIGINT  NOT NULL,   -- epoch millis
  PRIMARY KEY (TENANT_ID, ENTITY_TYPE, ID, VERSION)
) WITH "public_key=<SXT_PUBLIC_KEY>,access_type=permissioned";
```

Seed rows are themselves version-1 entities (`command: execute`, bootstrap
biscuit). The v0 stable asset is **USDC**; the real `Recipient` is **Hope Channel
Intl** (USDC / Avalanche). The ForDefi vault address comes from provisioning — do
**not** seed a placeholder vault address.

```sql
-- Asset: usdc (version 1)
INSERT INTO <SCHEMA>.ENTITY_VERSIONS (TENANT_ID, ENTITY_TYPE, ID, VERSION, FIELDS, CREATED_AT)
VALUES ('hope-give', 'Asset', 'usdc', 1,
  '{"id":"usdc","tenant_id":"hope-give","symbol":"USDC","issuer":"Circle","decimals":6,"contracts":{"avalanche":"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"},"receipt_label":"USDC"}',
  0);
```

## Typed errors

| Condition                                   | `error-code`          |
| ------------------------------------------- | --------------------- |
| `transaction` / object-store requested      | `NOT_SUPPORTED`       |
| stale `expected-version`                    | `PRECONDITION_FAILED` |
| malformed input / untranslatable filter     | `INVALID_INPUT`       |
| SxT 5xx / network / timeout                 | `UPSTREAM_FAILURE`    |
| SxT 429                                      | `RATE_LIMITED`        |
| entity not found (`get-entity`)             | `entity: null` (not an error) |

On failure the action sets the `error-code` output and fails the step with a
`[CODE] message`, so a dispatcher can branch on the code (and walk fallbacks only
on `UPSTREAM_FAILURE` / `RATE_LIMITED`).
