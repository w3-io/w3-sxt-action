/**
 * Space and Time API client.
 *
 * Two auth modes:
 *
 *   JWT + Biscuit (recommended):
 *     - Fetches JWT from auth-url using shared secret
 *     - Generates Ed25519-signed biscuit per query
 *     - Sends SQL with Bearer token + biscuit to direct network API
 *
 *   API Key (fallback):
 *     - Sends API key in header to Gateway Proxy
 *     - Simpler but less reliable — use for quick testing only
 *
 * JWT mode is used automatically when auth-url and auth-secret are provided.
 * Falls back to API key mode otherwise.
 *
 * Designed for reuse — import this module directly if building a custom action.
 */

const DEFAULT_PROXY_URL = 'https://proxy.api.makeinfinite.dev'

/**
 * Validate SQL input to reject common injection patterns.
 * The SxT API does not support parameterized queries, so we validate
 * at the client level to catch obvious injection attempts.
 */
function validateSql(sql) {
  const trimmed = sql.trim()

  // Reject multiple statements (semicolons not inside string literals)
  // Simple heuristic: reject any semicolons that aren't at the very end
  const withoutEnd = trimmed.replace(/;\s*$/, '')
  if (withoutEnd.includes(';')) {
    throw new SxtError('SQL contains multiple statements (semicolons). Only single statements are allowed.', {
      code: 'SQL_VALIDATION',
    })
  }
}

/**
 * Validate an identifier (schema name, chain name) to prevent injection
 * in dynamically constructed SQL.
 */
function validateIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new SxtError(
      `Invalid ${label}: "${value}". Only alphanumeric characters and underscores are allowed.`,
      { code: 'SQL_VALIDATION' },
    )
  }
}

export class SxtError extends Error {
  constructor(message, { status, body, code } = {}) {
    super(message)
    this.name = 'SxtError'
    this.status = status
    this.body = body
    this.code = code
  }
}

export class SxtClient {
  constructor({
    apiUrl,
    apiKey,
    authUrl,
    authSecret,
    biscuit,
    schemaName,
    originApp = 'w3-sxt-action',
    maxRetries = 3,
    retryDelay = 2,
    timeout = 30,
  } = {}) {
    if (!schemaName) throw new SxtError('schema-name is required', { code: 'MISSING_SCHEMA' })

    // Determine auth mode
    this.hasExplicitAuth = Boolean(authUrl && authSecret)

    if (!apiKey && !this.hasExplicitAuth) {
      throw new SxtError(
        'Authentication required: provide api-key (recommended) or auth-url + auth-secret',
        { code: 'MISSING_AUTH' },
      )
    }

    // Auth config
    this.apiKey = apiKey
    this.authUrl = authUrl
    this.authSecret = authSecret
    this.biscuit = biscuit || null

    // API URL
    this.apiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : DEFAULT_PROXY_URL

    this.schemaName = schemaName
    this.originApp = originApp
    this.maxRetries = maxRetries
    this.retryDelay = retryDelay
    this.timeout = timeout * 1000

    this.cachedToken = null
    this.tokenExpiresAt = 0
  }

