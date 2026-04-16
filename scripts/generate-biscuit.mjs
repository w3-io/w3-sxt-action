#!/usr/bin/env node
/**
 * Generate an SxT biscuit and (optionally) register it under a name
 * on the Make Infinite proxy.
 *
 * Biscuits are signed locally using an Ed25519 keypair tied to a
 * specific resource (schema.table). The private key stays on the
 * client — the proxy never sees it. The public key hex must be used
 * in `CREATE TABLE ... WITH "public_key=<hex>"` when the resource is
 * first created, so anything you do with this biscuit is anchored to
 * that same keypair.
 *
 * Usage:
 *
 *   # Generate a biscuit for a specific resource, print to stdout:
 *   node scripts/generate-biscuit.mjs \
 *     --resources=W3_E2E_TEST.e2e_items \
 *     --operations=ddl_create,ddl_drop,dml_insert,dml_update,dml_delete,dql_select
 *
 *   # Reuse an existing keypair (so CREATE TABLE statements that
 *   # already embed this pubkey keep working):
 *   node scripts/generate-biscuit.mjs \
 *     --resources=W3_E2E_TEST.e2e_items \
 *     --key-file=.sxt-keys/w3-e2e-test.json
 *
 *   # Upload to the Make Infinite proxy under a name so the action
 *   # can look it up at runtime:
 *   node scripts/generate-biscuit.mjs \
 *     --resources=W3_E2E_TEST.e2e_items \
 *     --biscuit-name=w3-e2e-test \
 *     --user-id=<your-sxt-user-id> \
 *     --password=<your-sxt-password>
 *
 * Environment variables (fallback when flags are omitted):
 *   SXT_USER_ID, SXT_PASSWORD, SXT_PROXY_URL
 *
 * Outputs:
 *   - Writes keypair to --key-file (default: .sxt-keys/<first-resource>.json).
 *     Create the parent dir and keep it gitignored.
 *   - Prints the biscuit string, public key hex, and setup instructions
 *     so you can either paste the biscuit directly into a secret or
 *     use the named lookup path.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { argv, env, exit } from 'node:process'
import { SpaceAndTime } from 'sxt-nodejs-sdk'

const DEFAULT_PROXY_URL = 'https://proxy.api.makeinfinite.dev'
const DEFAULT_OPERATIONS = [
  'ddl_create',
  'ddl_drop',
  'ddl_alter',
  'dml_insert',
  'dml_update',
  'dml_delete',
  'dql_select',
]

function parseArgs(raw) {
  const args = {}
  for (const item of raw.slice(2)) {
    if (!item.startsWith('--')) continue
    const eq = item.indexOf('=')
    if (eq === -1) {
      args[item.slice(2)] = true
    } else {
      args[item.slice(2, eq)] = item.slice(eq + 1)
    }
  }
  return args
}

function usage(message) {
  if (message) console.error(`\nError: ${message}\n`)
  console.error('Usage: node scripts/generate-biscuit.mjs --resources=<comma-list> [options]')
  console.error('  --resources       Required. e.g. W3_E2E_TEST.e2e_items')
  console.error('  --operations      Default: all 7 (ddl_*/dml_*/dql_*)')
  console.error('  --key-file        Default: .sxt-keys/<first-resource>.json')
  console.error('  --biscuit-name    Upload under this name via proxy POST')
  console.error('  --user-id         SxT userId for proxy login (or SXT_USER_ID)')
  console.error('  --password        SxT password for proxy login (or SXT_PASSWORD)')
  console.error('  --proxy-url       Default: https://proxy.api.makeinfinite.dev')
  console.error('  --force           DELETE an existing biscuit with the same name before upload')
  exit(1)
}

const args = parseArgs(argv)

