import { createCommandRouter, setJsonOutput, handleError, W3ActionError } from '@w3-io/action-core'
import * as core from '@actions/core'
import { SxtClient, SxtError } from './sxt.js'

const router = createCommandRouter({
  'query': async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })
    const resources = parseList(core.getInput('resources'))
    const queryType = core.getInput('query-type') || undefined

    const result = await client.query(sql, { resources, queryType })
    setJsonOutput('result', result)
    writeSummary('query', result)
  },

  'execute': async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })
    const resources = parseList(core.getInput('resources'))

    const result = await client.execute(sql, { resources })
    setJsonOutput('result', result)
    writeSummary('execute', result)
  },

  'ddl': async () => {
    const client = createClient()
    const sql = core.getInput('sql', { required: true })

    const result = await client.ddl(sql)
    setJsonOutput('result', result)
    writeSummary('ddl', result)
  },

  'list-tables': async () => {
    const client = createClient()
    const result = await client.listTables()
    setJsonOutput('result', result)
    writeSummary('list-tables', result)
  },

  'list-chains': async () => {
    const client = createClient()
    const chain = core.getInput('chain') || undefined
    const result = await client.listChains(chain)
    setJsonOutput('result', result)
    writeSummary('list-chains', result)
  },
})

function createClient() {
  const client = new SxtClient({
    apiUrl: core.getInput('api-url') || undefined,
    apiKey: core.getInput('api-key') || undefined,
    authUrl: core.getInput('auth-url') || undefined,
    authSecret: core.getInput('auth-secret') || undefined,
    biscuit: core.getInput('biscuit') || undefined,
    schemaName: core.getInput('schema-name', { required: true }),
    originApp: core.getInput('origin-app') || undefined,
    maxRetries: core.getInput('max-retries') ? Number(core.getInput('max-retries')) : undefined,
    retryDelay: core.getInput('retry-delay') ? Number(core.getInput('retry-delay')) : undefined,
    timeout: core.getInput('timeout') ? Number(core.getInput('timeout')) : undefined,
  })

  if (client.authMode === 'apikey') {
    core.warning(
      'Using API key auth (Gateway Proxy). For production, use JWT + biscuit auth ' +
        'by providing auth-url, auth-secret, and biscuit-private-key.',
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

router()
