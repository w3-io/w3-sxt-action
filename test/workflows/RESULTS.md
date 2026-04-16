# E2E Test Results

> Last verified: 2026-04-15

## Prerequisites

| Credential             | Env var       | Source        |
| ---------------------- | ------------- | ------------- |
| Space and Time API key | `SXT_API_KEY` | SxT dashboard |

## Results

| #   | Step                  | Command                | Status | Notes            |
| --- | --------------------- | ---------------------- | ------ | ---------------- |
| 1   | List supported chains | `list-chains`          | PASS   | schema: ETHEREUM |
| 2   | Create a test table   | `ddl` (CREATE TABLE)   | PASS   |                  |
| 3   | Insert test rows      | `execute` (INSERT)     | PASS   |                  |
| 4   | Query all rows        | `query` (SELECT \*)    | PASS   |                  |
| 5   | Query with filter     | `query` (SELECT WHERE) | PASS   |                  |
| 6   | Drop the test table   | `ddl` (DROP TABLE)     | PASS   |                  |

**Summary: 1/2 command categories fully pass.
list-tables is not supported by the SxT API.**

## Skipped Commands

| Command       | Reason                   |
| ------------- | ------------------------ |
| `list-tables` | Not supported by SxT API |

## How to run

```bash
# Export credentials
export SXT_API_KEY="..."

# Run
w3 workflow test --execute test/workflows/e2e.yaml
```
