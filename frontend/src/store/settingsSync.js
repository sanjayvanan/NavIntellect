import { createListenerMiddleware } from '@reduxjs/toolkit'
import { apiFetch } from '../services/api'
import { defaults, hydrateSettings, sanitizeSettings } from './themeSlice'

/**
 * Keeps the signed-in user's settings saved:
 *  - every change is written at once to a per-user localStorage cache (marked dirty), and
 *  - pushed to the server (PUT /api/me/preferences) after a short pause, then marked clean;
 *  - when the tab is hidden or closed, a pending push is sent immediately (keepalive).
 * At sign-in the server copy wins, unless this browser holds changes it never managed to upload.
 */
const PUSH_DELAY_MS = 1000
const cacheKey = (userId) => `css.settings.${userId}`

const readCache = (userId) => {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(userId)) || 'null')
  } catch {
    return null
  }
}
const writeCache = (userId, settings, dirty) => {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ settings, dirty }))
  } catch {
    // storage full or disabled: the server copy still has it
  }
}

let timer = null
let pending = null // { userId, settings } waiting to be pushed

async function push({ keepalive = false } = {}) {
  clearTimeout(timer)
  timer = null
  const job = pending
  if (!job) return
  pending = null
  try {
    await apiFetch('/api/me/preferences', { method: 'PUT', body: { settings: job.settings }, keepalive })
    // Only mark clean if nothing newer was cached meanwhile.
    const cached = readCache(job.userId)
    if (cached && JSON.stringify(cached.settings) === JSON.stringify(job.settings)) writeCache(job.userId, job.settings, false)
  } catch (err) {
    // Offline or server down: the cache stays dirty and is uploaded at the next sign-in or change.
    if (err?.status && err.status !== 401) console.warn('Saving settings failed:', err.message, err.details ?? '')
  }
}

/** Sends any pending change now (used before sign-out). */
export const flushSettings = () => push()

/** Loads the user's settings (server, falling back to the local cache) into the store. */
export async function loadUserSettings(user, dispatch) {
  const cached = readCache(user.id)
  let settings
  try {
    const server = await apiFetch('/api/me/preferences')
    const hasServer = server?.settings && Object.keys(server.settings).length > 0
    settings = cached?.dirty || !hasServer ? cached?.settings ?? {} : server.settings
    if (cached?.dirty || (!hasServer && cached)) {
      pending = { userId: user.id, settings: sanitizeSettings(settings) }
      push()
    }
  } catch (err) {
    if (err?.status === 401) throw err
    settings = cached?.settings ?? {} // offline: resume from this browser's copy
  }
  const clean = sanitizeSettings(settings)
  dispatch(hydrateSettings(clean))
  writeCache(user.id, clean, !!cached?.dirty)
}

/** Settings shown on the sign-in page / after sign-out. */
export const resetToDefaults = (dispatch) => dispatch(hydrateSettings(defaults))

export const settingsSync = createListenerMiddleware()
settingsSync.startListening({
  predicate: (action) => action.type.startsWith('theme/') && action.type !== hydrateSettings.type,
  effect: (_action, api) => {
    const { auth, theme } = api.getState()
    const userId = auth.user?.id
    if (!userId || auth.status !== 'signedIn') return
    writeCache(userId, theme, true)
    pending = { userId, settings: theme }
    clearTimeout(timer)
    timer = setTimeout(push, PUSH_DELAY_MS)
  },
})

if (typeof window !== 'undefined') {
  const flushNow = () => pending && push({ keepalive: true })
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNow())
}
