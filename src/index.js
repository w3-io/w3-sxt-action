import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import * as core from '@actions/core'
import { SxtClient, SxtError } from './sxt.js'
import {
  putEntity,
  getEntity,
  queryEntities,
  transaction,
  objectStore,
  StateError,
} from './state.js'

const router = createCommandRouter({
  query: async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })
    const resources = parseList(core.getInput('resources'))
    const queryType = core.getInput('query-type') || undefined

    const result = await client.query(sql, { resources, queryType })
    setJsonOutput('result', result)
    writeSummary('query', result)
  },

  execute: async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })
    const resources = parseList(core.getInput('resources'))

    const result = await client.execute(sql, { resources })
    setJsonOutput('result', result)
    writeSummary('execute', result)
  },

  ddl: async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })

    const result = await client.ddl(sql)
    setJsonOutput('result', result)
    writeSummary('ddl', result)
  },

  'discover-schemas': async () => {
    const client = createClient()
    const result = await client.discoverSchemas()
    setJsonOutput('result', result)
    writeSummary('discover-schemas', result)
  },

  'discover-tables': async () => {
    const client = createClient()
    const schema = core.getInput('schema') || undefined
    const result = await client.discoverTables(schema)
    setJsonOutput('result', result)
    writeSummary('discover-tables', result)
  },

  'discover-columns': async () => {
    const client = createClient()
    const schema = core.getInput('schema') || core.getInput('schema-name', { required: true })
    const table = core.getInput('table', { required: true })
    const result = await client.discoverColumns(schema, table)
    setJsonOutput('result', result)
    writeSummary('discover-columns', result)
  },

  'discover-primary-keys': async () => {
    const client = createClient()
    const schema = core.getInput('schema') || core.getInput('schema-name', { required: true })
    const table = core.getInput('table', { required: true })
    const result = await client.discoverPrimaryKeys(schema, table)
    setJsonOutput('result', result)
    writeSummary('discover-primary-keys', result)
  },

  'discover-indexes': async () => {
    const client = createClient()
    const schema = core.getInput('schema') || core.getInput('schema-name', { required: true })
    const table = core.getInput('table', { required: true })
    const result = await client.discoverIndexes(schema, table)
    setJsonOutput('result', result)
    writeSummary('discover-indexes', result)
  },

  'discover-relationships': async () => {
    const client = createClient()
    const schema = core.getInput('schema') || core.getInput('schema-name', { required: true })
    const table = core.getInput('table', { required: true })
    const result = await client.discoverRelationships(schema, table)
    setJsonOutput('result', result)
    writeSummary('discover-relationships', result)
  },

  'list-chains': async () => {
    const client = createClient()
    const chain = core.getInput('chain') || undefined
    const result = await client.listChains(chain)
    setJsonOutput('result', result)
    writeSummary('list-chains', result)
  },

  // -------------------------------------------------------------------------
  // State entity commands (Story 1.1) — append-only versioned entities.
  // Inputs are kebab-case; results are JSON parsed by callers via
  // fromJSON(steps.X.outputs.result).<field>. Key/field validation and typed
  // errors live in ./state.js (empty inputs are not core.getInput-`required`
  // so they surface as a typed INVALID_INPUT rather than a generic failure).
  // -------------------------------------------------------------------------
  'put-entity': async () => {
    const client = createClient()
    const result = await putEntity(client, {
      tenantId: core.getInput('tenant-id'),
      entityType: core.getInput('entity-type'),
      id: core.getInput('id'),
      fields: core.getInput('fields'),
      expectedVersion: core.getInput('expected-version') || undefined,
    })
    setJsonOutput('result', result)
    writeSummary('put-entity', [result.entity])
  },

  'get-entity': async () => {
    const client = createClient()
    const result = await getEntity(client, {
      tenantId: core.getInput('tenant-id'),
      entityType: core.getInput('entity-type'),
      id: core.getInput('id'),
    })
    setJsonOutput('result', result)
    writeSummary('get-entity', result.entity ? [result.entity] : result)
  },

  'query-entities': async () => {
    const client = createClient()
    const result = await queryEntities(client, {
      tenantId: core.getInput('tenant-id'),
      entityType: core.getInput('entity-type'),
      filter: core.getInput('filter') || undefined,
      sort: core.getInput('sort') || undefined,
      limit: core.getInput('limit') || undefined,
    })
    setJsonOutput('result', result)
    writeSummary('query-entities', result)
  },

  // SxT has no multi-entity transaction; object storage is the cloud: syscall
  // (Storj, Story 1.2) — both raise the typed NOT_SUPPORTED.
  transaction: async () => transaction(),
  'object-store-put': async () => objectStore('object-store-put'),
  'object-store-get': async () => objectStore('object-store-get'),
})

function createClient() {
  const client = new SxtClient({
    apiUrl: core.getInput('api-url') || undefined,
    apiKey: core.getInput('api-key') || undefined,
    authUrl: core.getInput('auth-url') || undefined,
    authSecret: core.getInput('auth-secret') || undefined,
    biscuit: core.getInput('biscuit') || undefined,
    userId: core.getInput('user-id') || undefined,
    password: core.getInput('password') || undefined,
    biscuitName: core.getInput('biscuit-name') || undefined,
    proxyUrl: core.getInput('proxy-url') || undefined,
    schemaName: core.getInput('schema-name', { required: true }),
    originApp: core.getInput('origin-app') || undefined,
    maxRetries: core.getInput('max-retries') ? Number(core.getInput('max-retries')) : undefined,
    retryDelay: core.getInput('retry-delay') ? Number(core.getInput('retry-delay')) : undefined,
    timeout: core.getInput('timeout') ? Number(core.getInput('timeout')) : undefined,
  })

  if (client.authMode === 'jwt-apikey') {
    core.warning(
      'Using API key auth (Gateway Proxy). DDL and writes are not supported in this mode. ' +
        'For full read/write access, use login mode (user-id + password + biscuit-name).',
    )
  }

  return client
}

function parseList(input) {
  if (!input) return undefined
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function writeSummary(command, result) {
  const heading = `Space and Time: ${command}`

  if (Array.isArray(result) && result.length > 0) {
    const columns = Object.keys(result[0])
    const headerRow = columns.map((c) => ({ data: c, header: true }))
    const dataRows = result.slice(0, 20).map((row) => columns.map((c) => String(row[c] ?? '')))

    core.summary.addHeading(heading, 3)

    if (result.length > 20) {
      core.summary.addRaw(`Showing 20 of ${result.length} rows\n\n`)
    }

    core.summary.addTable([headerRow, ...dataRows]).write()
    return
  }

  core.summary
    .addHeading(heading, 3)
    .addCodeBlock(JSON.stringify(result, null, 2), 'json')
    .write()
}

try {
  await router()
} catch (error) {
  if (error instanceof StateError) {
    // Typed state errors surface the repo vocabulary on `error-code` plus a
    // `[CODE] message` failure so dispatchers can branch on the code.
    core.setOutput('error-code', error.code)
    core.setFailed(`[${error.code}] ${error.message}`)
  } else if (error instanceof SxtError) {
    core.setFailed(`SxT error (${error.code ?? 'UNKNOWN'}): ${error.message}`)
    if (error.body) {
      core.debug(
        `SxT error body: ${typeof error.body === 'string' ? error.body : JSON.stringify(error.body)}`,
      )
    }
  } else {
    handleError(error)
  }
}
