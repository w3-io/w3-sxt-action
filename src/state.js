/**
 * State entity layer for the SxT action (Story 1.1 — w3-give v0 steel thread).
 *
 * Adds state-shaped commands on top of the raw SQL `SxtClient`:
 *
 *   - put-entity      → append a new version row (append-only); merge-then-append
 *                       with optional `expected-version` CAS
 *   - get-entity      → read the latest version of an entity by id, tenant-scoped
 *   - query-entities  → PostgREST-style filter/sort/limit over the latest-version
 *                       view, tenant-scoped
 *
 * Design (carried from the preserved 1.1 design, re-homed onto the action):
 *
 *   - ONE generic versioned table `<schema>.ENTITY_VERSIONS` holds every entity
 *     type. `entity_type` is a DATA value (a column), never a table name — which
 *     removes the reserved-word ("USER") and identifier-injection surface the old
 *     per-entity-table design had to defend.
 *   - Append-only: `put-entity` always INSERTs a new monotonic VERSION; history is
 *     retained. Mutating history is physically impossible because the runtime
 *     biscuit grants only `dql_select` + `dml_insert` (verified 403 on real SxT) —
 *     enforcement lives in the biscuit, this module never emits UPDATE/DELETE.
 *   - SxT has no JSON column functions and no parameterized queries, so:
 *       * the business fields are stored as a JSON string in the FIELDS column,
 *       * filtering happens client-side (post-fetch) over the latest-version set,
 *       * all values are single-quote-escaped (ANSI '' doubling) before
 *         interpolation, and control characters are rejected.
 *
 * This module imports only `./sxt.js` (no action-core / @actions/core), so its
 * unit tests run under plain `node --test` with the global `fetch` mocked.
 */

import { SxtError } from './sxt.js'

/** The single generic versioned-entity table (schema-qualified at call time). */
export const STATE_TABLE = 'ENTITY_VERSIONS'

/** Default and hard cap for query-entities result size (no cursor paging in v0). */
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 500

/** Repo typed-error vocabulary surfaced as command errors. */
export const ErrorCode = {
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_FAILURE: 'UPSTREAM_FAILURE',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
}

/**
 * A typed state error. `code` is one of {@link ErrorCode}; the action surfaces it
 * as the `error-code` output plus a `[CODE] message` failure.
 */
export class StateError extends Error {
  constructor(message, code = ErrorCode.INVALID_INPUT) {
    super(message)
    this.name = 'StateError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// SQL-safety boundary (no parameterized queries in SxT)
// ---------------------------------------------------------------------------

/**
 * Escape a value for interpolation inside an ANSI single-quoted SQL string.
 * SxT uses ANSI string literals, so a backslash is NOT an escape character —
 * doubling single quotes is sufficient and a backslash-breakout is not possible.
 * Control characters are rejected outright (defense-in-depth; they have no place
 * in a key or field and can corrupt downstream consumers).
 */
export function escapeSqlString(value) {
  const s = String(value)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(s)) {
    throw new StateError('value contains control characters', ErrorCode.INVALID_INPUT)
  }
  return s.replace(/'/g, "''")
}

/** Require a non-empty string key component (tenant-id / entity-type / id). */
function requireKey(value, label) {
  if (value === undefined || value === null || String(value).length === 0) {
    throw new StateError(`${label} is required`, ErrorCode.INVALID_INPUT)
  }
  return escapeSqlString(value)
}

/** Parse a JSON input that may already be an object/array; typed on failure. */
function parseJsonInput(value, label, { allow = 'object' } = {}) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new StateError(`${label} is not valid JSON`, ErrorCode.INVALID_INPUT)
    }
  }
  if (allow === 'object') {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new StateError(`${label} must be a JSON object`, ErrorCode.INVALID_INPUT)
    }
  } else if (allow === 'array') {
    if (!Array.isArray(parsed)) {
      throw new StateError(`${label} must be a JSON array`, ErrorCode.INVALID_INPUT)
    }
  }
  return parsed
}

/**
 * Translate a raw SxtClient/SxtError into a typed StateError. Network/5xx →
 * UPSTREAM_FAILURE; 429 → RATE_LIMITED; client-side SQL validation → INVALID_INPUT.
 */
