import { coordsForClipboard } from '../../utils/coords'
import { issueCommand } from './uiSlice'

// Map right-click entries contributed by the map-objects feature.
// The panel carries out the commands (it opens automatically, see Sidebar).

const svg = (paths) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export const mapObjectMenuItems = (dispatch) => [
  {
    id: 'drop-pin',
    label: 'Drop pin here',
    icon: svg('<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
    onSelect: (latlng) => dispatch(issueCommand({ kind: 'dropPin', latlng: { lat: latlng.lat, lng: latlng.lng } })),
  },
  {
    id: 'measure-from',
    label: 'Measure from here',
    icon: svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'),
    onSelect: (latlng) => dispatch(issueCommand({ kind: 'measureFrom', latlng: { lat: latlng.lat, lng: latlng.lng } })),
  },
  {
    id: 'copy-coords',
    label: 'Copy coordinates',
    icon: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
    onSelect: (latlng) => navigator.clipboard?.writeText(coordsForClipboard(latlng)).catch(() => {}),
  },
]
