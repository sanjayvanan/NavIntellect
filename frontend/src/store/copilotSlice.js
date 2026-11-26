import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { copilotApi } from '../services/copilot'

/**
 * AI copilot conversation. Kept in the store so it survives closing the panel; cleared on sign-out.
 * Message: { id, role: 'user' | 'assistant', text, actions?, ships?, error?, cached? }
 */

const HISTORY_SENT = 8 // recent messages sent with each question (the server keeps no conversation)

let nextId = 1

export const loadCopilotStatus = createAsyncThunk('copilot/status', () => copilotApi.status())

/** Payload { text, context }. Sends the recent conversation plus the new question. */
export const askCopilot = createAsyncThunk('copilot/ask', async ({ text, context }, { getState, signal }) => {
  // `pending` has already added this question to the list: leave it out of the history.
  // Questions that failed are left out together with their error, so roles keep alternating.
  const earlier = getState().copilot.messages.slice(0, -1)
  const history = earlier
    .filter((m, i) => !m.error && !earlier[i + 1]?.error)
    .slice(-HISTORY_SENT)
    .map((m) => ({ role: m.role, text: m.text }))
  return copilotApi.ask([...history, { role: 'user', text }], context, signal)
})

const initialState = {
  enabled: null, // null = not known yet
  model: null,
  usage: null,
  messages: [],
  busy: false,
  // Ask the Track info panel to open with these filters ({ query, zone_id, sort, at }).
  shipListRequest: null,
}

const copilotSlice = createSlice({
  name: 'copilot',
  initialState,
  reducers: {
    clearConversation: (state) => {
      state.messages = []
    },
    requestShipList: {
      reducer: (state, action) => {
        state.shipListRequest = action.payload
      },
      prepare: (filter) => ({ payload: { ...filter, at: Date.now() } }),
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCopilotStatus.fulfilled, (state, action) => {
        state.enabled = action.payload.enabled
        state.model = action.payload.model
        state.usage = action.payload.usage
      })
      .addCase(loadCopilotStatus.rejected, (state) => {
        state.enabled = false
      })
      .addCase(askCopilot.pending, (state, action) => {
        state.busy = true
        state.messages.push({ id: nextId++, role: 'user', text: action.meta.arg.text })
      })
      .addCase(askCopilot.fulfilled, (state, action) => {
        const r = action.payload
        state.busy = false
        state.usage = r.usage ?? state.usage
        state.messages.push({ id: nextId++, role: 'assistant', text: r.reply, actions: r.actions ?? [], ships: r.ships ?? [], cached: r.cached })
      })
      .addCase(askCopilot.rejected, (state, action) => {
        state.busy = false
        if (action.meta.aborted) return
        state.messages.push({ id: nextId++, role: 'assistant', text: action.error.message || 'Something went wrong.', error: true })
      })
      .addMatcher((a) => a.type === 'auth/logout/fulfilled' || a.type === 'auth/sessionExpired', () => initialState)
  },
})

export const { clearConversation, requestShipList } = copilotSlice.actions
export default copilotSlice.reducer

/**
 * Splits an answer into text and ship links: every name or MMSI of a ship the copilot looked up
 * becomes { ship } so the UI can make it clickable. Longest names first; case-insensitive.
 */
export function linkShips(text, ships) {
  const terms = []
  for (const s of ships ?? []) {
    if (s.name && s.name.trim().length >= 3 && !/^MMSI \d+$/.test(s.name)) terms.push([s.name.trim(), s])
    terms.push([String(s.mmsi), s])
  }
  if (!terms.length || !text) return [text]
  terms.sort((a, b) => b[0].length - a[0].length)
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\w])(${terms.map(([t]) => escape(t)).join('|')})(?![\\w])`, 'gi')
  const byTerm = new Map(terms.map(([t, s]) => [t.toLowerCase(), s]))
  const out = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ ship: byTerm.get(m[0].toLowerCase()), label: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