  /**
   * Returns which auth mode is active.
   */
  get authMode() {
    if (this.hasExplicitAuth) return 'jwt-explicit'
    if (this.apiKey) return 'jwt-apikey'
    return 'none'
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Execute a SELECT query.
   *
   * @param {string} sql - SQL SELECT statement
   * @param {object} [options]
   * @param {string[]} [options.resources] - Table references for perf optimization
   * @param {string} [options.queryType] - OLTP or OLAP
   * @returns {Array} Query result rows
   */
  async query(sql, { resources, queryType = 'OLTP' } = {}) {
    if (!sql) throw new SxtError('sql is required', { code: 'MISSING_SQL' })
    validateSql(sql)
    return this.executeSql(sql, { resources, queryType })
  }

  /**
   * Execute DML (INSERT, UPDATE, DELETE).
   *
   * @param {string} sql - SQL DML statement
   * @param {object} [options]
   * @param {string[]} [options.resources] - Table references
   * @returns {object} Affected row count
   */
  async execute(sql, { resources } = {}) {
    if (!sql) throw new SxtError('sql is required', { code: 'MISSING_SQL' })
    validateSql(sql)
    return this.executeSql(sql, { resources })
  }

  /**
   * Execute DDL (CREATE TABLE, DROP TABLE, ALTER).
   *
   * @param {string} sql - SQL DDL statement
   * @returns {object} Success/failure
   */
  async ddl(sql) {
    if (!sql) throw new SxtError('sql is required', { code: 'MISSING_SQL' })
    validateSql(sql)
    return this.executeSql(sql)
  }

  /**
   * List tables in the configured schema by querying system metadata.
   *
   * @returns {Array} Table metadata
   */
  async listTables() {
    validateIdentifier(this.schemaName, 'schema-name')
    const sql = `SHOW TABLES IN ${this.schemaName}`
    return this.executeSql(sql)
  }

  /**
   * Verify connectivity and return a sample from a known indexed chain.
   *
   * @param {string} [chain="ETHEREUM"] - Chain schema name
   * @returns {Array} Latest blocks from the specified chain
   */
  async listChains(chain) {
    const schema = chain ? chain.toUpperCase() : 'ETHEREUM'
    validateIdentifier(schema, 'chain')
    const sql = `SELECT BLOCK_NUMBER, TIME_STAMP FROM ${schema}.BLOCKS ORDER BY BLOCK_NUMBER DESC LIMIT 5`
    return this.executeSql(sql)
  }

  // ---------------------------------------------------------------------------
  // SQL execution with auth + biscuit + retry
  // ---------------------------------------------------------------------------

  async executeSql(sql, { resources, queryType } = {}) {
    const endpoint = '/v1/sql'
    const token = await this.getToken()

    const body = {
      sqlText: sql,
      ...(this.biscuit && { biscuits: [this.biscuit] }),
      ...(resources?.length && { resources }),
      ...(queryType && { queryType }),
    }

    // Always include API key when available (proxy requires it),
    // plus Bearer token for JWT-authenticated requests
    const auth = {}
    if (this.apiKey) auth.apiKey = this.apiKey
    if (token) auth.bearer = token

    return this.requestWithRetry('POST', endpoint, body, auth)
  }

  // ---------------------------------------------------------------------------
  // JWT token management
  // ---------------------------------------------------------------------------

  async getToken() {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    let response

    if (this.hasExplicitAuth) {
      // JWT via explicit auth URL + shared secret
      response = await fetch(this.authUrl, {
        method: 'GET',
        headers: {
          'x-shared-secret': this.authSecret,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeout),
      })
    } else if (this.apiKey) {
      // JWT bootstrapped from API key
      response = await fetch(`${this.apiUrl}/auth/apikey`, {
        method: 'POST',
        headers: {
          apikey: this.apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeout),
      })
    } else {
      return null
    }

    const text = await response.text()

    if (!response.ok) {
      throw new SxtError(`Auth failed: ${response.status}`, {
        status: response.status,
        body: text,
        code: 'AUTH_ERROR',
      })
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new SxtError('Invalid auth response', { body: text, code: 'AUTH_PARSE_ERROR' })
    }

    const token = data.data || data.accessToken || data.access_token
    if (!token) {
      throw new SxtError('No token in auth response', { body: text, code: 'AUTH_NO_TOKEN' })
    }

    // Cache with margin before expiry
    this.cachedToken = token
    if (data.accessTokenExpires) {
      this.tokenExpiresAt = data.accessTokenExpires - 60 * 1000 // 1 min margin
    } else {
      this.tokenExpiresAt = Date.now() + 20 * 60 * 1000 // 20 min default
    }
    return token
  }

  invalidateToken() {
    this.cachedToken = null
    this.tokenExpiresAt = 0
  }

  detectOperation(sql) {
    const trimmed = sql.trim().toUpperCase()
    if (trimmed.startsWith('SELECT')) return 'dql_select'
    if (trimmed.startsWith('INSERT')) return 'dml_insert'
    if (trimmed.startsWith('UPDATE')) return 'dml_update'
    if (trimmed.startsWith('DELETE')) return 'dml_delete'
    if (trimmed.startsWith('CREATE')) return 'ddl_create'
    if (trimmed.startsWith('DROP')) return 'ddl_drop'
    if (trimmed.startsWith('ALTER')) return 'ddl_alter'
    return 'dql_select'
  }

  extractResource(sql) {
    const match = sql.match(/(?:FROM|INTO|UPDATE|TABLE)\s+(\w+\.\w+)/i)
    if (match) return match[1]
    return `${this.schemaName}.*`
  }

  // ---------------------------------------------------------------------------
  // HTTP with retry
  // ---------------------------------------------------------------------------

  async requestWithRetry(method, path, body, auth) {
    let lastError

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request(method, path, body, auth)
      } catch (error) {
        lastError = error

        if (error.status === 401 && attempt < this.maxRetries) {
          this.invalidateToken()
          auth = { bearer: await this.getToken() }
          continue
        }

        if (error.status === 429 && attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * 1000 * Math.pow(2, attempt))
          continue
        }

        if (error.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * 1000 * Math.pow(2, attempt))
          continue
        }

        throw error
      }
    }

    throw lastError
  }

  async request(method, path, body, auth) {
    const url = `${this.apiUrl}${path}`
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      originApp: this.originApp,
    }

    if (auth.apiKey) {
      headers.apikey = auth.apiKey
    }
    if (auth.bearer) {
      headers.Authorization = `Bearer ${auth.bearer}`
    }

    const options = { method, headers, signal: AbortSignal.timeout(this.timeout) }
    if (body) options.body = JSON.stringify(body)

    const response = await fetch(url, options)
    const text = await response.text()

    if (!response.ok) {
      throw new SxtError(`SxT API error: ${response.status}`, {
        status: response.status,
        body: text,
        code: response.status === 429 ? 'RATE_LIMIT' : 'API_ERROR',
      })
    }

    // DDL operations (CREATE, DROP) may return empty body on success
    if (!text || !text.trim()) {
      return { success: true }
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new SxtError('Invalid JSON response', {
        status: response.status,
        body: text,
        code: 'PARSE_ERROR',
      })
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