function mapClientError(error) {
  if (error instanceof StateError) return error
  if (error instanceof SxtError) {
    if (error.status === 429 || error.code === 'RATE_LIMIT') {
      return new StateError(error.message, ErrorCode.RATE_LIMITED)
    }
    if (error.code === 'SQL_VALIDATION') {
      return new StateError(error.message, ErrorCode.INVALID_INPUT)
    }
    if (typeof error.status === 'number' && error.status >= 500) {
      return new StateError(error.message, ErrorCode.UPSTREAM_FAILURE)
    }
    // Auth / parse / other upstream conditions are treated as upstream failures —
    // the dispatcher only walks fallbacks on UPSTREAM_FAILURE / RATE_LIMITED.
    return new StateError(error.message, ErrorCode.UPSTREAM_FAILURE)
  }
  // Unknown (e.g. a fetch timeout that didn't become an SxtError) → upstream.
  return new StateError(error?.message || 'upstream failure', ErrorCode.UPSTREAM_FAILURE)
}

// ---------------------------------------------------------------------------
// Latest-version read
// ---------------------------------------------------------------------------

/**
 * Read the latest version row for (tenant, type, id). Returns
 * `{ version, fields }` or `null` when the entity has no versions.
 * @private
 */
async function readLatest(client, { tenant, entityType, id }) {
  const table = `${client.schemaName}.${STATE_TABLE}`
  const sql =
    `SELECT VERSION, FIELDS FROM ${table} ` +
    `WHERE TENANT_ID = '${tenant}' AND ENTITY_TYPE = '${entityType}' AND ID = '${id}' ` +
    `ORDER BY VERSION DESC LIMIT 1`

  let rows
  try {
    rows = await client.query(sql)
  } catch (error) {
    throw mapClientError(error)
  }

  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0]
  return { version: Number(row.VERSION), fields: parseFields(row.FIELDS) }
}

/** Parse a stored FIELDS column (JSON string) defensively. */
function parseFields(raw) {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    // A non-JSON FIELDS value should never happen (we always write JSON), but
    // surfacing it as an upstream/data fault beats throwing an untyped error.
    throw new StateError('stored entity FIELDS is not valid JSON', ErrorCode.UPSTREAM_FAILURE)
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * put-entity — append a new version row (append-only). Reads the current latest,
 * merges the incoming partial `fields` onto it, enforces optional `expectedVersion`
 * CAS, then INSERTs a new monotonic version. Re-putting the same key always
 * appends a NEW version (idempotency is the orchestrator's job via a correlation
 * key — a replay is not a storage no-op).
 *
 * @returns {Promise<{entity: object, version: number}>}
 */
export async function putEntity(
  client,
  { tenantId, entityType, id, fields, expectedVersion } = {},
) {
  const tenant = requireKey(tenantId, 'tenant-id')
  const type = requireKey(entityType, 'entity-type')
  const key = requireKey(id, 'id')
  const incoming = parseJsonInput(fields, 'fields', { allow: 'object' })

  const latest = await readLatest(client, { tenant, entityType: type, id: key })
  const currentVersion = latest ? latest.version : 0

  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
    const expected = Number(expectedVersion)
    if (!Number.isInteger(expected)) {
      throw new StateError('expected-version must be an integer', ErrorCode.INVALID_INPUT)
    }
    if (expected !== currentVersion) {
      throw new StateError(
        `stale expected-version ${expected} (current is ${currentVersion})`,
        ErrorCode.PRECONDITION_FAILED,
      )
    }
  }

  // Merge-then-append. tenant_id + id are stamped so the stored entity is
  // self-describing (a row read back carries its own keys).
  const merged = {
    ...(latest ? latest.fields : {}),
    ...incoming,
    tenant_id: String(tenantId),
    id: String(id),
  }
  const newVersion = currentVersion + 1

  const table = `${client.schemaName}.${STATE_TABLE}`
  const fieldsJson = escapeSqlString(JSON.stringify(merged))
  const createdAt = Date.now()
  const sql =
    `INSERT INTO ${table} (TENANT_ID, ENTITY_TYPE, ID, VERSION, FIELDS, CREATED_AT) ` +
    `VALUES ('${tenant}', '${type}', '${key}', ${newVersion}, '${fieldsJson}', ${createdAt})`

  try {
    await client.execute(sql)
  } catch (error) {
    throw mapClientError(error)
  }

  return { entity: merged, version: newVersion }
}

