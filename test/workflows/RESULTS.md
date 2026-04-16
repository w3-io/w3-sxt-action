# E2E Test Results

> Last verified: 2026-04-16 (login auth mode, full lifecycle)

## Prerequisites

| Credential                 | Env var                | Source                                   |
| -------------------------- | ---------------------- | ---------------------------------------- |
| SxT userId (email)         | `SXT_USER_ID`          | SxT account                              |
| SxT password               | `SXT_PASSWORD`         | SxT account                              |
| Named biscuit on proxy     | `SXT_BISCUIT_NAME`     | Generated via `npm run generate-biscuit` |
| Biscuit's table public key | `SXT_TABLE_PUBLIC_KEY` | Output of `npm run generate-biscuit`     |
| SQL endpoint               | `SXT_API_URL`          | `https://api.makeinfinite.dev`           |
| Auth / biscuit proxy       | `SXT_PROXY_URL`        | `https://proxy.api.makeinfinite.dev`     |

### One-time setup per SxT account

1. Generate the keypair and register the biscuit on the proxy:

   ```bash
   npm run generate-biscuit -- \
     --resources=w3_e2e_test.e2e_items \
     --biscuit-name=w3-sxt-action-e2e \
     --user-id=$SXT_USER_ID \
     --password=$SXT_PASSWORD
   ```

   Resource names must be lowercase — the SxT server normalizes resource
   references case-insensitively when evaluating biscuits, so an
   uppercase resource in the biscuit will fail to match a lowercased SQL
   reference at runtime.

   The command writes the keypair to `.sxt-keys/` (gitignored) and
   prints the public key hex to paste into `SXT_TABLE_PUBLIC_KEY`.

2. Create the schema once. Any workflow that runs `CREATE SCHEMA
W3_E2E_TEST` under the same login + biscuit will suffice; the biscuit
   grants `ddl_create`.

## Results

| #   | Step                  | Command                | Status | Notes               |
| --- | --------------------- | ---------------------- | ------ | ------------------- |
| 1   | List supported chains | `list-chains`          | PASS   | schema: ETHEREUM    |
| 2   | Create the test table | `ddl` (CREATE TABLE)   | PASS   | anchored to biscuit |
| 3   | Insert test rows      | `execute` (INSERT)     | PASS   | 3 rows              |
| 4   | Query all rows        | `query` (SELECT \*)    | PASS   | 3 rows returned     |
| 5   | Query with filter     | `query` (SELECT WHERE) | PASS   | 2 rows returned     |
| 6   | Drop the test table   | `ddl` (DROP TABLE)     | PASS   |                     |

**Summary: all 6 steps pass against real SxT under login auth mode.**

## Skipped Commands

| Command       | Reason                                                 |
| ------------- | ------------------------------------------------------ |
| `list-tables` | Not supported by SxT API (no `SHOW TABLES` equivalent) |

## How to run

```bash
export SXT_USER_ID="..."
export SXT_PASSWORD="..."
export SXT_BISCUIT_NAME="w3-sxt-action-e2e"
export SXT_TABLE_PUBLIC_KEY="..."   # printed by generate-biscuit
export SXT_API_URL="https://api.makeinfinite.dev"
export SXT_PROXY_URL="https://proxy.api.makeinfinite.dev"

w3 workflow test --execute test/workflows/e2e.yaml
```