const resources = (args.resources || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (resources.length === 0) usage('--resources is required')

const operations = (args.operations || DEFAULT_OPERATIONS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const keyFile =
  args['key-file'] || `.sxt-keys/${resources[0].replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`

const biscuitName = args['biscuit-name'] || null
const userId = args['user-id'] || env.SXT_USER_ID || null
const password = args['password'] || env.SXT_PASSWORD || null
const proxyUrl = (args['proxy-url'] || env.SXT_PROXY_URL || DEFAULT_PROXY_URL).replace(/\/+$/, '')
const force = Boolean(args.force)

if (biscuitName && (!userId || !password)) {
  usage('--biscuit-name requires --user-id and --password (or SXT_USER_ID / SXT_PASSWORD)')
}

// ---------------------------------------------------------------------------
// Keypair — reuse if the key file exists, otherwise generate and persist.
// ---------------------------------------------------------------------------

const sxt = new SpaceAndTime()
const authorization = sxt.Authorization()

let keypair
if (existsSync(keyFile)) {
  console.error(`Reusing keypair from ${keyFile}`)
  const loaded = JSON.parse(readFileSync(keyFile, 'utf8'))
  // The SDK accepts either a GenerateKeyPair() return object or reconstruction
  // from stored hex. We need the full object for CreateBiscuitToken.
  keypair = loaded
} else {
  console.error(`Generating new keypair → ${keyFile}`)
  keypair = await authorization.GenerateKeyPair()
  mkdirSync(dirname(keyFile), { recursive: true })
  writeFileSync(keyFile, JSON.stringify(keypair, null, 2))
}

if (!keypair.biscuitPrivateKeyHex_32 || !keypair.biscuitPublicKeyHex_32) {
  console.error('Keypair is missing biscuitPrivateKeyHex_32 / biscuitPublicKeyHex_32')
  console.error('Regenerate with: rm', keyFile, '&& re-run')
  exit(1)
}

// ---------------------------------------------------------------------------
// Build biscuit.
// ---------------------------------------------------------------------------

const requiredBiscuit = []
for (const resource of resources) {
  for (const operation of operations) {
    requiredBiscuit.push({ operation, resource })
  }
}

const biscuitResult = await authorization.CreateBiscuitToken(
  requiredBiscuit,
  keypair.biscuitPrivateKeyHex_32,
)

if (!biscuitResult?.data?.[0]) {
  console.error('Biscuit generation returned no data:', biscuitResult)
  exit(1)
}

const biscuit = biscuitResult.data[0]

// ---------------------------------------------------------------------------
// Optional: upload to proxy.
// ---------------------------------------------------------------------------

let uploadedAs = null
if (biscuitName) {
  console.error(`Logging in to ${proxyUrl} as ${userId}…`)
  const loginResp = await fetch(`${proxyUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  })

  if (!loginResp.ok) {
    const body = await loginResp.text().catch(() => '')
    console.error(`Login failed: ${loginResp.status} ${body}`)
    exit(1)
  }

  const { sessionId } = await loginResp.json()
  if (!sessionId) {
    console.error('Login response missing sessionId')
    exit(1)
  }

  if (force) {
    console.error(`Force-deleting existing biscuit "${biscuitName}" (if any)…`)
    const delResp = await fetch(
      `${proxyUrl}/biscuits/generated/${encodeURIComponent(biscuitName)}`,
      {
        method: 'DELETE',
        headers: { sid: sessionId },
      },
    )
    if (!delResp.ok && delResp.status !== 404) {
      const body = await delResp.text().catch(() => '')
      console.error(`Delete failed: ${delResp.status} ${body}`)
      exit(1)
    }
  }

  console.error(`Uploading biscuit as "${biscuitName}"…`)
  const uploadResp = await fetch(`${proxyUrl}/biscuits/generated`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      sid: sessionId,
    },
    body: JSON.stringify({
      name: biscuitName,
      biscuit,
      publicKey: keypair.biscuitPublicKeyHex_32,
    }),
  })

  if (!uploadResp.ok) {
    const body = await uploadResp.text().catch(() => '')
    if (uploadResp.status === 400 && body.includes('already exists')) {
      console.error(
        `Upload skipped: biscuit "${biscuitName}" already exists. ` +
          'Rerun with --force to replace it, or pick a different --biscuit-name.',
      )
    } else {
      console.error(`Upload failed: ${uploadResp.status} ${body}`)
    }
    console.error(
      '(The biscuit was generated successfully — printed below so you can still use it.)',
    )
  } else {
    uploadedAs = biscuitName
  }
}

// ---------------------------------------------------------------------------
// Print everything the caller needs.
// ---------------------------------------------------------------------------

console.log()
console.log('# Biscuit generated')
console.log(`resources:      ${resources.join(', ')}`)
console.log(`operations:     ${operations.join(', ')}`)
console.log(`public_key:     ${keypair.biscuitPublicKeyHex_32}`)
console.log(`key_file:       ${keyFile}`)
if (uploadedAs) {
  console.log(`uploaded_name:  ${uploadedAs}`)
}
console.log()
console.log('# Biscuit (base64) — paste into a secret or pass via `biscuit:` input')
console.log(biscuit)
console.log()
console.log('# CREATE TABLE template (include the public_key)')
for (const resource of resources) {
  console.log(
    `# CREATE TABLE ${resource} (...) WITH "public_key=${keypair.biscuitPublicKeyHex_32},access_type=public_read"`,
  )
}
