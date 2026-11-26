import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

// Empty = the app's own address: in development Vite passes /api and /ws on to the backend
// (vite.config.js), so the app also works when opened from a phone. Set VITE_API_BASE_URL when
// the API is served from a different address.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

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
export const MAP_SHIP_LIMIT = 5000
// Must match FULL_DETAIL_ZOOM in backend/src/api/shipCache.ts.
export const FULL_DETAIL_ZOOM = 10

/**
 * Loads ships for the map.
 * - bbox: [minLon, minLat, maxLon, maxLat] of the viewport, or null for anywhere
 * - zoom: map zoom; zoomed out, the server returns one representative ship per grid cell
 *   (level of detail), zoomed in (>= FULL_DETAIL_ZOOM) every ship
 * - density: grid cells per 256 px tile (see config/shipDensity.js); null with zoom >= FULL_DETAIL_ZOOM = no thinning
 */
export const fetchShips = createAsyncThunk(
  'ships/fetchShips',
  async ({ bbox = null, zoom = null, density = null } = {}, { rejectWithValue, signal }) => {
    try {
      const params = new URLSearchParams({ hours: '50', limit: String(MAP_SHIP_LIMIT) })
      if (bbox) params.set('bbox', bbox.join(','))
      if (zoom != null) params.set('zoom', String(Math.floor(zoom)))
      if (density != null) params.set('density', String(density))
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
  // Track history drawn for one ship (TrackLayer). mmsi null = no track shown.
  track: { mmsi: null, hours: 24, status: 'idle', points: 0, error: null },
}

const noTrack = initialState.track

export const shipSlice = createSlice({
  name: 'ships',
  initialState,
  reducers: {
    setSelectedShip: (state, action) => {
      state.selectedShip = action.payload
      // A track belongs to the selected ship: selecting another ship (or none) hides it.
      if (state.track.mmsi != null && state.track.mmsi !== action.payload?.mmsi) state.track = noTrack
    },
    clearSelectedShip: (state) => {
      state.selectedShip = null
      state.track = noTrack
    },
    /** Payload { mmsi, hours }: show that ship's track for the last `hours`. */
    showTrack: (state, action) => {
      const { mmsi, hours } = action.payload
      state.track = { ...noTrack, mmsi, hours: hours ?? state.track.hours, status: 'loading' }
    },
    hideTrack: (state) => {
      state.track = { ...noTrack, hours: state.track.hours }
    },
    /** Set by TrackLayer. Payload { mmsi, status: 'loading' | 'ready' | 'failed', points?, error? }. */
    trackStatus: (state, action) => {
      const { mmsi, status, points = 0, error = null } = action.payload
      if (state.track.mmsi !== mmsi) return // a late answer for a track already hidden
      Object.assign(state.track, { status, points, error })
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
          // Live updates don't carry cell_count (zoomed-out cluster totals): keep the loaded one.
          const count = state.data[i].cell_count
          state.data[i] = count && ship.cell_count == null ? { ...ship, cell_count: count } : ship
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
  showTrack,
  hideTrack,
  trackStatus,
  filterShipsByType,
  filterShipsBySpeed,
  searchShips,
  upsertShips,
  clearFilters
} = shipSlice.actions

export default shipSlice.reducer 