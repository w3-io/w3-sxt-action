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
    sql: "SELECT BLOCK_NUMBER, TIME_STAMP, TRANSACTION_COUNT FROM ETHEREUM.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 5"
```

## Authentication

Two modes, both bootstrap a JWT session automatically:

**API key (recommended for getting started):**
```yaml
with:
  api-key: ${{ secrets.SXT_API_KEY }}
```

**Explicit JWT (for custom auth services):**
```yaml
with:
  auth-url: ${{ secrets.SXT_AUTH_URL }}
  auth-secret: ${{ secrets.SXT_AUTH_SECRET }}
```

**Biscuit authorization (for private tables):**
```yaml
with:
  api-key: ${{ secrets.SXT_API_KEY }}
  biscuit: ${{ secrets.SXT_BISCUIT }}
```

Biscuits are pre-signed tokens from your SxT subscription that grant
access to specific schemas and tables. Get them from the SxT dashboard
or `/biscuits` API endpoint.

## Commands

### query

Execute a SELECT query. Returns result rows as JSON.

| Input | Required | Description |
|-------|----------|-------------|
| `sql` | yes | SQL SELECT statement |
| `resources` | no | Comma-separated table references for optimization |
| `query-type` | no | `OLTP` or `OLAP` (default: `OLTP`) |

**Output:**

```json
[
  {"BLOCK_NUMBER": 24689356, "TIME_STAMP": "2026-03-19 05:11:35", "TRANSACTION_COUNT": 106},
  {"BLOCK_NUMBER": 24689355, "TIME_STAMP": "2026-03-19 05:11:23", "TRANSACTION_COUNT": 206}
]
```

### execute

Execute DML (INSERT, UPDATE, DELETE).

| Input | Required | Description |
|-------|----------|-------------|
| `sql` | yes | SQL DML statement |
| `resources` | no | Table references |

**Output:** `[{"UPDATED": 3}]`

### ddl

Execute DDL (CREATE TABLE, DROP TABLE, ALTER).

| Input | Required | Description |
|-------|----------|-------------|
| `sql` | yes | SQL DDL statement |

**Output:** `{"success": true}`

### list-tables

List tables in the configured schema. No inputs beyond auth config.

### list-chains

Query latest blocks from an indexed blockchain.

| Input | Required | Description |
|-------|----------|-------------|
| `chain` | no | Chain name: `ETHEREUM`, `BITCOIN`, `BASE` (default: `ETHEREUM`) |

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
    sql: "SELECT BLOCK_NUMBER FROM ETHEREUM.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 1"

- name: Bitcoin latest
  id: btc
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: BITCOIN
    sql: "SELECT BLOCK_NUMBER FROM BITCOIN.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 1"
```

### Create a table and insert data

```yaml
- name: Create log table
  uses: w3-io/w3-sxt-action@v0
  with:
    command: ddl
    api-key: ${{ secrets.SXT_API_KEY }}
    biscuit: ${{ secrets.SXT_BISCUIT }}
    schema-name: MY_APP
    sql: "CREATE TABLE MY_APP.EVENTS (id INT, event VARCHAR, ts VARCHAR, PRIMARY KEY (id))"

- name: Insert event
  uses: w3-io/w3-sxt-action@v0
  with:
    command: execute
    api-key: ${{ secrets.SXT_API_KEY }}
    biscuit: ${{ secrets.SXT_BISCUIT }}
    schema-name: MY_APP
    sql: "INSERT INTO MY_APP.EVENTS (id, event, ts) VALUES (1, 'workflow_started', '2026-03-19')"
```

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
    sql: "SELECT * FROM MY_APP.EVENTS WHERE id = ${{ github.event.inputs.id }}"
```

## Beyond the API: on-chain ZK queries

This action queries Space and Time's managed database via REST API.
SxT also offers **on-chain ZK-proven queries** — smart contracts can
request SQL results and receive cryptographic proof that the data
is correct, directly on-chain.

| Layer | What | Trust model |
|-------|------|-------------|
| This action (off-chain) | Query chain data, manage tables, store workflow state | Authenticated API (JWT + biscuit) |
| SxT ZK coprocessor (on-chain) | Smart contracts query data with Proof of SQL | Cryptographic proof verified on-chain |

The action is ideal for workflow logic: query Ethereum token balances,
store processing state, build audit trails. The ZK coprocessor extends
this to smart contracts that need *provably correct* data — DeFi
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
