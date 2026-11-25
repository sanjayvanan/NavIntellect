import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { zonesApi } from '../api'

/** Geofences visible to the signed-in user: shared ones (presets + operator-made) and their own. */

const withMessage = (fn) => async (arg, { rejectWithValue }) => {
  try {
    return await fn(arg)
  } catch (err) {
    return rejectWithValue(err.message || 'Request failed')
  }
}

export const fetchZones = createAsyncThunk('zones/fetch', withMessage(() => zonesApi.list()))
export const createZone = createAsyncThunk('zones/create', withMessage((body) => zonesApi.create(body)))
export const updateZone = createAsyncThunk('zones/update', withMessage(({ id, ...body }) => zonesApi.update(id, body)))
export const deleteZone = createAsyncThunk(
  'zones/delete',
  withMessage(async (id) => {
    await zonesApi.remove(id)
    return id
  }),
)

const initialState = { items: [], status: 'idle', error: null }

const zonesSlice = createSlice({
  name: 'zones',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchZones.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(fetchZones.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.items = action.payload
        state.error = null
      })
      .addCase(fetchZones.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload
      })
      .addCase(createZone.fulfilled, (state, action) => {
        state.items.unshift(action.payload)
      })
      .addCase(updateZone.fulfilled, (state, action) => {
        const i = state.items.findIndex((f) => f.id === action.payload.id)
        if (i >= 0) state.items[i] = action.payload
      })
      .addCase(deleteZone.fulfilled, (state, action) => {
        state.items = state.items.filter((f) => f.id !== action.payload)
      })
      // Another user may sign in next: drop this one's zones.
      .addMatcher((a) => a.type === 'auth/logout/fulfilled' || a.type === 'auth/sessionExpired', () => initialState)
  },
})

export default zonesSlice.reducer
