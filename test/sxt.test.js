/**
 * SxtClient unit tests.
 *
 * Mocks `fetch` globally so we can test the client without hitting
 * the real Space and Time API. Each test sets up the mock for one
 * or more call cycles, runs the client method, and asserts on:
 *
 *   - the URL the client called
 *   - the request method, headers, and body
 *   - the parsed result the client returned
 *   - the SxtError code on failure paths
 *
 * Run with: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SxtClient, SxtError } from '../src/sxt.js'

const AUTH_RESPONSE = {
  data: 'eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiSldUIn0.fake-jwt.fake-signature',
}

const QUERY_RESPONSE = [
  {
    BLOCK_NUMBER: 19450000,
    BLOCK_HASH: '0xabc123',
    BLOCK_TIMESTAMP: 1710756000,
    TRANSACTION_COUNT: 142,
  },
  {
    BLOCK_NUMBER: 19449999,
    BLOCK_HASH: '0xdef456',
    BLOCK_TIMESTAMP: 1710755988,
    TRANSACTION_COUNT: 98,
  },
]

const DML_RESPONSE = [{ UPDATED: 3 }]

const DEFAULT_CONFIG = {
  authUrl: 'https://auth.example.com/token',
  authSecret: 'test-secret',
  biscuit: 'test-biscuit-token',
  schemaName: 'testschema',
}

let originalFetch
let calls

beforeEach(() => {
  originalFetch = global.fetch
  calls = []
})

afterEach(() => {
  global.fetch = originalFetch
})

/**
 * Install a fetch mock that returns the supplied responses in order.
 * Each response is an object with at least { status, body }.
 */
function mockFetch(responses) {
  let index = 0
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    const response = responses[index++]
    if (!response) {
      throw new Error(`Unexpected fetch call ${index}: ${url}`)
    }
    const status = response.status ?? 200
    const ok = status >= 200 && status < 300
    return {
      ok,
      status,
      headers: new Map([['content-type', 'application/json']]),
      text: async () =>
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}),
      json: async () => response.body ?? {},
    }
  }
}

describe('SxtClient: construction', () => {
  it('requires schema-name', () => {
    assert.throws(
      () => new SxtClient({}),
      (err) => err instanceof SxtError && /schema-name is required/.test(err.message),
    )
  })

  it('requires some form of auth', () => {
    assert.throws(
      () => new SxtClient({ schemaName: 'test' }),
      (err) => err instanceof SxtError && /Authentication required/.test(err.message),
    )
  })

  it('accepts explicit JWT auth', () => {
    const client = new SxtClient(DEFAULT_CONFIG)
    assert.equal(client.authMode, 'jwt-explicit')
  })

  it('accepts API key (bootstraps JWT)', () => {
    const client = new SxtClient({ apiKey: 'test-key', schemaName: 'test' })
    assert.equal(client.authMode, 'jwt-apikey')
  })

  it('explicit JWT takes precedence over API key bootstrap', () => {
    const client = new SxtClient({ ...DEFAULT_CONFIG, apiKey: 'test-key' })
    assert.equal(client.authMode, 'jwt-explicit')
  })
})

describe('SxtClient: token management', () => {
  it('fetches JWT token with shared secret header', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await client.query('SELECT 1')

    assert.equal(calls[0].url, 'https://auth.example.com/token')
    assert.equal(calls[0].options.method, 'GET')
    assert.equal(calls[0].options.headers['x-shared-secret'], 'test-secret')
  })

  it('caches token across requests', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await client.query('SELECT 1')
    await client.query('SELECT 2')

    // Should only have 3 fetch calls (1 auth + 2 sql), not 4
    assert.equal(calls.length, 3)
  })

  it('refreshes token on 401', async () => {
    mockFetch([
      { body: AUTH_RESPONSE },
      { status: 401, body: 'Unauthorized' },
      { body: AUTH_RESPONSE },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1 })

    const result = await client.query('SELECT 1')

    assert.deepEqual(result, QUERY_RESPONSE)
    // 4 calls: auth, sql(401), re-auth, sql(200)
    assert.equal(calls.length, 4)
  })
})

describe('SxtClient: query', () => {
  it('sends SELECT to /v1/sql', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    const result = await client.query('SELECT * FROM eth.blocks LIMIT 2')

    assert.deepEqual(result, QUERY_RESPONSE)
    assert.match(calls[1].url, /\/v1\/sql/)
    assert.match(calls[1].options.headers.Authorization, /^Bearer /)

    const body = JSON.parse(calls[1].options.body)
    assert.equal(body.sqlText, 'SELECT * FROM eth.blocks LIMIT 2')
  })

  it('passes resources and queryType', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await client.query('SELECT * FROM eth.blocks', {
      resources: ['eth.blocks'],
      queryType: 'OLAP',
    })

    const body = JSON.parse(calls[1].options.body)
    assert.deepEqual(body.resources, ['eth.blocks'])
    assert.equal(body.queryType, 'OLAP')
  })

  it('requires sql', async () => {
    const client = new SxtClient(DEFAULT_CONFIG)
    await assert.rejects(() => client.query(''), /sql is required/)
  })
})

