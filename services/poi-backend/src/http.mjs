/**
 * Minimal HTTP plumbing — CORS, body reading, JSON responses.
 *
 * No framework: this service has a handful of routes and adding Express would be more
 * dependency surface than the thing it serves.
 */
import Busboy from 'busboy'

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

/**
 * Stream a multipart upload, buffering each expected file under its own byte cap.
 *
 * `fileLimits` maps a field name to its maximum size in bytes. A file that exceeds its
 * cap aborts the whole request immediately, before the oversized body is buffered in
 * full — a client cannot make us hold an unbounded upload in memory. Text fields are
 * collected as strings. Resolves `{ fields, files }` where each file is a `Uint8Array`.
 */
export function readMultipart(request, fileLimits) {
  return new Promise((resolve, reject) => {
    let busboy
    try {
      busboy = Busboy({
        headers: request.headers,
        limits: { files: Object.keys(fileLimits).length, fields: 10 }
      })
    } catch {
      return reject(new Error('Expected a multipart/form-data body'))
    }

    const fields = {}
    const files = {}
    const fail = (error) => {
      request.unpipe(busboy)
      request.destroy()
      reject(error)
    }

    busboy.on('field', (name, value) => {
      fields[name] = value
    })

    busboy.on('file', (name, stream, info) => {
      const cap = fileLimits[name]
      if (cap === undefined) {
        stream.resume() // Unexpected file: drain and ignore rather than buffer it.
        return
      }

      const chunks = []
      let size = 0

      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > cap) return fail(new Error(`File "${name}" exceeds its ${cap}-byte limit`))
        chunks.push(chunk)
      })
      stream.on('limit', () => fail(new Error(`File "${name}" exceeds its ${cap}-byte limit`)))
      stream.on('end', () => {
        files[name] = new Uint8Array(Buffer.concat(chunks, size))
      })
    })

    busboy.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    busboy.on('close', () => resolve({ fields, files }))

    request.pipe(busboy)
  })
}
