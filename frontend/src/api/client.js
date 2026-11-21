const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

const ACCESS_TOKEN_KEY = 'kahvecell.access_token'
const REFRESH_TOKEN_KEY = 'kahvecell.refresh_token'

export function saveAuthTokens(tokens) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export function clearAuthTokens() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_TOKEN_KEY)
}

export async function apiRequest(path, options = {}) {
  const { body, token, headers, ...requestOptions } = options
  const requestHeaders = new Headers(headers)
  const accessToken =
    token === null
      ? null
      : token ?? sessionStorage.getItem(ACCESS_TOKEN_KEY)

  if (accessToken) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`)
  }
  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: requestHeaders,
    body:
      body === undefined || body instanceof FormData
        ? body
        : JSON.stringify(body),
  })

  const responseText = await response.text()
  let responseBody = null
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText)
    } catch {
      responseBody = responseText
    }
  }

  if (!response.ok) {
    const detail = responseBody?.detail
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).join(', ')
      : detail
    const requestError = new Error(
      message || `İstek başarısız oldu (${response.status}).`,
    )
    requestError.status = response.status
    throw requestError
  }

  return responseBody
}

export async function streamOrderEvents(
  path,
  { signal, onOpen, onStatus } = {},
) {
  const accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY)
  if (!accessToken) {
    const error = new Error('Oturum süreniz dolmuş. Yeniden giriş yapın.')
    error.status = 401
    throw error
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  })

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null)
    const error = new Error(
      responseBody?.detail || `İstek başarısız oldu (${response.status}).`,
    )
    error.status = response.status
    throw error
  }
  if (!response.body) {
    throw new Error('Gerçek zamanlı sipariş akışı başlatılamadı.')
  }

  onOpen?.()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function dispatchFrame(frame) {
    let eventName = 'message'
    const dataLines = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':')) continue
      const separator = line.indexOf(':')
      if (separator < 0) continue
      const field = line.slice(0, separator)
      const value = line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') eventName = value
      if (field === 'data') dataLines.push(value)
    }
    if (
      dataLines.length &&
      (eventName === 'snapshot' || eventName === 'status')
    ) {
      onStatus?.(JSON.parse(dataLines.join('\n')))
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let separator
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        dispatchFrame(frame)
      }
    }
    throw new Error('Gerçek zamanlı sipariş bağlantısı kapandı.')
  } finally {
    reader.releaseLock()
  }
}
