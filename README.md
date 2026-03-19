# W3 Space and Time Action

Decentralized SQL queries and blockchain data via
[Space and Time](https://www.spaceandtime.io/) for GitHub Actions.
Query indexed chain data (Ethereum, Bitcoin, Base), create custom tables,
and execute full CRUD operations with ZK-proven results.

## Quick start

```yaml
- name: Get latest Ethereum blocks
  id: blocks
  uses: w3-io/w3-sxt-action@v0
  with:
    command: query
    api-key: ${{ secrets.SXT_API_KEY }}
    schema-name: ETHEREUM
    sql: >
      SELECT BLOCK_NUMBER, TIME_STAMP, TRANSACTION_COUNT
      FROM ETHEREUM.BLOCKS
      ORDER BY BLOCK_NUMBER DESC LIMIT 5

- name: Use the result
  run: echo "${{ steps.blocks.outputs.result }}"
```

## Commands

| Command | Description |
|---------|-------------|
| `query` | Execute a SELECT query, returns JSON rows |
| `execute` | Execute DML (INSERT, UPDATE, DELETE) |
| `ddl` | Execute DDL (CREATE TABLE, DROP TABLE, ALTER) |
| `list-tables` | List tables in the configured schema |
| `list-chains` | Query latest blocks from an indexed blockchain |

## Documentation

See [docs/guide.md](docs/guide.md) for the full reference including
authentication modes, all inputs/outputs, SQL reference, and examples.

## Authentication

Get an API key from [Space and Time](https://www.spaceandtime.io/) and
store it as `SXT_API_KEY` in your repository secrets.
