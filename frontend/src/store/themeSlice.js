import { createSlice } from '@reduxjs/toolkit'
import { DEFAULT_DENSITY_LEVEL, DENSITY_LEVELS } from '../config/shipDensity'

// Map/display settings (Settings panel in the sidebar), persisted in localStorage.
const STORAGE_KEY = 'mapSettings'

export const SHIP_SIZES = ['small', 'medium', 'large']

const defaults = {
  mode: 'light', // theme
  clustering: true, // group nearby ships into count bubbles (also the toolbar button)
  shipDensity: DEFAULT_DENSITY_LEVEL, // index into DENSITY_LEVELS: level-of-detail thinning
  shipSize: 'medium', // arrow size on the map
  showLabels: true, // ship names next to arrows when zoomed in
  liveUpdates: true, // WebSocket push; off = refresh every 60 s only
  sidebarCollapsed: false, // rail hidden behind a small floating button
}

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const s = { ...defaults, ...saved }
    if (!Number.isInteger(s.shipDensity) || s.shipDensity < 0 || s.shipDensity >= DENSITY_LEVELS.length) {
      s.shipDensity = DEFAULT_DENSITY_LEVEL
    }
    if (!SHIP_SIZES.includes(s.shipSize)) s.shipSize = defaults.shipSize
    return s
  } catch {
    return { ...defaults }
  }
}

const save = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full or disabled: settings just won't persist
  }
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState: load(),
  reducers: {
    toggleTheme: (state) => {
      state.mode = state.mode === 'light' ? 'dark' : 'light'
      save(state)
    },
    toggleClustering: (state) => {
      state.clustering = !state.clustering
      save(state)
    },
    setShipDensity: (state, action) => {
      state.shipDensity = action.payload
      save(state)
    },
    setShipSize: (state, action) => {
      state.shipSize = action.payload
      save(state)
    },
    toggleLabels: (state) => {
      state.showLabels = !state.showLabels
      save(state)
    },
    toggleLiveUpdates: (state) => {
      state.liveUpdates = !state.liveUpdates
      save(state)
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed
      save(state)
    },
    resetSettings: () => {
      save(defaults)
      return { ...defaults }
    },
  },
})

export const {
  toggleTheme,
  toggleClustering,
  setShipDensity,
  setShipSize,
  toggleLabels,
  toggleLiveUpdates,
  toggleSidebar,
  resetSettings,
} = themeSlice.actions
export default themeSlice.reducer