describe('SxtClient: execute', () => {
  it('sends DML to /v1/sql', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: DML_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    const result = await client.execute("INSERT INTO testschema.logs VALUES ('hello')")

    assert.deepEqual(result, DML_RESPONSE)
    assert.match(calls[1].url, /\/v1\/sql/)
  })
})

describe('SxtClient: ddl', () => {
  it('sends DDL to /v1/sql', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: [] }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await client.ddl('CREATE TABLE testschema.mytable (id INT)')

    assert.match(calls[1].url, /\/v1\/sql/)
  })
})

describe('SxtClient: biscuit passthrough', () => {
  it('includes biscuit in SQL request when provided', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await client.query('SELECT 1')

    const body = JSON.parse(calls[1].options.body)
    assert.deepEqual(body.biscuits, ['test-biscuit-token'])
  })

  it('omits biscuits when not provided', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient({
      authUrl: DEFAULT_CONFIG.authUrl,
      authSecret: DEFAULT_CONFIG.authSecret,
      schemaName: DEFAULT_CONFIG.schemaName,
    })

    await client.query('SELECT 1')

    const body = JSON.parse(calls[1].options.body)
    assert.equal(body.biscuits, undefined)
  })
})

describe('SxtClient: retry logic', () => {
  it('retries on 429 with backoff', async () => {
    mockFetch([
      { body: AUTH_RESPONSE },
      { status: 429, body: 'Rate limit' },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })

    const result = await client.query('SELECT 1')
    assert.deepEqual(result, QUERY_RESPONSE)
  })

  it('retries on 500 with backoff', async () => {
    mockFetch([
      { body: AUTH_RESPONSE },
      { status: 500, body: 'Server Error' },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })

    const result = await client.query('SELECT 1')
    assert.deepEqual(result, QUERY_RESPONSE)
  })

  it('throws after max retries', async () => {
    mockFetch([
      { body: AUTH_RESPONSE },
      { status: 500, body: 'Server Error' },
      { status: 500, body: 'Server Error' },
    ])
    const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })

    await assert.rejects(() => client.query('SELECT 1'), /SxT API error: 500/)
  })
})

