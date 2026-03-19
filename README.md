# W3 Action Template

Start here to build a new action for W3 workflows.

This template gives you the structure, conventions, and tooling used by
all W3 partner actions (Cube3, Pyth, Hyperbolic, Space and Time). Actions
built from this template work on both the W3 runtime and GitHub Actions
runners — same YAML, both environments.

## Getting started

1. **Create your repo** from this template:

   ```bash
   gh repo create w3-io/w3-yourpartner-action \
     --public \
     --template w3-io/w3-action-template \
     --clone
   cd w3-yourpartner-action
   npm install
   ```

2. **Rename the placeholders.** Search for `TODO` across the codebase —
   every file that needs your attention has one. The main things to change:

   - `action.yml` — your action's name, description, and inputs
   - `src/client.js` — your API client (the core logic)
   - `src/main.js` — wire your commands into the router
   - `w3-action.yaml` — registry metadata for MCP discovery
   - `docs/guide.md` — the integration guide users will read

3. **Write your client** in `src/client.js`. This is the reusable module
   that talks to your partner API. Keep it independent of `@actions/core`
   so it can be imported directly by others.

4. **Add commands** to `src/main.js`. Each command is a function that
   reads inputs, calls the client, and returns a result. The router
   handles output formatting and error reporting.

5. **Write tests.** `__tests__/client.test.js` tests your API client
   with mocked fetch. `__tests__/main.test.js` tests the full action
   with mocked `@actions/core`. Add an integration test that hits the
   real API (skipped by default, runs when credentials are available).

6. **Build and verify:**

   ```bash
   npm test          # run tests
   npm run package   # bundle to dist/
   npm run all       # format + lint + test + bundle
   ```

7. **Push and tag** a release. Users reference your action as:

   ```yaml
   uses: w3-io/w3-yourpartner-action@v1
   ```

## Conventions

These conventions keep all W3 actions consistent. Follow them so your
action feels native to the ecosystem.

### Inputs

| Input | Convention |
|-------|-----------|
| `command` | Required. The operation to perform (e.g. `inspect`, `query`, `chat`). |
| `api-key` | The API key. Always `api-key`, never `apikey` or `api_key`. |
| `api-url` | Optional endpoint override for testing or staging environments. |
| (others) | Use plain names without partner prefix. `address`, not `cube3-address`. |

### Outputs

Every action has one output: `result`. It's always a JSON string.
Consumers parse it with `fromJSON(steps.x.outputs.result)`.

No per-field outputs. One output, documented schema.

### Errors

Use `core.setFailed()` with a descriptive message. Include the error
code from your client when available. Write a job summary on success.

### Secrets

Actions read secrets from inputs, never from environment variables.
The workflow author passes them:

```yaml
with:
  api-key: ${{ secrets.PARTNER_API_KEY }}
```

This works identically on W3 and GitHub Actions.

### File structure

```
w3-yourpartner-action/
├── action.yml              # GHA contract — inputs, outputs, runtime
├── w3-action.yaml          # MCP registry metadata — commands, schemas
├── src/
│   ├── index.js            # Entry point (don't modify)
│   ├── main.js             # Command routing, output formatting
│   └── client.js           # Your API client (the core logic)
├── __tests__/
│   ├── client.test.js      # Client unit tests (mocked fetch)
│   ├── main.test.js        # Integration tests (mocked @actions/core)
│   └── client.integration.test.js  # Live API tests (skipped by default)
├── __fixtures__/
│   ├── core.js             # @actions/core mock
│   └── api-response.json   # Sample API response
├── docs/
│   ├── guide.md            # Integration guide (synced to MCP)
│   └── examples/
│       └── basic.yml       # Example workflow
├── .github/workflows/
│   └── ci.yml              # Lint, test, build
├── package.json
├── rollup.config.js
├── .prettierrc.json
└── .gitignore
```

## MCP integration

When your action is released, its metadata gets synced to the W3 MCP
server so AI agents can discover and recommend it. Two files drive this:

- **`w3-action.yaml`** — machine-readable command schemas. Merged into
  the MCP's `registry.yaml`.
- **`docs/guide.md`** — human-readable guide. Copied to the MCP's
  `content/integrations/` directory.

Keep both up to date with your action's capabilities.

## Certification

To earn the W3 certified badge:

- [ ] Follows this template structure
- [ ] All inputs use standard naming conventions
- [ ] Single `result` output with documented JSON schema
- [ ] Unit tests with >80% coverage
- [ ] Integration test (skipped without credentials)
- [ ] Example workflows in `docs/examples/`
- [ ] `w3-action.yaml` with complete command schemas
- [ ] `docs/guide.md` with quick start and command reference
- [ ] CI passing (format, lint, test, build)
- [ ] Semantic versioning with tagged releases

## Examples

See these actions built from this template:

- [w3-cube3-action](https://github.com/w3-io/w3-cube3-action) — Fraud detection (single command)
- [w3-pyth-action](https://github.com/w3-io/w3-pyth-action) — Price oracle (multi-command)
