import { apiFetch } from './api'

/** AI copilot API (backend/src/api/routes/ai.ts). Gemini runs on the server; the key never reaches the browser. */
export const copilotApi = {
  /** { enabled, model, usage: { used_today, limit_today, user_used_today, user_limit_today } } */
  status: () => apiFetch('/api/ai/status'),
  /**
   * messages: [{ role: 'user' | 'assistant', text }], newest last.
   * context: { bbox, zoom, selected: { mmsi, name } }
   * -> { reply, actions, ships, usage, requests, cached }
   */
  ask: (messages, context, signal) => apiFetch('/api/ai/copilot', { method: 'POST', body: { messages, context }, signal }),
}
