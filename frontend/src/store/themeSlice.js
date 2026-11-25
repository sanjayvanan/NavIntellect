import { createSlice } from '@reduxjs/toolkit'
import { DEFAULT_DENSITY_LEVEL, DENSITY_LEVELS } from '../config/shipDensity'
import { baseLayers, overlayLayers } from '../config/mapLayers'

// The signed-in user's personal settings: theme, display options, and where they left the map.
// Saved per user (localStorage cache + server) by store/settingsSync.js, restored at sign-in.

export const SHIP_SIZES = ['small', 'medium', 'large']

export const defaults = {
  mode: 'light', // theme
  clustering: true, // group nearby ships into count bubbles (also the toolbar button)
  shipDensity: DEFAULT_DENSITY_LEVEL, // index into DENSITY_LEVELS: level-of-detail thinning
  shipSize: 'medium', // arrow size on the map
  showLabels: true, // ship names next to arrows when zoomed in
  liveUpdates: true, // WebSocket push; off = refresh every 60 s only
  sidebarCollapsed: false, // rail hidden behind a small floating button
  view: null, // last map view { lat, lng, zoom }; null = world overview
  baseLayer: baseLayers[0].name,
  overlays: [], // names of active overlay layers
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const wrapLng = (lng) => (lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180)

/** Merges a stored settings document over the defaults, dropping anything invalid. */
export function sanitizeSettings(saved) {
  const s = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) }
  if (s.mode !== 'light' && s.mode !== 'dark') s.mode = defaults.mode
  for (const k of ['clustering', 'showLabels', 'liveUpdates', 'sidebarCollapsed']) {
    if (typeof s[k] !== 'boolean') s[k] = defaults[k]
  }
  if (!Number.isInteger(s.shipDensity) || s.shipDensity < 0 || s.shipDensity >= DENSITY_LEVELS.length) {
    s.shipDensity = DEFAULT_DENSITY_LEVEL
  }
  if (!SHIP_SIZES.includes(s.shipSize)) s.shipSize = defaults.shipSize
  const v = s.view
  s.view =
    v && [v.lat, v.lng, v.zoom].every(Number.isFinite)
      ? { lat: clamp(v.lat, -85, 85), lng: wrapLng(v.lng), zoom: clamp(v.zoom, 3, 18) }
      : null
  if (!baseLayers.some((l) => l.name === s.baseLayer)) s.baseLayer = defaults.baseLayer
  s.overlays = Array.isArray(s.overlays) ? s.overlays.filter((n) => overlayLayers.some((o) => o.name === n)) : []
  return s
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState: { ...defaults },
  reducers: {
    // Replaces everything with a saved document (sign-in / sign-out). Not echoed back to the server.
    hydrateSettings: (_state, action) => sanitizeSettings(action.payload),
    toggleTheme: (state) => {
      state.mode = state.mode === 'light' ? 'dark' : 'light'
    },
    toggleClustering: (state) => {
      state.clustering = !state.clustering
    },
    setShipDensity: (state, action) => {
      state.shipDensity = action.payload
    },
    setShipSize: (state, action) => {
      state.shipSize = action.payload
    },
    toggleLabels: (state) => {
      state.showLabels = !state.showLabels
    },
    toggleLiveUpdates: (state) => {
      state.liveUpdates = !state.liveUpdates
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed
    },
    setMapView: (state, action) => {
      const { lat, lng, zoom } = action.payload
      const r = (n) => Math.round(n * 1e5) / 1e5 // ~1 m; keeps the document small and stable
      state.view = { lat: r(clamp(lat, -85, 85)), lng: r(wrapLng(lng)), zoom }
    },
    setBaseLayer: (state, action) => {
      state.baseLayer = action.payload
    },
    toggleOverlay: (state, action) => {
      const name = action.payload
      state.overlays = state.overlays.includes(name)
        ? state.overlays.filter((n) => n !== name)
        : [...state.overlays, name]
    },
    // "Reset to defaults" in Settings: display options only; the user stays where they are on the map.
    resetSettings: (state) => ({ ...defaults, view: state.view, baseLayer: state.baseLayer, overlays: state.overlays }),
  },
})

export const {
  hydrateSettings,
  toggleTheme,
  toggleClustering,
  setShipDensity,
  setShipSize,
  toggleLabels,
  toggleLiveUpdates,
  toggleSidebar,
  setMapView,
  setBaseLayer,
  toggleOverlay,
  resetSettings,
} = themeSlice.actions
export default themeSlice.reducer
