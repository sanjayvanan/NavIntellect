import { CircleIcon, PinIcon, PolygonIcon, RectIcon, RulerIcon } from '../ui/icons'

/**
 * Toolbar tools of the map-objects panel. Adding a tool = one entry here plus handling its
 * `type` in MapObjectsPanel:
 *  - 'shape':   drawn with DrawTool, saved as a zone
 *  - 'measure': drawn with DrawTool, shown but not saved
 *  - 'pin':     placed with PinDropTool, saved as a pin annotation
 * `mode` is the DrawTool mode for shape/measure tools.
 */
export const TOOLS = [
  {
    id: 'polygon',
    type: 'shape',
    mode: 'polygon',
    label: 'Polygon',
    Icon: PolygonIcon,
    hint: 'Click to add points. Click the first point, double-click or press Enter to finish.',
  },
  { id: 'rectangle', type: 'shape', mode: 'rectangle', label: 'Rectangle', Icon: RectIcon, hint: 'Click one corner, then the opposite corner.' },
  { id: 'circle', type: 'shape', mode: 'circle', label: 'Circle', Icon: CircleIcon, hint: 'Click the centre, then click to set the radius.' },
  {
    id: 'ruler',
    type: 'measure',
    mode: 'ruler',
    label: 'Measure',
    Icon: RulerIcon,
    hint: 'Click along the route. Double-click or press Enter to finish.',
  },
  { id: 'pin', type: 'pin', label: 'Pin', Icon: PinIcon, hint: 'Click on the map to drop a pin. Esc cancels.' },
]

export const toolById = (id) => TOOLS.find((t) => t.id === id) || null

/** Tools whose drawing can be undone vertex by vertex / finished explicitly. */
export const isMultiPointTool = (tool) => tool?.mode === 'polygon' || tool?.mode === 'ruler'
export const minPoints = (tool) => (tool?.mode === 'polygon' ? 3 : 2)
