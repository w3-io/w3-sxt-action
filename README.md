# W3 Space and Time Action

Decentralized SQL queries and blockchain data via Space and Time for W3 workflows. ZK-proven query results over indexed chain data and custom tables.

## Quick Start

### Read indexed chain data (api-key mode)

```yaml
- uses: w3-io/w3-sxt-action@v0
  id: blocks
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: ETHEREUM
    sql: >
      SELECT BLOCK_NUMBER, TIME_STAMP, TRANSACTION_COUNT
      FROM ETHEREUM.BLOCKS
      ORDER BY BLOCK_NUMBER DESC LIMIT 5

- run: echo "${{ steps.blocks.outputs.result }}"
```

### Write to your own tables (login mode)

```yaml
- uses: w3-io/w3-sxt-action@v0
  with:
    command: ddl
    user-id: ${{ secrets.SXT_USER_ID }}
    password: ${{ secrets.SXT_PASSWORD }}
    biscuit-name: ${{ secrets.SXT_BISCUIT_NAME }}
    api-url: https://api.makeinfinite.dev
    proxy-url: https://proxy.api.makeinfinite.dev
    schema-name: MY_APP
    sql: >
      CREATE TABLE MY_APP.events (id INT PRIMARY KEY, name VARCHAR)
      WITH "public_key=${{ secrets.SXT_TABLE_PUBLIC_KEY }},access_type=public_read"
```

One-time setup for login mode — generates the resource keypair, creates the biscuit, and registers it on the Make Infinite proxy:

```bash
npm run generate-biscuit -- \
  --resources=my_app.events \
  --biscuit-name=my-app-events \
  --user-id=$SXT_USER_ID \
  --password=$SXT_PASSWORD
```

Paste the printed `public_key` hex into `SXT_TABLE_PUBLIC_KEY` and the name into `SXT_BISCUIT_NAME`. Resource names must be lowercase — SxT normalizes references when evaluating biscuits.

## Commands

| Command       | Description                                    |
| ------------- | ---------------------------------------------- |
| `query`       | Execute a SELECT query, returns JSON rows      |
| `execute`     | Execute DML (INSERT, UPDATE, DELETE)           |
| `ddl`         | Execute DDL (CREATE TABLE, DROP TABLE, ALTER)  |
| `list-tables` | (not supported — SxT has no `SHOW TABLES`)     |
| `list-chains` | Query latest blocks from an indexed blockchain |

## Inputs

| Name           | Required | Default                              | Description                                                      |
| -------------- | -------- | ------------------------------------ | ---------------------------------------------------------------- |
| `command`      | Yes      |                                      | Operation to perform                                             |
| `schema-name`  | Yes      |                                      | Default schema for resource scoping (e.g. `ETHEREUM`, `myapp`)   |
| `api-url`      | No       | `https://proxy.api.makeinfinite.dev` | SQL endpoint (use `https://api.makeinfinite.dev` for login mode) |
| `proxy-url`    | No       | `https://proxy.api.makeinfinite.dev` | Login + biscuit lookup endpoint                                  |
| `api-key`      | No       |                                      | SxT API key — read-only indexed chain data                       |
| `auth-url`     | No       |                                      | Custom JWT endpoint URL (alternative to api-key)                 |
| `auth-secret`  | No       |                                      | Shared secret for custom JWT endpoint                            |
| `user-id`      | No       |                                      | SxT userId (email) for login mode                                |
| `password`     | No       |                                      | SxT password for login mode                                      |
| `biscuit-name` | No       |                                      | Named biscuit on the proxy — fetched at runtime                  |
| `biscuit`      | No       |                                      | Pre-fetched biscuit string (alternative to `biscuit-name`)       |
| `origin-app`   | No       | `w3-sxt-action`                      | Application identifier for request tracking                      |
| `sql`          | No       |                                      | SQL statement to execute                                         |
| `resources`    | No       |                                      | Comma-separated table references for performance optimization    |
| `query-type`   | No       | `OLTP`                               | Query type for DQL: `OLTP` or `OLAP`                             |
| `chain`        | No       |                                      | Blockchain name for list-chains (e.g. `ethereum`)                |
| `max-retries`  | No       | `3`                                  | Maximum retry attempts                                           |
| `retry-delay`  | No       | `2`                                  | Base retry delay in seconds                                      |
| `timeout`      | No       | `30`                                 | Request timeout in seconds                                       |

## Outputs

| Name     | Description                  |
| -------- | ---------------------------- |
| `result` | JSON result of the operation |

## Authentication

The action has three auth modes, resolved in this priority order:

1. **Login** — set `user-id` + `password` + `biscuit-name`. The action logs in to the Make Infinite proxy, fetches the named biscuit, and executes SQL against `api-url` with `Bearer <jwt>` and the biscuit in the request body. This is the only path that supports DDL and writes. Point `api-url` at `https://api.makeinfinite.dev` (the direct SQL endpoint) — the proxy's `/v1/sql` requires an apikey header even with Bearer auth and will reject login-mode writes.
2. **Explicit JWT** — set `auth-url` + `auth-secret` (with optional `biscuit`). Useful when you have a custom token service fronting SxT.
3. **API key** — set `api-key` only. Works against the Make Infinite Gateway Proxy for read-only access to SxT-managed indexed chain data. DDL and writes are not supported in this mode.

See `scripts/generate-biscuit.mjs` for the one-time setup helper that creates the keypair, signs the biscuit, and registers it on the proxy.
