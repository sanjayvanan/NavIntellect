import { API_BASE_URL } from '../store/shipSlice'

/**
 * Session storage + authenticated fetch.
 *
 * The backend rotates refresh tokens and treats a reused one as theft (it revokes every session
 * of that user). So refreshing must never happen twice with the same token: within a tab all
 * callers share one in-flight refresh, and across tabs a Web Lock serialises them. After taking
 * the lock we re-read storage: if another tab already rotated the token, we just use its result.
 */
const SESSION_KEY = 'css.session' // { access_token, refresh_token, user }

export const getSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export const setSession = (session) => {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}

// Called when the session is gone for good (refresh rejected): the app returns to the login page.
let onSessionExpired = () => {}
export const setSessionExpiredHandler = (fn) => {
  onSessionExpired = fn
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function readError(res) {
  let body = null
  try {
    body = await res.json()
  } catch {
    // not JSON
  }
  const detail = body?.details?.[0]?.message
  return new ApiError(res.status, detail || body?.error || `Request failed (${res.status})`, body?.details)
}

/** Unauthenticated JSON POST (login / register). */
export async function postJson(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await readError(res)
  return res.status === 204 ? null : res.json()
}

let refreshing = null

async function doRefresh(staleAccessToken) {
  const current = getSession()
  if (!current?.refresh_token) return null
  // Another tab refreshed while we waited for the lock: its tokens are already in storage.
  if (current.access_token !== staleAccessToken) return current
  const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  })
  if (!res.ok) {
    if (res.status === 401) return null
    throw await readError(res)
  }
  const data = await res.json()
  const next = { ...current, access_token: data.access_token, refresh_token: data.refresh_token }
  setSession(next)
  return next
}

/** Returns a fresh session, or null if the refresh token is no longer valid. */
export function refreshSession(staleAccessToken) {
  if (!refreshing) {
    const run = () => doRefresh(staleAccessToken)
    refreshing = (navigator.locks ? navigator.locks.request('css-auth-refresh', run) : run()).finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

/** fetch() with the bearer token; refreshes once on 401. Returns the Response (status checked). */
async function authedFetch(path, { method = 'GET', body, keepalive = false, signal } = {}) {
  const send = (session) =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      keepalive,
      signal, // AbortSignal: lets callers cancel a request that is no longer wanted
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let session = getSession()
  let res = await send(session)
  if (res.status === 401 && session?.refresh_token) {
    session = await refreshSession(session.access_token)
    if (!session) {
      setSession(null)
      onSessionExpired()
      throw new ApiError(401, 'Your session has expired. Please sign in again.')
    }
    res = await send(session)
  }
  if (!res.ok) throw await readError(res)
  return res
}

/** fetch() against the API with the bearer token; refreshes once on 401. Returns parsed JSON. */
export async function apiFetch(path, options = {}) {
  const res = await authedFetch(path, options)
  return res.status === 204 ? null : res.json()
}

/**
 * POST that answers with Server-Sent Events. Calls onEvent(name, data) for each event; resolves
 * with the data of the final `done` event, or throws an ApiError for an `error` event.
 */
export async function apiStream(path, { body, signal, onEvent }) {
  const res = await authedFetch(path, { method: 'POST', body, signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result
  const handle = (block) => {
    let event = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return
    const parsed = JSON.parse(data)
    if (event === 'error') throw new ApiError(parsed.status ?? 500, parsed.error || 'Something went wrong.')
    if (event === 'done') result = parsed
    else onEvent?.(event, parsed)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      handle(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
    }
  }
  if (buffer.trim()) handle(buffer)
  if (!result) throw new ApiError(502, 'The answer was cut off. Try again.')
  return result
}
