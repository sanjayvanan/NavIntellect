import { API_BASE_URL } from '../store/shipSlice'

/**
 * Live vessel updates and zone alerts over WebSocket (/ws). Reconnects with backoff.
 * The 60s REST poll in ShipLayer stays as a fallback.
 * Only ships inside `bbox` ([minLon, minLat, maxLon, maxLat], null = everywhere) are pushed;
 * call setBbox() when the map moves. Returns { setBbox, close }.
 *
 * Signed in, the socket carries the access token so the server also sends alerts of the user's
 * own zones. `getToken()` is read on every (re)connect, so a refreshed token is picked up; when
 * the server rejects the token (close code 4401), `refreshToken(stale)` is awaited first, and if
 * it yields no new token the socket carries on without one (shared alerts and ships only).
 */
export function connectLiveSocket({ onVessels, onAlert, getToken, refreshToken, bbox = null } = {}) {
  let anonymous = false
  let lastToken = null
  const buildUrl = () => {
    const url = new URL('/ws', (API_BASE_URL || window.location.origin).replace(/^http/, 'ws'))
    lastToken = anonymous ? null : (getToken?.() ?? null)
    if (lastToken) url.searchParams.set('token', lastToken)
    return url
  }

  let ws = null
  let attempt = 0
  let stopped = false
  let retryTimer = null
  let currentBbox = bbox

  const subscribe = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ subscribe: { bbox: currentBbox, alerts: true } }))
    }
  }

  const connect = () => {
    ws = new WebSocket(buildUrl())
    ws.onopen = () => {
      attempt = 0
      subscribe()
    }
    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.type === 'vessels' && Array.isArray(msg.data)) onVessels?.(msg.data)
      else if (msg.type === 'alert') onAlert?.(msg.data)
    }
    ws.onclose = async (event) => {
      if (stopped) return
      if (event.code === 4401 && lastToken) {
        const stale = lastToken
        let fresh = null
        try {
          fresh = (await refreshToken?.(stale)) ?? null
        } catch {
          // network error: retry with whatever token there is
        }
        if (stopped) return
        if (!fresh || fresh === stale) anonymous = true
        else {
          attempt = 0
          return connect()
        }
      }
      const delay = Math.min(30000, 1000 * 2 ** attempt++)
      retryTimer = setTimeout(connect, delay)
    }
  }

  connect()
  return {
    setBbox(next) {
      currentBbox = next
      subscribe()
    },
    close() {
      stopped = true
      clearTimeout(retryTimer)
      ws?.close()
    },
  }
}