describe('SxtClient: API key JWT bootstrap mode', () => {
  const apiKeyConfig = { apiKey: 'test-api-key', schemaName: 'testschema' }

  it('bootstraps JWT from API key via /auth/apikey', async () => {
    mockFetch([
      {
        body: { accessToken: 'jwt-from-apikey', accessTokenExpires: Date.now() + 1800000 },
      },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient(apiKeyConfig)

    await client.query('SELECT * FROM ETHEREUM.BLOCKS LIMIT 1')

    // First call is POST /auth/apikey
    assert.match(calls[0].url, /\/auth\/apikey/)
    assert.equal(calls[0].options.headers.apikey, 'test-api-key')

    // Second call includes both apikey and Bearer
    assert.equal(calls[1].options.headers.apikey, 'test-api-key')
    assert.equal(calls[1].options.headers.Authorization, 'Bearer jwt-from-apikey')
  })

  it('caches JWT from API key bootstrap', async () => {
    mockFetch([
      {
        body: { accessToken: 'jwt-cached', accessTokenExpires: Date.now() + 1800000 },
      },
      { body: QUERY_RESPONSE },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient(apiKeyConfig)

    await client.query('SELECT 1')
    await client.query('SELECT 2')

    // 3 calls: 1 auth bootstrap + 2 SQL queries
    assert.equal(calls.length, 3)
  })

  it('falls back to apikey-only auth when /auth/apikey returns 401', async () => {
    // Some api-keys aren't eligible for JWT bootstrap. The Gateway
    // Proxy still accepts the apikey header on /v1/sql, so we should
    // degrade gracefully rather than failing the request.
    mockFetch([{ status: 401, body: 'Unauthorized' }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(apiKeyConfig)

    const result = await client.query('SELECT 1')

    assert.deepEqual(result, QUERY_RESPONSE)
    // 2 calls: failed bootstrap + successful SQL with apikey header
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /\/auth\/apikey/)
    assert.match(calls[1].url, /\/v1\/sql/)
    assert.equal(calls[1].options.headers.apikey, 'test-api-key')
    // No Bearer token — we never got one
    assert.equal(calls[1].options.headers.Authorization, undefined)
  })
})

describe('SxtClient: error handling', () => {
  it('throws SxtError with AUTH_ERROR on auth failure', async () => {
    mockFetch([{ status: 403, body: 'Forbidden' }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await assert.rejects(
      () => client.query('SELECT 1'),
      (err) => err instanceof SxtError && err.code === 'AUTH_ERROR',
    )
  })

  it('throws SxtError with PARSE_ERROR on invalid JSON response', async () => {
    mockFetch([{ body: AUTH_RESPONSE }, { body: 'not json' }])
    const client = new SxtClient(DEFAULT_CONFIG)

    await assert.rejects(
      () => client.query('SELECT 1'),
      (err) => err instanceof SxtError && err.code === 'PARSE_ERROR',
    )
  })
})

describe('SxtClient: login + biscuit-name mode', () => {
  const loginConfig = {
    userId: 'test-user',
    password: 'test-pass',
    biscuitName: 'w3-e2e-test',
    apiUrl: 'https://sql.example.com',
    proxyUrl: 'https://proxy.example.com',
    schemaName: 'W3_E2E_TEST',
  }

  const LOGIN_RESPONSE = {
    accessToken: 'login-jwt-token',
    accessTokenExpires: Date.now() + 1800000,
    sessionId: 'sess-abc-123',
  }

  const BISCUIT_RESPONSE = {
    biscuits: [
      {
        name: 'w3-e2e-test',
        biscuit: 'base64-biscuit-payload',
        access: [{ resourceId: 'W3_E2E_TEST.e2e_items', supportedOperations: ['SELECT'] }],
      },
    ],
  }

  it('reports authMode jwt-login when user-id + password + biscuit-name given', () => {
    const client = new SxtClient(loginConfig)
    assert.equal(client.authMode, 'jwt-login')
  })

  it('login mode takes precedence over explicit JWT and API key', () => {
    const client = new SxtClient({
      ...loginConfig,
      authUrl: 'https://auth.example.com',
      authSecret: 'ignored',
      apiKey: 'ignored',
    })
    assert.equal(client.authMode, 'jwt-login')
  })

  it('logs in, fetches biscuit by name, and executes SQL', async () => {
    mockFetch([{ body: LOGIN_RESPONSE }, { body: BISCUIT_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient(loginConfig)

    const result = await client.query('SELECT 1')

    assert.deepEqual(result, QUERY_RESPONSE)
    assert.equal(calls.length, 3)

    // Login
    assert.equal(calls[0].url, 'https://proxy.example.com/auth/login')
    assert.equal(calls[0].options.method, 'POST')
    const loginBody = JSON.parse(calls[0].options.body)
    assert.equal(loginBody.userId, 'test-user')
    assert.equal(loginBody.password, 'test-pass')

    // Biscuit fetch
    assert.equal(calls[1].url, 'https://proxy.example.com/biscuits/generated/w3-e2e-test')
    assert.equal(calls[1].options.method, 'GET')
    assert.equal(calls[1].options.headers.sid, 'sess-abc-123')

    // SQL
    assert.match(calls[2].url, /^https:\/\/sql\.example\.com\/v1\/sql/)
    const sqlBody = JSON.parse(calls[2].options.body)
    assert.equal(sqlBody.sqlText, 'SELECT 1')
    assert.deepEqual(sqlBody.biscuits, ['base64-biscuit-payload'])
    assert.equal(calls[2].options.headers.Authorization, 'Bearer login-jwt-token')
  })

  it('caches session and biscuit across multiple queries', async () => {
    mockFetch([
      { body: LOGIN_RESPONSE },
      { body: BISCUIT_RESPONSE },
      { body: QUERY_RESPONSE },
      { body: QUERY_RESPONSE },
    ])
    const client = new SxtClient(loginConfig)

    await client.query('SELECT 1')
    await client.query('SELECT 2')

    // 4 calls only: 1 login + 1 biscuit + 2 SQL
    assert.equal(calls.length, 4)
  })

  it('surfaces biscuit-not-found with a clear error', async () => {
    mockFetch([{ body: LOGIN_RESPONSE }, { status: 404, body: { detail: 'not found' } }])
    const client = new SxtClient(loginConfig)

    await assert.rejects(
      () => client.query('SELECT 1'),
      (err) => err instanceof SxtError && err.code === 'BISCUIT_FETCH_ERROR',
    )
  })

  it('uses a literal biscuit input when both biscuit and biscuit-name are provided', async () => {
    mockFetch([{ body: LOGIN_RESPONSE }, { body: QUERY_RESPONSE }])
    const client = new SxtClient({ ...loginConfig, biscuit: 'literal-biscuit' })

    await client.query('SELECT 1')

    // Only 2 calls: login + SQL. No biscuit fetch because a literal was supplied.
    assert.equal(calls.length, 2)
    const body = JSON.parse(calls[1].options.body)
    assert.deepEqual(body.biscuits, ['literal-biscuit'])
  })
})
