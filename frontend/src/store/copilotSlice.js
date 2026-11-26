import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { copilotApi } from '../services/copilot'

/**
 * AI copilot conversation. Kept in the store so it survives closing the panel; cleared on sign-out.
 * Message: { id, role: 'user' | 'assistant', text, actions?, ships?, error?, cached?, old? }
 * (old: loaded from storage, so its map actions are not run again).
 */

const HISTORY_SENT = 8 // recent messages sent with each question (the server keeps no conversation)

let nextId = 1
const SAVED_MESSAGES = 60 // messages kept per chat
const SAVED_CHATS = 20 // chats kept per user (oldest dropped first)
const chatKey = (userId) => `css.copilot.chat.${userId}`

const isMessage = (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string'
const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * The user's saved chats in this browser: { chats: [{ id, title, updatedAt, messages }], activeChatId }.
 * Reads the older single-chat format too. Empty if nothing is saved or it cannot be read.
 */
export function loadChat(userId) {
  const empty = { chats: [], activeChatId: null }
  try {
    const saved = JSON.parse(localStorage.getItem(chatKey(userId)) || 'null')
    if (Array.isArray(saved)) {
      // Before chat history: just the messages of one chat.
      const messages = saved.filter(isMessage)
      if (!messages.length) return empty
      const chat = { id: newChatId(), title: chatTitle(messages), updatedAt: Date.now(), messages }
      return { chats: [chat], activeChatId: chat.id }
    }
    if (!saved || !Array.isArray(saved.chats)) return empty
    const chats = saved.chats
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({ ...c, messages: c.messages.filter(isMessage) }))
      .filter((c) => c.messages.length)
    return { chats, activeChatId: chats.some((c) => c.id === saved.activeChatId) ? saved.activeChatId : null }
  } catch {
    return empty
  }
}

export function saveChat(userId, { chats, activeChatId }) {
  try {
    if (!chats.length) {
      localStorage.removeItem(chatKey(userId))
      return
    }
    const kept = [...chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SAVED_CHATS)
      .map((c) => ({ ...c, messages: c.messages.slice(-SAVED_MESSAGES) }))
    localStorage.setItem(chatKey(userId), JSON.stringify({ chats: kept, activeChatId }))
  } catch {
    // storage full or blocked: the chat still works, it just isn't kept
  }
}

/** A chat's name in the list: its first question, shortened. */
export function chatTitle(messages) {
  const first = messages.find((m) => m.role === 'user')?.text.trim().replace(/\s+/g, ' ') || 'New chat'
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}

/** Messages loaded from storage: their map actions already ran, so the panel must not run them again. */
const asOld = (messages) => messages.map((m) => ({ ...m, id: nextId++, old: true }))

/** Copies the open conversation into its entry of the chat list (adds it once it has messages). */
function syncActiveChat(state) {
  if (!state.messages.length) return
  if (!state.activeChatId) state.activeChatId = newChatId()
  const chat = { id: state.activeChatId, title: chatTitle(state.messages), updatedAt: Date.now(), messages: state.messages }
  const i = state.chats.findIndex((c) => c.id === state.activeChatId)
  if (i >= 0) state.chats[i] = chat
  else state.chats.unshift(chat)
}

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
  messages: [], // the open chat
  chats: [], // all saved chats, including the open one once it has messages
  activeChatId: null,
  busy: false,
  // Ask the Track info panel to open with these filters ({ query, zone_id, sort, at }).
  shipListRequest: null,
}

const copilotSlice = createSlice({
  name: 'copilot',
  initialState,
  reducers: {
    /** Starts a new chat; the current one stays in the chat list. */
    clearConversation: (state) => {
      if (state.busy) return
      state.messages = []
      state.activeChatId = null
    },
    /** Switches to a saved chat. */
    openChat: (state, action) => {
      const chat = state.chats.find((c) => c.id === action.payload)
      if (!chat || state.busy) return
      state.activeChatId = chat.id
      state.messages = asOld(chat.messages)
    },
    deleteChat: (state, action) => {
      state.chats = state.chats.filter((c) => c.id !== action.payload)
      if (state.activeChatId === action.payload && !state.busy) {
        state.activeChatId = null
        state.messages = []
      }
    },
    /** Puts back the chats saved earlier (on sign-in or page load) and reopens the last one. */
    conversationRestored: (state, action) => {
      const { chats, activeChatId } = action.payload
      state.chats = chats
      state.activeChatId = activeChatId
      state.messages = asOld(chats.find((c) => c.id === activeChatId)?.messages ?? [])
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
        syncActiveChat(state)
      })
      .addCase(askCopilot.fulfilled, (state, action) => {
        const r = action.payload
        state.busy = false
        state.usage = r.usage ?? state.usage
        state.messages.push({ id: nextId++, role: 'assistant', text: r.reply, actions: r.actions ?? [], ships: r.ships ?? [], cached: r.cached })
        syncActiveChat(state)
      })
      .addCase(askCopilot.rejected, (state, action) => {
        state.busy = false
        if (action.meta.aborted) return
        state.messages.push({ id: nextId++, role: 'assistant', text: action.error.message || 'Something went wrong.', error: true })
        syncActiveChat(state)
      })
      .addMatcher((a) => a.type === 'auth/logout/fulfilled' || a.type === 'auth/sessionExpired', () => initialState)
  },
})

export const { clearConversation, conversationRestored, deleteChat, openChat, requestShipList } = copilotSlice.actions
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
  // No lookbehind (needs Safari 16.4+): the character before a match is captured in group 1.
  const re = new RegExp(`(^|[^\\w])(${terms.map(([t]) => escape(t)).join('|')})(?![\\w])`, 'gi')
  const byTerm = new Map(terms.map(([t, s]) => [t.toLowerCase(), s]))
  const out = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1].length
    if (start > last) out.push(text.slice(last, start))
    out.push({ ship: byTerm.get(m[2].toLowerCase()), label: m[2] })
    last = start + m[2].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
