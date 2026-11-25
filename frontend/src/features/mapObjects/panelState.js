/**
 * UI state machine of the map-objects panel.
 *
 *   tool    – id of the active tool (see tools/registry.js) or null
 *   readout – live measurements of the active drawing
 *   view    – what the card area shows:
 *       { kind: 'none' }
 *       { kind: 'ruler', readout }                         finished measurement
 *       { kind: 'zoneDraft', geometry, measures }          new shape awaiting save
 *       { kind: 'zoneEdit', zoneId, redraw }               editing; redraw = { geometry, measures } | null
 *       { kind: 'pinDraft', latlng }                       new pin awaiting save
 *       { kind: 'pinEdit', pinId }
 *   confirm – { type: 'zone' | 'pin', feature } awaiting delete confirmation
 *   saving, error
 */
export const initialPanelState = { tool: null, readout: null, view: { kind: 'none' }, confirm: null, saving: false, error: null }

export function panelReducer(state, action) {
  switch (action.type) {
    case 'toolStarted':
      return { ...state, tool: action.tool, readout: null, error: null, view: action.keepView ? state.view : { kind: 'none' } }
    case 'readout':
      return { ...state, readout: action.readout }
    case 'toolEnded':
      return { ...state, tool: null, readout: null }
    case 'show':
      return { ...state, tool: null, readout: null, view: action.view, error: null }
    case 'redrawn':
      return state.view.kind === 'zoneEdit' ? { ...state, tool: null, readout: null, view: { ...state.view, redraw: action.redraw } } : state
    case 'movePinDraft':
      return state.view.kind === 'pinDraft' ? { ...state, view: { ...state.view, latlng: action.latlng } } : state
    case 'close':
      return { ...state, view: { kind: 'none' }, error: null, saving: false }
    case 'saving':
      return { ...state, saving: true, error: null }
    case 'saved':
      return { ...state, saving: false, view: { kind: 'none' } }
    case 'failed':
      return { ...state, saving: false, error: action.error }
    case 'error':
      return { ...state, error: action.error }
    case 'confirm':
      return { ...state, confirm: action.confirm }
    default:
      return state
  }
}
