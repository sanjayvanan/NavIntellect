import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { apiFetch } from '../services/api'

/**
 * Notifications: zone alerts (a ship entered / left a zone, loitering, speeding, AIS lost).
 * They arrive live over the WebSocket (alertReceived) and from GET /api/alerts, which is
 * loaded on sign-in and polled as a fallback. The server only returns alerts the user may see
 * (shared zones + their own). "Read" is per user and kept in this browser (lastReadAt).
 */

export const MAX_ALERTS = 200
const MAX_TOASTS = 3
const readKey = (userId) => `css.alerts.lastRead.${userId || 'anon'}`

/** Adds `incoming` to `items` (both newest first): no duplicates by id, at most MAX_ALERTS. */
export function mergeAlerts(items, incoming) {
  const byId = new Map(items.map((a) => [a.id, a]))
  for (const a of incoming) if (a?.id) byId.set(a.id, { ...byId.get(a.id), ...a })
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, MAX_ALERTS)
}

/** Payload { since?: ISO string }. Without `since`: the latest 100 (first load). */
export const fetchAlerts = createAsyncThunk('alerts/fetch', async ({ since } = {}) => {
  const q = new URLSearchParams({ limit: '100' })
  if (since) q.set('since', since)
  return apiFetch(`/api/alerts?${q}`)
})

const initialState = {
  items: [],
  lastReadAt: 0, // epoch ms; alerts created after it are unread
  userId: null,
  status: 'idle',
  error: null,
  toasts: [], // ids of alerts that arrived while the app was open, shown as pop-ups
  panelOpen: false, // Notifications panel open: new alerts show there, not as pop-ups
}

const addToasts = (state, ids) => {
  if (state.panelOpen) return
  const known = new Set(state.items.map((a) => a.id))
  const fresh = ids.filter((id) => known.has(id) && !state.toasts.includes(id))
  state.toasts = [...fresh, ...state.toasts].slice(0, MAX_TOASTS)
}

const alertsSlice = createSlice({
  name: 'alerts',
  initialState,
  reducers: {
    /** Signed-in user changed (or signed out: null): start over with that user's read state. */
    alertsUserChanged: {
      reducer: (state, action) => ({ ...initialState, userId: action.payload.userId, lastReadAt: action.payload.lastReadAt }),
      prepare: (userId) => {
        let lastReadAt = 0
        try {
          lastReadAt = Number(localStorage.getItem(readKey(userId))) || 0
        } catch {
          // storage unavailable
        }
        return { payload: { userId, lastReadAt } }
      },
    },
    /** A live alert from the WebSocket. */
    alertReceived: (state, action) => {
      const a = action.payload
      if (!a?.id) return
      const isNew = !state.items.some((x) => x.id === a.id)
      state.items = mergeAlerts(state.items, [a])
      if (isNew) addToasts(state, [a.id])
    },
    markAllRead: {
      reducer: (state, action) => {
        state.lastReadAt = Math.max(state.lastReadAt, action.payload.at)
        state.toasts = []
        try {
          localStorage.setItem(readKey(state.userId), String(state.lastReadAt))
        } catch {
          // storage unavailable
        }
      },
      prepare: () => ({ payload: { at: Date.now() } }),
    },
    /** The Notifications panel opened or closed. Either way, what it showed counts as read. */
    notificationsPanelToggled: {
      reducer: (state, action) => {
        state.panelOpen = action.payload.open
        alertsSlice.caseReducers.markAllRead(state, { payload: { at: action.payload.at } })
      },
      prepare: (open) => ({ payload: { open: Boolean(open), at: Date.now() } }),
    },
    dismissToast: (state, action) => {
      state.toasts = state.toasts.filter((id) => id !== action.payload)
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAlerts.pending, (state, action) => {
        if (!action.meta.arg?.since) state.status = 'loading'
      })
      .addCase(fetchAlerts.fulfilled, (state, action) => {
        const before = new Set(state.items.map((a) => a.id))
        state.items = mergeAlerts(state.items, action.payload)
        state.status = 'succeeded'
        state.error = null
        // Polled alerts the socket missed are new too: pop them up (not on the first load).
        if (action.meta.arg?.since) addToasts(state, action.payload.filter((a) => !before.has(a.id)).map((a) => a.id))
      })
      .addCase(fetchAlerts.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.error.message || 'Could not load notifications'
      })
  },
})

export const { alertsUserChanged, alertReceived, markAllRead, notificationsPanelToggled, dismissToast } = alertsSlice.actions

export const selectUnreadCount = (state) =>
  state.alerts.items.reduce((n, a) => n + (Date.parse(a.created_at) > state.alerts.lastReadAt ? 1 : 0), 0)

export default alertsSlice.reducer
