/**
 * Command router and output formatter.
 *
 * This file wires your client to the GitHub Actions runtime. It:
 *   1. Reads the `command` input to determine which operation to run
 *   2. Creates your client with the provided credentials
 *   3. Calls the appropriate handler function
 *   4. Sets the `result` output as a JSON string
 *   5. Writes a job summary for visibility in the Actions UI
 *   6. Reports errors cleanly via core.setFailed()
 *
 * To add a new command:
 *   1. Write a handler function (async, takes client, returns result)
 *   2. Add it to the COMMANDS map
 *   3. Add summary rendering in writeSummary() if appropriate
 */

import * as core from '@actions/core'
// TODO: Update this import to match your renamed client
import { Client, ClientError } from './client.js'

// TODO: Replace with your commands. Each key is a command name that users
// pass via the `command` input. Each value is an async function that takes
// the client and returns a result object.
const COMMANDS = {
  'example-command': runExampleCommand,
  // 'another-command': runAnotherCommand,
}

export async function run() {
  try {
    const command = core.getInput('command', { required: true })
    const handler = COMMANDS[command]

    if (!handler) {
      core.setFailed(`Unknown command: "${command}". Available: ${Object.keys(COMMANDS).join(', ')}`)
      return
    }

    // TODO: Update constructor args to match your client.
    // Remove apiKey if your API doesn't need auth.
    const client = new Client({
      apiKey: core.getInput('api-key', { required: true }),
      baseUrl: core.getInput('api-url') || undefined,
    })

    const result = await handler(client)
    core.setOutput('result', JSON.stringify(result))

    writeSummary(command, result)
  } catch (error) {
    // TODO: Update error class name to match yours
    if (error instanceof ClientError) {
      core.setFailed(`${error.name} (${error.code}): ${error.message}`)
    } else {
      core.setFailed(error.message)
    }
  }
}

// -- Command handlers -------------------------------------------------------
// Each handler reads its own inputs, calls the client, returns a result.
// Keep these thin — business logic belongs in the client.

async function runExampleCommand(client) {
  // TODO: Read your command-specific inputs here
  const input = core.getInput('input', { required: true })

  return client.exampleCommand(input)
}

// -- Job summary ------------------------------------------------------------
// Optional but recommended. Renders a visible summary in the Actions UI.
// See https://github.blog/news-insights/product-news/supercharging-github-actions-with-job-summaries/

function writeSummary(command, result) {
  // TODO: Customize the summary for your action. A table of key results
  // works well. Delete this function if your action doesn't need a summary.
  core.summary
    .addHeading('Action Result', 3)
    .addRaw(`**Command:** \`${command}\`\n\n`)
    .addCodeBlock(JSON.stringify(result, null, 2), 'json')
    .write()
}
