import { apiFetch, apiStream } from './api'

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
  /**
   * Same as ask, streamed: onEvent(name, data) gets 'tools' ({ names }), 'delta' ({ text }) and
   * 'discard' (clear the text so far) while the answer is written; resolves with ask's result.
   */
  askStream: (messages, context, signal, onEvent) =>
    apiStream('/api/ai/copilot/stream', { body: { messages, context }, signal, onEvent }),
  /** AI briefing of a ship -> { text, cached, usage } */
  explainShip: (mmsi, signal) => apiFetch(`/api/ai/explain/ship/${mmsi}`, { method: 'POST', signal }),
  /** Why an alert matters -> { text, cached, usage } */
  explainAlert: (id, signal) => apiFetch(`/api/ai/explain/alert/${encodeURIComponent(id)}`, { method: 'POST', signal }),
  /**
   * Shadow-cursor guide: { question, layout, panel, targets: [{ id, label, hint }] }
   * -> { title, steps: [{ target, say, action }], note, cached, usage }
   */
  guide: (body, signal) => apiFetch('/api/ai/guide', { method: 'POST', body, signal }),
}
