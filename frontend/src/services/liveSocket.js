import { API_BASE_URL } from '../store/shipSlice'

/**
 * Live vessel updates over WebSocket (/ws). Reconnects with backoff.
 * The 60s REST poll in ShipLayer stays as a fallback.
 * Only ships inside `bbox` ([minLon, minLat, maxLon, maxLat], null = everywhere) are pushed;
 * call setBbox() when the map moves. Returns { setBbox, close }.
 */
export function connectLiveSocket({ onVessels, onAlert, token, bbox = null } = {}) {
  const url = new URL('/ws', API_BASE_URL.replace(/^http/, 'ws'))
  if (token) url.searchParams.set('token', token)

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
    ws = new WebSocket(url)
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
    ws.onclose = () => {
      if (stopped) return
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
