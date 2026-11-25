import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch, getSession, postJson, setSession } from '../services/api'
import { flushSettings, loadUserSettings, resetToDefaults } from './settingsSync'

// status: 'checking' (restoring a saved session) | 'signedOut' | 'signedIn'

/**
 * Signs in with stored tokens, if any, and restores that user's settings.
 * Resolves with the user, or null when there is no usable session (shows the sign-in page).
 */
export const restoreSession = createAsyncThunk('auth/restore', async (_, { dispatch }) => {
  const session = getSession()
  if (!session?.refresh_token) return null
  let user
  try {
    user = await apiFetch('/api/auth/me')
  } catch (err) {
    if (err?.status === 401) {
      setSession(null)
      return null
    }
    if (!session.user) return null
    user = session.user // server unreachable: carry on with the cached session
  }
  setSession({ ...getSession(), user })
  await loadUserSettings(user, dispatch)
  return user
})

const startSession = async (data, dispatch) => {
  setSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user })
  await loadUserSettings(data.user, dispatch)
  return data.user
}

export const login = createAsyncThunk('auth/login', async ({ email, password }, { dispatch, rejectWithValue }) => {
  try {
    return await startSession(await postJson('/api/auth/login', { email, password }), dispatch)
  } catch (err) {
    setSession(null)
    return rejectWithValue(err.message)
  }
})

export const register = createAsyncThunk('auth/register', async ({ name, email, password }, { dispatch, rejectWithValue }) => {
  try {
    return await startSession(await postJson('/api/auth/register', { name: name || undefined, email, password }), dispatch)
  } catch (err) {
    setSession(null)
    return rejectWithValue(err.message)
  }
})

export const logout = createAsyncThunk('auth/logout', async (_, { dispatch }) => {
  await flushSettings()
  const session = getSession()
  setSession(null)
  if (session?.refresh_token) {
    postJson('/api/auth/logout', { refresh_token: session.refresh_token }).catch(() => {})
  }
  resetToDefaults(dispatch)
})

const authSlice = createSlice({
  name: 'auth',
  initialState: { status: 'checking', user: null, error: null, busy: false },
  reducers: {
    // The refresh token was rejected (expired, revoked, or signed out in another tab).
    sessionExpired: (state) => {
      state.status = 'signedOut'
      state.user = null
      state.error = 'Your session has expired. Please sign in again.'
    },
    clearAuthError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.status = action.payload ? 'signedIn' : 'signedOut'
        state.user = action.payload
      })
      .addCase(restoreSession.rejected, (state) => {
        state.status = 'signedOut'
      })
      .addCase(logout.fulfilled, (state) => {
        state.status = 'signedOut'
        state.user = null
        state.error = null
      })
    for (const thunk of [login, register]) {
      builder
        .addCase(thunk.pending, (state) => {
          state.busy = true
          state.error = null
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.busy = false
          state.status = 'signedIn'
          state.user = action.payload
        })
        .addCase(thunk.rejected, (state, action) => {
          state.busy = false
          state.error = action.payload || 'Something went wrong'
        })
    }
  },
})

export const { sessionExpired, clearAuthError } = authSlice.actions
export default authSlice.reducer
