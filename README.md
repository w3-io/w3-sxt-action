# W3 Space and Time Action

Decentralized SQL queries and blockchain data via Space and Time for W3 workflows. ZK-proven query results over indexed chain data and custom tables.

## Quick Start

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

## Commands

| Command       | Description                                    |
| ------------- | ---------------------------------------------- |
| `query`       | Execute a SELECT query, returns JSON rows      |
| `execute`     | Execute DML (INSERT, UPDATE, DELETE)           |
| `ddl`         | Execute DDL (CREATE TABLE, DROP TABLE, ALTER)  |
| `list-tables` | List tables in the configured schema           |
| `list-chains` | Query latest blocks from an indexed blockchain |

## Inputs

| Name          | Required | Default                              | Description                                                    |
| ------------- | -------- | ------------------------------------ | -------------------------------------------------------------- |
| `command`     | Yes      |                                      | Operation to perform                                           |
| `api-url`     | No       | `https://proxy.api.makeinfinite.dev` | SxT API base URL                                               |
| `api-key`     | No       |                                      | SxT API key (bootstraps JWT session automatically)             |
| `auth-url`    | No       |                                      | Custom JWT token endpoint URL (alternative to API key)         |
| `auth-secret` | No       |                                      | Shared secret for custom JWT endpoint                          |
| `biscuit`     | No       |                                      | Pre-signed biscuit token for table-level authorization         |
| `schema-name` | Yes      |                                      | Default schema for resource scoping (e.g. `ETHEREUM`, `myapp`) |
| `origin-app`  | No       | `w3-sxt-action`                      | Application identifier for request tracking                    |
| `sql`         | No       |                                      | SQL statement to execute                                       |
| `resources`   | No       |                                      | Comma-separated table references for performance optimization  |
| `query-type`  | No       | `OLTP`                               | Query type for DQL: `OLTP` or `OLAP`                           |
| `chain`       | No       |                                      | Blockchain name for list-chains (e.g. `ethereum`)              |
| `max-retries` | No       | `3`                                  | Maximum retry attempts                                         |
| `retry-delay` | No       | `2`                                  | Base retry delay in seconds                                    |
| `timeout`     | No       | `30`                                 | Request timeout in seconds                                     |

## Outputs

| Name     | Description                  |
| -------- | ---------------------------- |
| `result` | JSON result of the operation |

## Authentication

Get an API key from [Space and Time](https://www.spaceandtime.io/) and store it as `SXT_API_KEY` in your repository secrets. The action supports two auth modes:

- **API key** (recommended): Set `api-key`. The action bootstraps a JWT session automatically.
- **Custom JWT**: Set `auth-url` and `auth-secret` for a custom token endpoint.

Optionally provide a `biscuit` token for table-level authorization from your SxT subscription.
