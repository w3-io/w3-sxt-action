---
title: Space and Time
category: integrations
actions: [query, execute, ddl, list-tables, list-chains]
complexity: intermediate
---

# Space and Time

[Space and Time](https://spaceandtime.io) is a decentralized data infrastructure with ZK-proven SQL queries. Their Proof of SQL technology provides cryptographic verification that query results are correct — no trust required. Indexes Ethereum, Bitcoin, and Base chain data (blocks, transactions, tokens, NFTs) and supports custom tables for off-chain application data. Audited by HashLock, Spearbit, Pashov, and Cantin. Use this action to query blockchain data with SQL, store workflow state, build compliance audit trails, or power data-driven smart contract logic.

Decentralized SQL database with ZK-proven query results. Query indexed
blockchain data (Ethereum, Bitcoin, Base), create custom tables, and
execute full CRUD operations with JWT + biscuit authentication.

## Quick start

```yaml
- name: Get latest Ethereum blocks
  id: blocks
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: ETHEREUM
    sql: 'SELECT BLOCK_NUMBER, TIME_STAMP, TRANSACTION_COUNT FROM ETHEREUM.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 5'
```

## Authentication

Three modes, resolved in this priority order. Pick the one that matches
what you need to do.

**Login mode (required for writes and DDL):**

```yaml
with:
  user-id: ${{ secrets.SXT_USER_ID }}
  password: ${{ secrets.SXT_PASSWORD }}
  biscuit-name: ${{ secrets.SXT_BISCUIT_NAME }}
  api-url: https://api.makeinfinite.dev
  proxy-url: https://proxy.api.makeinfinite.dev
```

The action logs in to the Make Infinite proxy with your SxT credentials,
fetches the named biscuit via the proxy's session, and executes SQL
against the direct endpoint at `api-url` with `Bearer <jwt>` and the
biscuit in the request body. This is the only mode that authorizes DDL
and DML on your own tables.

Point `api-url` at `https://api.makeinfinite.dev` — the proxy's
`/v1/sql` endpoint requires an `apikey` header even with Bearer auth
and will reject login-mode writes with a 400.

**Explicit JWT (for custom auth services):**

```yaml
with:
  auth-url: ${{ secrets.SXT_AUTH_URL }}
  auth-secret: ${{ secrets.SXT_AUTH_SECRET }}
  biscuit: ${{ secrets.SXT_BISCUIT }}
```

The action GETs `auth-url` with an `x-shared-secret` header, uses the
returned JWT as a bearer token, and passes any pre-fetched biscuit in
the request body. Use this when you have a custom token service
fronting SxT.

**API key (read-only indexed chain data):**

```yaml
with:
  api-key: ${{ secrets.SXT_API_KEY }}
```

The action bootstraps a JWT via `/auth/apikey` on the Gateway Proxy.
This routes SQL through the proxy which serves SxT-managed indexed
data (`ETHEREUM.BLOCKS` and similar). **DDL and writes are not
supported in this mode** — use login mode for those.

### One-time setup for login mode

Login mode requires a biscuit registered on the Make Infinite proxy.
Biscuits are Ed25519-signed capability tokens that grant specific
operations on specific resources; the private key that signs them
must also be embedded in the table's `public_key=...` clause at
create time, so a biscuit is permanently bound to its keypair.

The helper at `scripts/generate-biscuit.mjs` does all of this in one
command:

```bash
npm run generate-biscuit -- \
  --resources=my_app.events \
  --biscuit-name=my-app-events \
  --user-id=$SXT_USER_ID \
  --password=$SXT_PASSWORD
```

It generates a keypair, persists it to `.sxt-keys/` (gitignored),
signs a biscuit granting DDL+DML+DQL on the listed resources, and
uploads it to the proxy under the given name. The printed
`public_key` hex must go into every `CREATE TABLE ... WITH
"public_key=<hex>"` clause for that resource. Re-run with `--force`
to replace an existing biscuit of the same name.

Resource names must be lowercase — SxT normalizes resource
references case-insensitively at query time, but the biscuit check is
exact-match, so `my_app.events` in the biscuit will not authorize
`MY_APP.EVENTS` at runtime even though the SQL resolves to the same
table.

## Commands

### query

Execute a SELECT query. Returns result rows as JSON.

| Input        | Required | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `sql`        | yes      | SQL SELECT statement                              |
| `resources`  | no       | Comma-separated table references for optimization |
| `query-type` | no       | `OLTP` or `OLAP` (default: `OLTP`)                |

**Output:**

```json
[
  { "BLOCK_NUMBER": 24689356, "TIME_STAMP": "2026-03-19 05:11:35", "TRANSACTION_COUNT": 106 },
  { "BLOCK_NUMBER": 24689355, "TIME_STAMP": "2026-03-19 05:11:23", "TRANSACTION_COUNT": 206 }
]
```

### execute

Execute DML (INSERT, UPDATE, DELETE).

| Input       | Required | Description       |
| ----------- | -------- | ----------------- |
| `sql`       | yes      | SQL DML statement |
| `resources` | no       | Table references  |

**Output:** `[{"UPDATED": 3}]`

### ddl

Execute DDL (CREATE TABLE, DROP TABLE, ALTER).

| Input | Required | Description       |
| ----- | -------- | ----------------- |
| `sql` | yes      | SQL DDL statement |

**Output:** `{"success": true}`

### list-tables

List tables in the configured schema. No inputs beyond auth config.

### list-chains

Query latest blocks from an indexed blockchain.

| Input   | Required | Description                                                     |
| ------- | -------- | --------------------------------------------------------------- |
| `chain` | no       | Chain name: `ETHEREUM`, `BITCOIN`, `BASE` (default: `ETHEREUM`) |

## Available blockchain data

SxT indexes on-chain data from multiple networks into SQL tables:

**Ethereum:** Blocks, transactions, ERC20 transfers/contracts/balances,
ERC721/ERC1155 NFTs, contract events, proxy upgrades.

**Bitcoin:** Blocks, transactions.

**Base:** Blocks, transactions.

Custom smart contract data available via SxT's Smart Contract Indexing.

## SQL reference

SxT supports standard SQL (ANSI-compliant, ACID):

- `SELECT` with `WHERE`, `GROUP BY` (0-1 columns), `ORDER BY`, `LIMIT`, `OFFSET`
- `INSERT`, `UPDATE`, `DELETE`
- `CREATE TABLE`, `DROP TABLE`
- Types: `INT`, `BIGINT`, `VARCHAR`, `BOOLEAN`, `TIMESTAMP`, `DECIMAL75`
- Aggregates: `SUM`, `COUNT`
- Operators: `AND`, `OR`, `NOT`, `=`, `!=`, `>`, `<`, `>=`, `<=`

Note: Division (`/`) and multi-column `GROUP BY` are not supported in
ZK-proven queries.

## Examples

### Cross-chain block comparison

```yaml
- name: Ethereum latest
  id: eth
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: ETHEREUM
    sql: 'SELECT BLOCK_NUMBER FROM ETHEREUM.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 1'

- name: Bitcoin latest
  id: btc
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: BITCOIN
    sql: 'SELECT BLOCK_NUMBER FROM BITCOIN.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 1'
```

### Create a table and insert data (login mode)

```yaml
- name: Create log table
  uses: w3-io/w3-sxt-action@v0
  with:
    command: ddl
    user-id: ${{ secrets.SXT_USER_ID }}
    password: ${{ secrets.SXT_PASSWORD }}
    biscuit-name: ${{ secrets.SXT_BISCUIT_NAME }}
    api-url: https://api.makeinfinite.dev
    proxy-url: https://proxy.api.makeinfinite.dev
    schema-name: my_app
    sql: >
      CREATE TABLE my_app.events
      (id INT PRIMARY KEY, event VARCHAR, ts VARCHAR)
      WITH "public_key=${{ secrets.SXT_TABLE_PUBLIC_KEY }},access_type=public_read"

- name: Insert event
  uses: w3-io/w3-sxt-action@v0
  with:
    command: execute
    user-id: ${{ secrets.SXT_USER_ID }}
    password: ${{ secrets.SXT_PASSWORD }}
    biscuit-name: ${{ secrets.SXT_BISCUIT_NAME }}
    api-url: https://api.makeinfinite.dev
    proxy-url: https://proxy.api.makeinfinite.dev
    schema-name: my_app
    sql: "INSERT INTO my_app.events (id, event, ts) VALUES (1, 'workflow_started', '2026-04-16')"
    resources: my_app.events
```

Both the schema and the table must exist under the biscuit's
authority. Create the schema once out of band (any workflow step with
`CREATE SCHEMA my_app` under the same login + biscuit will do it), then
leave it in place.

### ERC20 token balances

```yaml
- name: Get USDC holders
  id: balances
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: ETHEREUM
    sql: >
      SELECT WALLET_ADDRESS, BALANCE
      FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
      WHERE CONTRACT_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      ORDER BY BALANCE DESC
      LIMIT 10
```

## Security

**SQL injection.** User-controlled values must not be interpolated
directly into SQL strings. Use parameterized values or validate inputs
before constructing SQL.

Avoid patterns like this:

```yaml
# DANGEROUS — user input goes straight into SQL
sql: "SELECT * FROM EVENTS WHERE id = '${{ github.event.inputs.id }}'"
```

Instead, validate or sanitize inputs in a prior step:

```yaml
- name: Validate input
  run: |
    if ! [[ "${{ github.event.inputs.id }}" =~ ^[0-9]+$ ]]; then
      echo "Invalid input" && exit 1
    fi

- name: Query with validated input
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: MY_APP
    sql: 'SELECT * FROM MY_APP.EVENTS WHERE id = ${{ github.event.inputs.id }}'
```

## Beyond this W3 integration

This action queries Space and Time's managed database via REST API.
SxT also offers **on-chain ZK-proven queries** — smart contracts can
request SQL results and receive cryptographic proof that the data
is correct, directly on-chain.

| Layer                         | What                                                  | Trust model                           |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------- |
| This action (off-chain)       | Query chain data, manage tables, store workflow state | Authenticated API (JWT + biscuit)     |
| SxT ZK coprocessor (on-chain) | Smart contracts query data with Proof of SQL          | Cryptographic proof verified on-chain |

The action is ideal for workflow logic: query Ethereum token balances,
store processing state, build audit trails. The ZK coprocessor extends
this to smart contracts that need _provably correct_ data — DeFi
protocols, governance systems, or compliance automation where "trust
the API" isn't sufficient.

The same schemas and tables you create and query through this action
are accessible to smart contracts via the ZK coprocessor. Your
workflow data becomes a resource for on-chain logic.

For on-chain integration, see [SxT's ZK coprocessor docs](https://docs.spaceandtime.io).

## Retry behavior

The action retries automatically on:

- **401** — refreshes JWT token and retries
- **429** — exponential backoff (configurable via `retry-delay`)
- **5xx** — exponential backoff

Configure with `max-retries` (default: 3), `retry-delay` (default: 2s),
and `timeout` (default: 30s).
