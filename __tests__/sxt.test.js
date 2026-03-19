import { jest } from '@jest/globals'
import { readFileSync } from 'fs'
import { SxtClient, SxtError } from '../src/sxt.js'

const authFixture = JSON.parse(readFileSync(new URL('../__fixtures__/auth-response.json', import.meta.url)))
const queryFixture = JSON.parse(readFileSync(new URL('../__fixtures__/query-response.json', import.meta.url)))
const dmlFixture = JSON.parse(readFileSync(new URL('../__fixtures__/dml-response.json', import.meta.url)))

const mockFetch = jest.fn()
global.fetch = mockFetch

function mockOk(data) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  })
}

function mockError(status, body) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  })
}

const DEFAULT_CONFIG = {
  authUrl: 'https://auth.example.com/token',
  authSecret: 'test-secret',
  biscuitPrivateKey: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  schemaName: 'testschema',
}

describe('SxtClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  test('constructor requires schema-name', () => {
    expect(() => new SxtClient({})).toThrow('schema-name is required')
  })

  test('constructor requires some form of auth', () => {
    expect(() => new SxtClient({ schemaName: 'test' })).toThrow('Authentication required')
  })

  test('constructor accepts explicit JWT auth', () => {
    const client = new SxtClient(DEFAULT_CONFIG)
    expect(client.authMode).toBe('jwt-explicit')
  })

  test('constructor accepts API key (bootstraps JWT)', () => {
    const client = new SxtClient({ apiKey: 'test-key', schemaName: 'test' })
    expect(client.authMode).toBe('jwt-apikey')
  })

  test('explicit JWT takes precedence over API key bootstrap', () => {
    const client = new SxtClient({ ...DEFAULT_CONFIG, apiKey: 'test-key' })
    expect(client.authMode).toBe('jwt-explicit')
  })

  describe('token management', () => {
    test('fetches JWT token with shared secret header', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      // Auth call
      mockOk(authFixture)
      // SQL call
      mockOk(queryFixture)

      await client.query('SELECT 1')

      const [authUrl, authOpts] = mockFetch.mock.calls[0]
      expect(authUrl).toBe('https://auth.example.com/token')
      expect(authOpts.method).toBe('GET')
      expect(authOpts.headers['x-shared-secret']).toBe('test-secret')
    })

    test('caches token across requests', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      // One auth call, two SQL calls
      mockOk(authFixture)
      mockOk(queryFixture)
      mockOk(queryFixture)

      await client.query('SELECT 1')
      await client.query('SELECT 2')

      // Should only have 3 fetch calls (1 auth + 2 sql), not 4
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    test('refreshes token on 401', async () => {
      const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1 })
      // First auth
      mockOk(authFixture)
      // SQL fails with 401
      mockError(401, 'Unauthorized')
      // Re-auth
      mockOk(authFixture)
      // SQL succeeds
      mockOk(queryFixture)

      const result = await client.query('SELECT 1')

      expect(result).toEqual(queryFixture)
      // 4 calls: auth, sql(401), re-auth, sql(200)
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })

  describe('query', () => {
    test('sends SELECT to /v1/sql/dql', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockOk(authFixture)
      mockOk(queryFixture)

      const result = await client.query('SELECT * FROM eth.blocks LIMIT 2')

      expect(result).toEqual(queryFixture)

      const [sqlUrl, sqlOpts] = mockFetch.mock.calls[1]
      expect(sqlUrl).toContain('/v1/sql')
      expect(sqlOpts.headers.Authorization).toContain('Bearer ')

      const body = JSON.parse(sqlOpts.body)
      expect(body.sqlText).toBe('SELECT * FROM eth.blocks LIMIT 2')
    })

    test('passes resources and queryType', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockOk(authFixture)
      mockOk(queryFixture)

      await client.query('SELECT * FROM eth.blocks', {
        resources: ['eth.blocks'],
        queryType: 'OLAP',
      })

      const body = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(body.resources).toEqual(['eth.blocks'])
      expect(body.queryType).toBe('OLAP')
    })

    test('requires sql', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      await expect(client.query('')).rejects.toThrow('sql is required')
    })
  })

  describe('execute', () => {
    test('sends DML to /v1/sql/dml', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockOk(authFixture)
      mockOk(dmlFixture)

      const result = await client.execute("INSERT INTO testschema.logs VALUES ('hello')")

      expect(result).toEqual(dmlFixture)
      expect(mockFetch.mock.calls[1][0]).toContain('/v1/sql')
    })
  })

  describe('ddl', () => {
    test('sends DDL to /v1/sql/ddl', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockOk(authFixture)
      mockOk([])

      await client.ddl('CREATE TABLE testschema.mytable (id INT)')

      expect(mockFetch.mock.calls[1][0]).toContain('/v1/sql')
    })
  })

  describe('operation detection', () => {
    const client = new SxtClient(DEFAULT_CONFIG)

    test('detects SELECT', () => {
      expect(client.detectOperation('SELECT * FROM t')).toBe('dql_select')
    })

    test('detects INSERT', () => {
      expect(client.detectOperation('INSERT INTO t VALUES (1)')).toBe('dml_insert')
    })

    test('detects UPDATE', () => {
      expect(client.detectOperation('UPDATE t SET x = 1')).toBe('dml_update')
    })

    test('detects DELETE', () => {
      expect(client.detectOperation('DELETE FROM t WHERE id = 1')).toBe('dml_delete')
    })

    test('detects CREATE', () => {
      expect(client.detectOperation('CREATE TABLE t (id INT)')).toBe('ddl_create')
    })

    test('detects DROP', () => {
      expect(client.detectOperation('DROP TABLE t')).toBe('ddl_drop')
    })
  })

  describe('resource extraction', () => {
    const client = new SxtClient(DEFAULT_CONFIG)

    test('extracts schema.table from SELECT', () => {
      expect(client.extractResource('SELECT * FROM eth.blocks')).toBe('eth.blocks')
    })

    test('extracts from INSERT INTO', () => {
      expect(client.extractResource("INSERT INTO myapp.logs VALUES ('x')")).toBe('myapp.logs')
    })

    test('extracts from UPDATE', () => {
      expect(client.extractResource('UPDATE myapp.users SET name = 1')).toBe('myapp.users')
    })

    test('falls back to schema wildcard', () => {
      expect(client.extractResource('SELECT 1')).toBe('testschema.*')
    })
  })

  describe('retry logic', () => {
    test('retries on 429 with backoff', async () => {
      const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })
      mockOk(authFixture)
      mockError(429, 'Rate limit')
      mockOk(queryFixture)

      const result = await client.query('SELECT 1')
      expect(result).toEqual(queryFixture)
    })

    test('retries on 500 with backoff', async () => {
      const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })
      mockOk(authFixture)
      mockError(500, 'Server Error')
      mockOk(queryFixture)

      const result = await client.query('SELECT 1')
      expect(result).toEqual(queryFixture)
    })

    test('throws after max retries', async () => {
      const client = new SxtClient({ ...DEFAULT_CONFIG, maxRetries: 1, retryDelay: 0.01 })
      mockOk(authFixture)
      mockError(500, 'Server Error')
      mockError(500, 'Server Error')

      await expect(client.query('SELECT 1')).rejects.toThrow('SxT API error: 500')
    })
  })

  describe('API key JWT bootstrap mode', () => {
    const apiKeyConfig = { apiKey: 'test-api-key', schemaName: 'testschema' }

    test('bootstraps JWT from API key via /auth/apikey', async () => {
      const client = new SxtClient(apiKeyConfig)
      // Auth bootstrap call
      mockOk({ accessToken: 'jwt-from-apikey', accessTokenExpires: Date.now() + 1800000 })
      // SQL call
      mockOk(queryFixture)

      await client.query('SELECT * FROM ETHEREUM.BLOCKS LIMIT 1')

      // First call is POST /auth/apikey
      const [authUrl, authOpts] = mockFetch.mock.calls[0]
      expect(authUrl).toContain('/auth/apikey')
      expect(authOpts.headers.apikey).toBe('test-api-key')

      // Second call includes both apikey and Bearer
      const sqlOpts = mockFetch.mock.calls[1][1]
      expect(sqlOpts.headers.apikey).toBe('test-api-key')
      expect(sqlOpts.headers.Authorization).toBe('Bearer jwt-from-apikey')
    })

    test('caches JWT from API key bootstrap', async () => {
      const client = new SxtClient(apiKeyConfig)
      mockOk({ accessToken: 'jwt-cached', accessTokenExpires: Date.now() + 1800000 })
      mockOk(queryFixture)
      mockOk(queryFixture)

      await client.query('SELECT 1')
      await client.query('SELECT 2')

      // 3 calls: 1 auth bootstrap + 2 SQL queries
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('error handling', () => {
    test('throws on auth failure', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockError(403, 'Forbidden')

      try {
        await client.query('SELECT 1')
      } catch (e) {
        expect(e).toBeInstanceOf(SxtError)
        expect(e.code).toBe('AUTH_ERROR')
      }
    })

    test('throws on invalid JSON response', async () => {
      const client = new SxtClient(DEFAULT_CONFIG)
      mockOk(authFixture)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'not json',
      })

      try {
        await client.query('SELECT 1')
      } catch (e) {
        expect(e).toBeInstanceOf(SxtError)
        expect(e.code).toBe('PARSE_ERROR')
      }
    })
  })
})