/**
 * get-entity — read the latest version of an entity by id, tenant-scoped.
 * Not-found is NOT an error: returns `{ entity: null }`.
 *
 * @returns {Promise<{entity: object|null, version?: number}>}
 */
export async function getEntity(client, { tenantId, entityType, id } = {}) {
  const tenant = requireKey(tenantId, 'tenant-id')
  const type = requireKey(entityType, 'entity-type')
  const key = requireKey(id, 'id')

  const latest = await readLatest(client, { tenant, entityType: type, id: key })
  if (!latest) return { entity: null }
  return { entity: latest.fields, version: latest.version }
}

/**
 * query-entities — PostgREST-style filter/sort/limit over the latest-version view,
 * tenant-scoped. The latest-version set is selected in SQL (ROW_NUMBER window);
 * filter/sort/limit are applied client-side because SxT has no JSON functions.
 *
 * @returns {Promise<Array<object>>} latest version per id, filtered/sorted/limited
 */
export async function queryEntities(client, { tenantId, entityType, filter, sort, limit } = {}) {
  const tenant = requireKey(tenantId, 'tenant-id')
  const type = requireKey(entityType, 'entity-type')

  const filterSpec =
    filter === undefined || filter === null || filter === ''
      ? {}
      : parseJsonInput(filter, 'filter', { allow: 'object' })
  const sortSpec =
    sort === undefined || sort === null || sort === ''
      ? []
      : parseJsonInput(sort, 'sort', { allow: 'array' })
  const cap = resolveLimit(limit)

  const table = `${client.schemaName}.${STATE_TABLE}`
  // Latest version per id, tenant + type scoped, via a ROW_NUMBER window.
  const sql =
    `SELECT ID, FIELDS, VERSION FROM (` +
    `SELECT ID, FIELDS, VERSION, ROW_NUMBER() OVER (PARTITION BY ID ORDER BY VERSION DESC) AS RN ` +
    `FROM ${table} WHERE TENANT_ID = '${tenant}' AND ENTITY_TYPE = '${type}'` +
    `) WHERE RN = 1`

  let rows
  try {
    rows = await client.query(sql)
  } catch (error) {
    throw mapClientError(error)
  }

  let entities = (Array.isArray(rows) ? rows : []).map((r) => parseFields(r.FIELDS))
  entities = entities.filter((e) => matchesFilter(e, filterSpec))
  entities = applySort(entities, sortSpec)
  return entities.slice(0, cap)
}

/** transaction → NOT_SUPPORTED (SxT has no multi-entity transaction). */
export function transaction() {
  throw new StateError(
    'transaction is not supported on the SxT state action (no multi-entity transaction)',
    ErrorCode.NOT_SUPPORTED,
  )
}

/** object-store ops → NOT_SUPPORTED (object store is the cloud: syscall / Storj). */
export function objectStore(op) {
  throw new StateError(
    `${op} is not supported on the SxT state action (object store is the cloud: syscall, Story 1.2)`,
    ErrorCode.NOT_SUPPORTED,
  )
}

// ---------------------------------------------------------------------------
// Client-side filter / sort / limit (PostgREST-style)
// ---------------------------------------------------------------------------

function resolveLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return DEFAULT_LIMIT
  const n = Number(limit)
  if (!Number.isInteger(n) || n < 0) {
    throw new StateError('limit must be a non-negative integer', ErrorCode.INVALID_INPUT)
  }
  return Math.min(n, MAX_LIMIT)
}

/** Coerce two operands to numbers when both look numeric, for ordered/equality compares. */
function coerceNum(a, b) {
  const na = typeof a === 'number' ? a : Number(a)
  const nb = typeof b === 'number' ? b : Number(b)
  if (
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    a !== null &&
    b !== null &&
    a !== '' &&
    b !== ''
  ) {
    return [na, nb]
  }
  return null
}

function eqValues(fieldVal, target) {
  const nums = coerceNum(fieldVal, target)
  if (nums) return nums[0] === nums[1]
  return fieldVal === target
}

