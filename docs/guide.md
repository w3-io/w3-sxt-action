---
title: YourPartner Integration
category: integrations
actions: [example-command]
complexity: beginner
---

<!--
  TODO: This guide is synced to the W3 MCP server and shown to AI agents
  and developers. Write it as the primary reference for using your action.

  Structure:
    1. One-sentence description
    2. Quick start (copy-pasteable workflow snippet)
    3. Command reference with input/output tables
    4. Output schema example (actual JSON)
    5. Usage patterns (composing with other steps)
    6. Authentication instructions
    7. Error handling notes

  See w3-pyth-action/docs/guide.md for a complete example.
-->

# YourPartner Integration

TODO: One sentence describing what your action does.

## Quick start

```yaml
- name: Do something
  uses: w3-io/w3-yourpartner-action@v1
  with:
    command: example-command
    api-key: ${{ secrets.YOURPARTNER_API_KEY }}
    input: "some-value"
```

## Commands

### example-command

TODO: Describe what this command does.

**Inputs:**

| Input | Required | Description |
|-------|----------|-------------|
| `input` | yes | TODO |

**Output (`result`):**

```json
{
  "TODO": "document your output schema here"
}
```

## Using the result

```yaml
- name: Run action
  id: step1
  uses: w3-io/w3-yourpartner-action@v1
  with:
    command: example-command
    api-key: ${{ secrets.YOURPARTNER_API_KEY }}
    input: "value"

- name: Use the result
  run: |
    echo '${{ steps.step1.outputs.result }}' | jq .
```

## Authentication

TODO: Where to get an API key. What secret name to use.

## Error handling

The action fails with a descriptive message on:
- Missing or invalid API key
- API errors (4xx, 5xx)
- Invalid response format
