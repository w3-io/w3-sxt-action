/**
 * TODO: Rename this file to match your partner (e.g. cube3.js, pyth.js).
 *
 * This is your API client — the core logic of the action. It should:
 *
 *   1. Be independent of @actions/core (no imports from it here).
 *      This lets others reuse it outside of GitHub Actions.
 *
 *   2. Use fetch() for HTTP — no external HTTP libraries needed.
 *      Node 20 has fetch built in globally.
 *
 *   3. Throw YourPartnerError on failures, with a machine-readable
 *      error code. The main.js router catches these and reports them.
 *
 *   4. Return clean, well-structured objects. Don't leak the raw API
 *      response shape — normalize it into something stable.
 *
 * Pattern:
 *   - Constructor takes config (apiKey, baseUrl)
 *   - One public method per command (e.g. inspect(), query(), chat())
 *   - Private helpers for formatting, parsing, error handling
 *
 * See w3-cube3-action/src/cube3.js or w3-pyth-action/src/pyth.js
 * for real examples.
 */

// TODO: Rename to match your partner
const DEFAULT_BASE_URL = 'https://api.yourpartner.com'

// TODO: Rename this error class (e.g. Cube3Error, PythError)
export class ClientError extends Error {
  constructor(message, { status, body, code } = {}) {
    super(message)
    this.name = 'ClientError'
    this.status = status
    this.body = body
    this.code = code
  }
}

// TODO: Rename this class (e.g. Cube3Client, PythClient)
export class Client {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL } = {}) {
    // TODO: Remove this check if your API doesn't need auth (like Pyth)
    if (!apiKey) throw new ClientError('API key is required', { code: 'MISSING_API_KEY' })
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  /**
   * TODO: Replace with your first command.
   *
   * Example (from Cube3):
   *   async inspect(address, { chainId } = {}) { ... }
   *
   * Example (from Pyth):
   *   async getLatestPrices(ids) { ... }
   */
  async exampleCommand(input) {
    if (!input) throw new ClientError('Input is required', { code: 'MISSING_INPUT' })

    const url = `${this.baseUrl}/v1/example/${encodeURIComponent(input)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // TODO: Adjust auth header to match your partner's API.
        // Common patterns:
        //   'X-Api-Key': this.apiKey          (Cube3)
        //   'Authorization': `Bearer ${this.apiKey}`  (Hyperbolic)
        //   (none)                              (Pyth — no auth)
        'X-Api-Key': this.apiKey,
        Accept: 'application/json',
      },
    })

    const body = await response.text()

    if (!response.ok) {
      throw new ClientError(`API error: ${response.status}`, {
        status: response.status,
        body,
        code: 'API_ERROR',
      })
    }

    let data
    try {
      data = JSON.parse(body)
    } catch {
      throw new ClientError('Invalid JSON response', {
        status: response.status,
        body,
        code: 'PARSE_ERROR',
      })
    }

    // TODO: Format the raw API response into a clean, stable structure.
    // Don't return the raw response — normalize field names, filter
    // unnecessary data, and document the shape in w3-action.yaml.
    return this.formatResult(data)
  }

  /**
   * TODO: Format raw API response into your documented output shape.
   */
  formatResult(data) {
    return data
  }
}
