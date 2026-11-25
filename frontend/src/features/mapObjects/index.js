// Public surface of the map-objects feature (zones, pins, drawing tools). Import from here only.
import zonesReducer from './geofences/zonesSlice'
import pinsReducer from './pins/pinsSlice'
import mapObjectsUiReducer from './uiSlice'

export { default as MapObjectsPanel } from './MapObjectsPanel'
export { default as MapObjectsLayers } from './MapObjectsLayers'
export { selectObject, issueCommand } from './uiSlice'

/** Reducers to mount in the store, keyed by their state slice name. */
export const mapObjectsReducers = { zones: zonesReducer, pins: pinsReducer, mapObjectsUi: mapObjectsUiReducer }
