import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

// Applies the active type/speed/search filters to the full ship list.
const applyFilters = (ships, filters) => {
  const q = (filters.searchQuery || '').toLowerCase()
  return ships.filter(ship =>
    (!filters.type || ship.type === filters.type) &&
    ship.speed_over_ground >= filters.speedRange.min &&
    ship.speed_over_ground <= filters.speedRange.max &&
    (!q || ship.track_name.toLowerCase().includes(q) || ship.mmsi.toString().includes(q))
  )
}

// Most recently heard ships per map request; the world has 50k+, more than the map can draw.
export const MAP_SHIP_LIMIT = 3000
// Must match FULL_DETAIL_ZOOM in backend/src/api/shipCache.ts.
export const FULL_DETAIL_ZOOM = 10

/**
 * Loads ships for the map.
 * - bbox: [minLon, minLat, maxLon, maxLat] of the viewport, or null for anywhere
 * - zoom: map zoom; zoomed out, the server returns one representative ship per ~32 px cell
 *   (level of detail), zoomed in (>= FULL_DETAIL_ZOOM) every ship
 */
export const fetchShips = createAsyncThunk(
  'ships/fetchShips',
  async ({ bbox = null, zoom = null } = {}, { rejectWithValue, signal }) => {
    try {
      const params = new URLSearchParams({ hours: '50', limit: String(MAP_SHIP_LIMIT) })
      if (bbox) params.set('bbox', bbox.join(','))
      if (zoom != null) params.set('zoom', String(Math.floor(zoom)))
      const response = await fetch(`${API_BASE_URL}/api/ships/trackList?${params}`, { signal })
      if (!response.ok) throw new Error('Server Error')
      return response.json()
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  data: [],
  filteredShips: [],
  status: 'idle',
  error: null,
  currentRequestId: null, // latest fetchShips request; older responses are ignored
  selectedShip: null,
  filters: {
    type: null,
    speedRange: { min: 0, max: 100 },
    searchQuery: ''
  },
  shipHistory: {} // Store historical positions
}

export const shipSlice = createSlice({
  name: 'ships',
  initialState,
  reducers: {
    setSelectedShip: (state, action) => {
      state.selectedShip = action.payload
      // Store ship position in history
      if (action.payload) {
        if (!state.shipHistory[action.payload.mmsi]) {
          state.shipHistory[action.payload.mmsi] = []
        }
        state.shipHistory[action.payload.mmsi].push({
          position: [action.payload.latitude, action.payload.longitude],
          timestamp: Date.now()
        })
      }
    },
    clearSelectedShip: (state) => {
      state.selectedShip = null
    },
    filterShipsByType: (state, action) => {
      state.filters.type = action.payload
      state.filteredShips = applyFilters(state.data, state.filters)
    },
    filterShipsBySpeed: (state, action) => {
      state.filters.speedRange = action.payload
      state.filteredShips = applyFilters(state.data, state.filters)
    },
    searchShips: (state, action) => {
      state.filters.searchQuery = action.payload
      state.filteredShips = applyFilters(state.data, state.filters)
    },
    // Merges live updates (same shape as trackList rows) by MMSI.
    // Payload: ships[] (adds new ships) or { ships, addNew: false } (only refresh ships already
    // shown, used when zoomed out so live updates don't undo the level-of-detail thinning).
    upsertShips: (state, action) => {
      const { ships, addNew } = Array.isArray(action.payload) ? { ships: action.payload, addNew: true } : action.payload
      const index = new Map(state.data.map((ship, i) => [ship.mmsi, i]))
      let changed = false
      for (const ship of ships) {
        const i = index.get(ship.mmsi)
        if (i === undefined) {
          if (!addNew) continue
          changed = true
          index.set(ship.mmsi, state.data.length)
          state.data.push(ship)
        } else {
          state.data[i] = ship
          changed = true
        }
      }
      if (changed) state.filteredShips = applyFilters(state.data, state.filters)
    },
    clearFilters: (state) => {
      state.filters = initialState.filters
      state.filteredShips = state.data
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchShips.pending, (state, action) => {
        state.status = 'loading'
        state.currentRequestId = action.meta.requestId
      })
      .addCase(fetchShips.fulfilled, (state, action) => {
        // Panning fires several requests; only the newest one may replace the list.
        if (action.meta.requestId !== state.currentRequestId) return
        state.status = 'succeeded'
        state.data = action.payload
        state.filteredShips = applyFilters(action.payload, state.filters)
        state.error = null
      })
      .addCase(fetchShips.rejected, (state, action) => {
        if (action.meta.requestId !== state.currentRequestId) return
        state.status = 'failed'
        state.error = action.payload || 'Failed to fetch ships'
      })
  }
})

export const { 
  setSelectedShip, 
  clearSelectedShip, 
  filterShipsByType,
  filterShipsBySpeed,
  searchShips,
  upsertShips,
  clearFilters
} = shipSlice.actions

export default shipSlice.reducer 