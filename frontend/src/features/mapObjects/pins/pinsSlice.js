import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { annotationsApi } from '../api'

/** Pins (annotations of kind 'pin') visible to the signed-in user: shared ones and their own. */

const withMessage = (fn) => async (arg, { rejectWithValue }) => {
  try {
    return await fn(arg)
  } catch (err) {
    return rejectWithValue(err.message || 'Request failed')
  }
}

export const fetchPins = createAsyncThunk('pins/fetch', withMessage(() => annotationsApi.list('pin')))

/** fields: { name, description, style, scope, latlng } */
export const createPin = createAsyncThunk(
  'pins/create',
  withMessage(({ latlng, ...fields }) =>
    annotationsApi.create({ kind: 'pin', geometry: { type: 'Point', coordinates: [latlng.lng, latlng.lat] }, ...fields }),
  ),
)

/** fields: { id, name?, description?, style? } */
export const updatePin = createAsyncThunk('pins/update', withMessage(({ id, ...fields }) => annotationsApi.update(id, fields)))

/**
 * Moves a pin (drag on the map). Optimistic: the new position shows at once and is reverted if
 * saving fails. arg: { id, latlng, previous: [lng, lat] }
 */
export const movePin = createAsyncThunk(
  'pins/move',
  withMessage(({ id, latlng }) => annotationsApi.update(id, { geometry: { type: 'Point', coordinates: [latlng.lng, latlng.lat] } })),
)

export const deletePin = createAsyncThunk(
  'pins/delete',
  withMessage(async (id) => {
    await annotationsApi.remove(id)
    return id
  }),
)

const initialState = { items: [], status: 'idle', error: null }
const replace = (state, feature) => {
  const i = state.items.findIndex((f) => f.id === feature.id)
  if (i >= 0) state.items[i] = feature
}
const setCoords = (state, id, coordinates) => {
  const pin = state.items.find((f) => f.id === id)
  if (pin) pin.geometry = { type: 'Point', coordinates }
}

const pinsSlice = createSlice({
  name: 'pins',
  initialState,
  reducers: {
    clearPinsError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPins.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(fetchPins.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.items = action.payload
        state.error = null
      })
      .addCase(fetchPins.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload
      })
      .addCase(createPin.fulfilled, (state, action) => {
        state.items.unshift(action.payload)
      })
      .addCase(updatePin.fulfilled, (state, action) => replace(state, action.payload))
      .addCase(movePin.pending, (state, action) => {
        const { id, latlng } = action.meta.arg
        setCoords(state, id, [latlng.lng, latlng.lat])
      })
      .addCase(movePin.fulfilled, (state, action) => replace(state, action.payload))
      .addCase(movePin.rejected, (state, action) => {
        const { id, previous } = action.meta.arg
        setCoords(state, id, previous)
        state.error = `Could not move the pin: ${action.payload}`
      })
      .addCase(deletePin.fulfilled, (state, action) => {
        state.items = state.items.filter((f) => f.id !== action.payload)
      })
      // Another user may sign in next: drop this one's pins.
      .addMatcher((a) => a.type === 'auth/logout/fulfilled' || a.type === 'auth/sessionExpired', () => initialState)
  },
})

export const { clearPinsError } = pinsSlice.actions
export default pinsSlice.reducer