/**
 * Apply a PostgREST-style filter spec: `{ field: { op: value }, ... }`.
 * Every field-spec must be an operator object (or `null` shorthand for is_null:true).
 * Operators: eq, neq, in, like, contains, gt, gte, lt, lte, is_null.
 * Unknown operators / mistyped operands raise INVALID_INPUT (fail-closed) rather
 * than silently dropping rows.
 */
export function matchesFilter(entity, filterSpec) {
  for (const [field, spec] of Object.entries(filterSpec)) {
    const value = entity[field]

    // `{ field: null }` shorthand → is_null true
    const ops = spec === null ? { is_null: true } : spec
    if (typeof ops !== 'object' || Array.isArray(ops)) {
      throw new StateError(
        `filter for "${field}" must be an operator object`,
        ErrorCode.INVALID_INPUT,
      )
    }

    for (const [op, target] of Object.entries(ops)) {
      if (!applyOperator(op, value, target)) return false
    }
  }
  return true
}

function applyOperator(op, value, target) {
  switch (op) {
    case 'eq':
      return eqValues(value, target)
    case 'neq':
      return !eqValues(value, target)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const nums = coerceNum(value, target)
      const [a, b] = nums || [value, target]
      if (op === 'gt') return a > b
      if (op === 'gte') return a >= b
      if (op === 'lt') return a < b
      return a <= b
    }
    case 'in': {
      if (!Array.isArray(target)) {
        throw new StateError('"in" filter value must be an array', ErrorCode.INVALID_INPUT)
      }
      return target.some((t) => eqValues(value, t))
    }
    case 'like': {
      if (typeof target !== 'string') {
        throw new StateError('"like" filter pattern must be a string', ErrorCode.INVALID_INPUT)
      }
      if (typeof value !== 'string') return false
      return likeToRegExp(target).test(value)
    }
    case 'contains': {
      // array-membership (scalar target), array-containment (array target),
      // or string-substring — mirrors the cross-vendor `contains` semantics.
      if (Array.isArray(value)) {
        if (Array.isArray(target)) return target.every((t) => value.some((v) => eqValues(v, t)))
        return value.some((v) => eqValues(v, target))
      }
      if (typeof value === 'string' && typeof target === 'string') return value.includes(target)
      return false
    }
    case 'is_null': {
      if (typeof target !== 'boolean') {
        throw new StateError('"is_null" filter value must be a boolean', ErrorCode.INVALID_INPUT)
      }
      const isNull = value === null || value === undefined
      return target ? isNull : !isNull
    }
    default:
      throw new StateError(`unsupported filter operator "${op}"`, ErrorCode.INVALID_INPUT)
  }
}

/** Translate SQL LIKE wildcards (% and _) to an anchored, escaped RegExp. */
function likeToRegExp(pattern) {
  let out = '^'
  for (const ch of pattern) {
    if (ch === '%') out += '.*'
    else if (ch === '_') out += '.'
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  out += '$'
  return new RegExp(out, 's')
}

/**
 * Stable multi-key sort. `sortSpec` is `[{ field, direction }, ...]`, most
 * significant first; `direction` defaults to `asc` and must be `asc`|`desc`.
 */
export function applySort(entities, sortSpec) {
  if (!Array.isArray(sortSpec) || sortSpec.length === 0) return entities

  // Validate up front so a bad spec fails closed, not mid-sort.
  for (const s of sortSpec) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || !s.field) {
      throw new StateError('each sort entry must be { field, direction }', ErrorCode.INVALID_INPUT)
    }
    if (s.direction !== undefined && s.direction !== 'asc' && s.direction !== 'desc') {
      throw new StateError('sort direction must be "asc" or "desc"', ErrorCode.INVALID_INPUT)
    }
  }

  // Apply least-significant key first so the final pass (most significant) wins;
  // Array.prototype.sort is stable in Node, preserving prior order on ties.
  const sorted = [...entities]
  for (let i = sortSpec.length - 1; i >= 0; i--) {
    const { field, direction = 'asc' } = sortSpec[i]
    const dir = direction === 'desc' ? -1 : 1
    sorted.sort((x, y) => compareValues(x[field], y[field]) * dir)
  }
  return sorted
}

function compareValues(a, b) {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  const nums = coerceNum(a, b)
  if (nums) return nums[0] < nums[1] ? -1 : nums[0] > nums[1] ? 1 : 0
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
