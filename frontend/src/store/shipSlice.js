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

export const fetchShips = createAsyncThunk(
  'ships/fetchShips',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/trackList?hours=50`)
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
    // Merges live WebSocket updates (same shape as trackList rows) into the list by MMSI.
    upsertShips: (state, action) => {
      const index = new Map(state.data.map((ship, i) => [ship.mmsi, i]))
      for (const ship of action.payload) {
        const i = index.get(ship.mmsi)
        if (i === undefined) {
          index.set(ship.mmsi, state.data.length)
          state.data.push(ship)
        } else {
          state.data[i] = ship
        }
      }
      state.filteredShips = applyFilters(state.data, state.filters)
    },
    clearFilters: (state) => {
      state.filters = initialState.filters
      state.filteredShips = state.data
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchShips.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(fetchShips.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.data = action.payload
        state.filteredShips = applyFilters(action.payload, state.filters)
        state.error = null
      })
      .addCase(fetchShips.rejected, (state, action) => {
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