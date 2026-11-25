import { CircleIcon, PinIcon, PolygonIcon, RectIcon, RulerIcon, ZoneIcon } from '../ui/icons'

/**
 * Interactive tools. Adding a tool = one entry here plus handling its `type` in MapObjectsPanel:
 *  - 'shape':   drawn with DrawTool, saved as a zone
 *  - 'measure': drawn with DrawTool, shown but not saved
 *  - 'pin':     placed with PinDropTool, saved as a pin annotation
 * `mode` is the DrawTool mode for shape/measure tools; `action` groups tools under one button.
 */
export const TOOLS = [
  { id: 'pin', action: 'pin', type: 'pin', label: 'Pin', Icon: PinIcon },
  { id: 'polygon', action: 'zone', type: 'shape', mode: 'polygon', label: 'Polygon', Icon: PolygonIcon },
  { id: 'rectangle', action: 'zone', type: 'shape', mode: 'rectangle', label: 'Rectangle', Icon: RectIcon },
  { id: 'circle', action: 'zone', type: 'shape', mode: 'circle', label: 'Circle', Icon: CircleIcon },
  { id: 'ruler', action: 'measure', type: 'measure', mode: 'ruler', label: 'Measure', Icon: RulerIcon },
]

/**
 * The three things a user can do, as shown in the panel. `tools` lists the tools of an action
 * (the first is the default; more than one shows a picker in the on-map guide bar).
 */
export const ACTIONS = [
  { id: 'pin', label: 'Drop pin', caption: 'Mark a spot', title: 'Drop a pin', Icon: PinIcon, tools: ['pin'] },
  { id: 'zone', label: 'Draw zone', caption: 'Geofence an area', title: 'Draw a zone', Icon: ZoneIcon, tools: ['polygon', 'rectangle', 'circle'] },
  { id: 'measure', label: 'Measure', caption: 'Distance & bearing', title: 'Measure a route', Icon: RulerIcon, tools: ['ruler'] },
]

export const toolById = (id) => TOOLS.find((t) => t.id === id) || null
export const actionById = (id) => ACTIONS.find((a) => a.id === id) || null
export const actionOfTool = (toolId) => actionById(toolById(toolId)?.action)

/** Tools whose drawing can be undone vertex by vertex / finished explicitly. */
export const isMultiPointTool = (tool) => tool?.mode === 'polygon' || tool?.mode === 'ruler'
export const minPoints = (tool) => (tool?.mode === 'polygon' ? 3 : 2)

/** The next thing to do, given the tool and how far the drawing is (readout.vertices). */
export function stepHint(tool, readout) {
  const n = readout?.vertices ?? 0
  switch (tool?.mode ?? tool?.type) {
    case 'pin':
      return 'Click on the map where the pin should go'
    case 'polygon':
      if (n === 0) return 'Click on the map to place the first corner'
      if (n < 3) return `Click to add corner ${n + 1}`
      return 'Keep clicking to add corners · double-click, Enter or click the first corner to finish'
    case 'rectangle':
      return n === 0 ? 'Click one corner of the rectangle' : 'Click the opposite corner'
    case 'circle':
      return n === 0 ? 'Click the centre of the circle' : 'Move out and click to set the radius'
    case 'ruler':
      if (n === 0) return 'Click the start point'
      if (n === 1) return 'Click the next point of the route'
      return 'Keep clicking to add legs · double-click or Enter to finish'
    default:
      return ''
  }
}
