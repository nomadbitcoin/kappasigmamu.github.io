/**
 * Minimal HTTP plumbing — CORS, body reading, JSON responses.
 *
 * No framework: this service has four routes and adding Express would be more
 * dependency surface than the thing it serves.
 */

export function resolveOrigin(request, allowedOrigins) {
  const origin = request.headers.origin
  if (!origin) return null
  return allowedOrigins.includes(origin) ? origin : null
}

export function send(response, status, payload, origin) {
  const headers = { 'Content-Type': 'application/json' }
  if (origin) headers['Access-Control-Allow-Origin'] = origin

  response.writeHead(status, headers)
  response.end(JSON.stringify(payload))
}

export function preflight(response, origin) {
  if (!origin) {
    response.writeHead(403)
    response.end()
    return
  }

  response.writeHead(204, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  })
  response.end()
}

/** Read a JSON body, refusing anything oversized before it is buffered in full. */
export function readJson(request, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''

    request.on('data', (chunk) => {
      data += chunk
      if (data.length > limitBytes) {
        reject(new Error('Body too large'))
        request.destroy()
      }
    })

    request.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })

    request.on('error', reject)
  })
}
