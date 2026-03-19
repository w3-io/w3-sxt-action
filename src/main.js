import * as core from '@actions/core'
import { SxtClient, SxtError } from './sxt.js'

const COMMANDS = {
  query: runQuery,
  execute: runExecute,
  ddl: runDdl,
  'list-tables': runListTables,
  'list-chains': runListChains,
}

export async function run() {
  try {
    const command = core.getInput('command', { required: true })
    const handler = COMMANDS[command]

    if (!handler) {
      core.setFailed(`Unknown command: "${command}". Available: ${Object.keys(COMMANDS).join(', ')}`)
      return
    }

    const client = new SxtClient({
      apiUrl: core.getInput('api-url') || undefined,
      apiKey: core.getInput('api-key') || undefined,
      authUrl: core.getInput('auth-url') || undefined,
      authSecret: core.getInput('auth-secret') || undefined,
      biscuitPrivateKey: core.getInput('biscuit-private-key') || undefined,
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

    const result = await handler(client)
    core.setOutput('result', JSON.stringify(result))

    writeSummary(command, result)
  } catch (error) {
    if (error instanceof SxtError) {
      core.setFailed(`SxT error (${error.code}): ${error.message}`)
    } else {
      core.setFailed(error.message)
    }
  }
}

function parseList(input) {
  if (!input) return undefined
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function runQuery(client) {
  const sql = core.getInput('sql', { required: true })
  const resources = parseList(core.getInput('resources'))
  const queryType = core.getInput('query-type') || undefined

  return client.query(sql, { resources, queryType })
}

async function runExecute(client) {
  const sql = core.getInput('sql', { required: true })
  const resources = parseList(core.getInput('resources'))

  return client.execute(sql, { resources })
}

async function runDdl(client) {
  const sql = core.getInput('sql', { required: true })
  return client.ddl(sql)
}

async function runListTables(client) {
  return client.listTables()
}

async function runListChains(client) {
  const chain = core.getInput('chain') || undefined
  return client.listChains(chain)
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
