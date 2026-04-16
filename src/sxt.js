/**
 * Space and Time API client.
 *
 * Three auth modes, resolved in priority order:
 *
 *   1. Login (user-id + password + biscuit-name)
 *      - Logs in to the Make Infinite proxy with userId/password
 *      - Uses the returned sessionId to fetch a named biscuit
 *      - Executes SQL against api-url with Bearer JWT + biscuit
 *      - This is the pattern dealsync uses in production
 *
 *   2. JWT via explicit auth endpoint (auth-url + auth-secret [+ biscuit])
 *      - GET auth-url with x-shared-secret → JWT
 *      - Caller supplies a pre-fetched biscuit string
 *
 *   3. API key (api-key only)
 *      - Bootstraps a JWT via /auth/apikey
 *      - Works against the Gateway Proxy for a limited set of operations
 *        (typically read-only indexed chain data). DDL is not supported
 *        in this mode — use login mode for writes.
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
    throw new SxtError(
      'SQL contains multiple statements (semicolons). Only single statements are allowed.',
      {
        code: 'SQL_VALIDATION',
      },
    )
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
    userId,
    password,
    biscuitName,
    proxyUrl,
    schemaName,
    originApp = 'w3-sxt-action',
    maxRetries = 3,
    retryDelay = 2,
    timeout = 30,
  } = {}) {
    if (!schemaName) throw new SxtError('schema-name is required', { code: 'MISSING_SCHEMA' })

    // Resolve auth mode: login > explicit-jwt > apikey
    this.hasLoginAuth = Boolean(userId && password && biscuitName)
    this.hasExplicitAuth = Boolean(authUrl && authSecret)

    if (!this.hasLoginAuth && !this.hasExplicitAuth && !apiKey) {
      throw new SxtError(
        'Authentication required: provide (user-id + password + biscuit-name), ' +
          '(auth-url + auth-secret), or api-key',
        { code: 'MISSING_AUTH' },
      )
    }

    // Auth config
    this.apiKey = apiKey || null
    this.authUrl = authUrl || null
    this.authSecret = authSecret || null
    this.biscuit = biscuit || null
    this.userId = userId || null
    this.password = password || null
    this.biscuitName = biscuitName || null

    // URLs. api-url is where SQL runs; proxy-url is where login + biscuit
    // lookup happens. For api-key mode both collapse to the same proxy.
    this.apiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : DEFAULT_PROXY_URL
    this.proxyUrl = proxyUrl ? proxyUrl.replace(/\/+$/, '') : DEFAULT_PROXY_URL

    this.schemaName = schemaName
    this.originApp = originApp
    this.maxRetries = maxRetries
    this.retryDelay = retryDelay
    this.timeout = timeout * 1000

    this.cachedToken = null
    this.tokenExpiresAt = 0
    this.cachedSessionId = null
    this.cachedBiscuit = null
  }

  /**
   * Returns which auth mode is active.
   */
  get authMode() {
    if (this.hasLoginAuth) return 'jwt-login'
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
    const biscuit = await this.getBiscuit()

    const body = {
      sqlText: sql,
      ...(biscuit && { biscuits: [biscuit] }),
      ...(resources?.length && { resources }),
      ...(queryType && { queryType }),
    }

    // Always include API key when available (proxy requires it in apikey mode),
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

    if (this.hasLoginAuth) {
      return this.loginViaProxy()
    }

    if (this.hasExplicitAuth) {
      return this.fetchTokenFromAuthUrl()
    }

    if (this.apiKey) {
      return this.bootstrapTokenFromApiKey()
    }

    return null
  }

  async loginViaProxy() {
    const response = await fetch(`${this.proxyUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userId: this.userId, password: this.password }),
      signal: AbortSignal.timeout(this.timeout),
    })

    const text = await response.text()

    if (!response.ok) {
      throw new SxtError(`Login failed: ${response.status}`, {
        status: response.status,
        body: text,
        code: 'AUTH_ERROR',
      })
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new SxtError('Invalid login response', { body: text, code: 'AUTH_PARSE_ERROR' })
    }

    const token = data.accessToken || data.access_token
    const sessionId = data.sessionId
    if (!token || !sessionId) {
      throw new SxtError('Login response missing accessToken or sessionId', {
        body: text,
        code: 'AUTH_NO_TOKEN',
      })
    }

    this.cachedToken = token
    this.cachedSessionId = sessionId
    this.tokenExpiresAt = data.accessTokenExpires
      ? data.accessTokenExpires - 60 * 1000
      : Date.now() + 20 * 60 * 1000

    return token
  }

  async fetchTokenFromAuthUrl() {
    const response = await fetch(this.authUrl, {
      method: 'GET',
      headers: {
        'x-shared-secret': this.authSecret,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    })

    return this.parseTokenResponse(response)
  }

  async bootstrapTokenFromApiKey() {
    // Bootstrapping a JWT from the api-key is an optimization to avoid
    // sending the key on every request. Some api-keys (e.g. self-serve
    // Studio keys) aren't eligible for the /auth/apikey flow and return
    // 401 here — that's fine; the Gateway Proxy accepts the apikey
    // header directly on /v1/sql, so we can skip bootstrap and let
    // executeSql include the apikey header as the sole credential.
    let response
    try {
      response = await fetch(`${this.apiUrl}/auth/apikey`, {
        method: 'POST',
        headers: { apikey: this.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch {
      // Network error on a non-essential bootstrap — fall back to
      // apikey-only auth for subsequent requests.
      return null
    }

    if (!response.ok) {
      return null
    }

    return this.parseTokenResponse(response)
  }

  async parseTokenResponse(response) {
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

    this.cachedToken = token
    this.tokenExpiresAt = data.accessTokenExpires
      ? data.accessTokenExpires - 60 * 1000
      : Date.now() + 20 * 60 * 1000
    return token
  }

  // ---------------------------------------------------------------------------
  // Biscuit resolution — literal > named lookup > none
  // ---------------------------------------------------------------------------

  async getBiscuit() {
    if (this.biscuit) return this.biscuit
    if (!this.biscuitName) return null
    if (this.cachedBiscuit) return this.cachedBiscuit

    // Ensure we have a valid sessionId (login will set it if not already).
    await this.getToken()
    if (!this.cachedSessionId) {
      throw new SxtError('Cannot fetch biscuit: no sessionId from login', {
        code: 'NO_SESSION',
      })
    }

    const response = await fetch(
      `${this.proxyUrl}/biscuits/generated/${encodeURIComponent(this.biscuitName)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          sid: this.cachedSessionId,
        },
        signal: AbortSignal.timeout(this.timeout),
      },
    )

    const text = await response.text()

    if (!response.ok) {
      throw new SxtError(`Biscuit fetch failed: ${response.status}`, {
        status: response.status,
        body: text,
        code: 'BISCUIT_FETCH_ERROR',
      })
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new SxtError('Invalid biscuit response', {
        body: text,
        code: 'BISCUIT_PARSE_ERROR',
      })
    }

    const biscuit = data.biscuits?.[0]?.biscuit
    if (!biscuit) {
      throw new SxtError(`No biscuit found for name "${this.biscuitName}"`, {
        body: text,
        code: 'BISCUIT_NOT_FOUND',
      })
    }

    this.cachedBiscuit = biscuit
    return biscuit
  }

  invalidateToken() {
    this.cachedToken = null
    this.tokenExpiresAt = 0
    this.cachedSessionId = null
    // Don't drop cachedBiscuit — the biscuit is tied to the named resource,
    // not the session, so it stays valid across re-logins.
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
          const newToken = await this.getToken()
          auth = { ...auth, bearer: newToken }
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
