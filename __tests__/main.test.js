import { jest } from '@jest/globals'
import { readFileSync } from 'fs'

const authFixture = JSON.parse(readFileSync(new URL('../__fixtures__/auth-response.json', import.meta.url)))
const queryFixture = JSON.parse(readFileSync(new URL('../__fixtures__/query-response.json', import.meta.url)))
const dmlFixture = JSON.parse(readFileSync(new URL('../__fixtures__/dml-response.json', import.meta.url)))

const mockFetch = jest.fn()
global.fetch = mockFetch

const mockCore = await import('../__fixtures__/core.js')
jest.unstable_mockModule('@actions/core', () => mockCore)

const { run } = await import('../src/main.js')

function mockOk(data) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  })
}

const JWT_INPUTS = {
  'auth-url': 'https://auth.example.com/token',
  'auth-secret': 'test-secret',
  'biscuit-private-key': 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  'schema-name': 'testschema',
}

const APIKEY_INPUTS = {
  'api-key': 'test-api-key',
  'schema-name': 'testschema',
}

describe('run', () => {
  beforeEach(() => {
    mockCore.reset()
    mockFetch.mockReset()
  })

  test('query command returns rows', async () => {
    mockCore.setInputs({
      command: 'query',
      sql: 'SELECT * FROM eth.blocks LIMIT 2',
      ...JWT_INPUTS,
    })
    mockOk(authFixture)
    mockOk(queryFixture)

    await run()

    const result = JSON.parse(mockCore.getOutputs().result)
    expect(result).toHaveLength(2)
    expect(result[0].BLOCK_NUMBER).toBe(19450000)
    expect(mockCore.getErrors()).toHaveLength(0)
  })

  test('execute command returns affected rows', async () => {
    mockCore.setInputs({
      command: 'execute',
      sql: "INSERT INTO testschema.logs VALUES ('hello')",
      ...JWT_INPUTS,
    })
    mockOk(authFixture)
    mockOk(dmlFixture)

    await run()

    const result = JSON.parse(mockCore.getOutputs().result)
    expect(result[0].UPDATED).toBe(3)
    expect(mockCore.getErrors()).toHaveLength(0)
  })

  test('ddl command works', async () => {
    mockCore.setInputs({
      command: 'ddl',
      sql: 'CREATE TABLE testschema.mytable (id INT)',
      ...JWT_INPUTS,
    })
    mockOk(authFixture)
    mockOk([])

    await run()

    expect(mockCore.getErrors()).toHaveLength(0)
  })

  test('list-tables queries information_schema', async () => {
    mockCore.setInputs({
      command: 'list-tables',
      ...JWT_INPUTS,
    })
    mockOk(authFixture)
    mockOk([{ TABLE_NAME: 'blocks' }, { TABLE_NAME: 'transactions' }])

    await run()

    const result = JSON.parse(mockCore.getOutputs().result)
    expect(result).toHaveLength(2)
    expect(mockCore.getErrors()).toHaveLength(0)
  })

  test('list-chains with filter', async () => {
    mockCore.setInputs({
      command: 'list-chains',
      chain: 'ethereum',
      ...JWT_INPUTS,
    })
    mockOk(authFixture)
    mockOk([{ TABLE_SCHEMA: 'ethereum', TABLE_NAME: 'blocks' }])

    await run()

    expect(mockCore.getErrors()).toHaveLength(0)

    const body = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body.sqlText).toContain('ETHEREUM')
  })

  test('unknown command fails', async () => {
    mockCore.setInputs({
      command: 'bogus',
      ...JWT_INPUTS,
    })

    await run()

    expect(mockCore.getErrors()).toHaveLength(1)
    expect(mockCore.getErrors()[0]).toContain('Unknown command')
  })

  test('missing auth params fails', async () => {
    mockCore.setInputs({
      command: 'query',
      sql: 'SELECT 1',
    })

    await run()

    expect(mockCore.getErrors()).toHaveLength(1)
  })

  test('missing sql for query fails', async () => {
    mockCore.setInputs({
      command: 'query',
      ...JWT_INPUTS,
    })
    mockOk(authFixture)

    await run()

    expect(mockCore.getErrors()).toHaveLength(1)
    expect(mockCore.getErrors()[0]).toContain('sql')
  })

  test('API key mode bootstraps JWT then queries', async () => {
    mockCore.setInputs({
      command: 'query',
      sql: 'SELECT * FROM ETHEREUM.BLOCKS LIMIT 1',
      ...APIKEY_INPUTS,
    })
    // JWT bootstrap from API key
    mockOk({ accessToken: 'jwt-from-apikey', accessTokenExpires: Date.now() + 1800000 })
    // SQL query
    mockOk(queryFixture)

    await run()

    const result = JSON.parse(mockCore.getOutputs().result)
    expect(result).toHaveLength(2)
    expect(mockCore.getErrors()).toHaveLength(0)

    // SQL call should have both apikey and Bearer
    const sqlHeaders = mockFetch.mock.calls[1][1].headers
    expect(sqlHeaders.apikey).toBe('test-api-key')
    expect(sqlHeaders.Authorization).toBe('Bearer jwt-from-apikey')
  })
})
