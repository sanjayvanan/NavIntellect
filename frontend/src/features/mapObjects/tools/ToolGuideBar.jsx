/* eslint-disable react/prop-types -- feature component; the project does not use PropTypes */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import { formatArea, formatBearing, formatNm } from '../../../utils/geo'
import { actionOfTool, isMultiPointTool, minPoints, stepHint, toolById } from './registry'

/** Live figures for the active drawing, as compact chips. */
function LiveChips({ r }) {
  if (!r) return null
  const chips = []
  if (r.mode === 'circle' && r.radiusNm != null) {
    chips.push(['Radius', formatNm(r.radiusNm), true], ['Area', formatArea(r.areaNm2)])
  } else if (r.mode === 'rectangle' && r.widthNm != null) {
    chips.push(['Size', `${formatNm(r.widthNm)} × ${formatNm(r.heightNm)}`, true], ['Area', formatArea(r.areaNm2)])
  } else if (r.mode === 'polygon' || r.mode === 'ruler') {
    if (r.legNm != null) chips.push(['Leg', `${formatNm(r.legNm)} · ${formatBearing(r.bearing)}`, true])
    if (r.vertices >= 2) chips.push([r.mode === 'ruler' ? 'Total' : 'Path', formatNm(r.totalNm)])
    if (r.mode === 'polygon' && r.areaNm2) chips.push(['Area', formatArea(r.areaNm2)])
  }
  if (!chips.length) return null
  return (
    <div className="tg-chips">
      {chips.map(([label, value, strong]) => (
        <span key={label} className={`tg-chip ${strong ? 'strong' : ''}`}>
          <small>{label}</small>
          {value}
        </span>
      ))}
    </div>
  )
}

/**
 * Step-by-step guide shown on the map (top centre) while a tool is active: what to do next,
 * live measurements, a shape picker for zones, and Undo / Finish / Cancel.
 * Rendered into the map container so it sits where the user is looking.
 */
export function ToolGuideBar({ container, toolId, readout, onSwitchTool, onUndo, onFinish, onCancel }) {
  const ref = useRef(null)
  const tool = toolById(toolId)
  const action = actionOfTool(toolId)

  // Clicks and wheel on the bar must not reach the map (they would place points).
  useEffect(() => {
    if (!ref.current) return
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [toolId])

  if (!tool || !container) return null
  const multi = isMultiPointTool(tool)
  const vertices = readout?.vertices ?? 0
  const ActionIcon = action.Icon

  return createPortal(
    <div ref={ref} className="tool-guide" role="status" aria-live="polite">
      <div className="tg-head">
        <span className="tg-icon">
          <ActionIcon size={18} />
        </span>
        <strong>{action.title}</strong>
        {action.tools.length > 1 && (
          <div className="tg-shapes" role="radiogroup" aria-label="Shape">
            {action.tools.map((id) => {
              const t = toolById(id)
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  data-guide={`draw.${id}`}
                  aria-checked={id === toolId}
                  className={id === toolId ? 'on' : ''}
                  onClick={() => id !== toolId && onSwitchTool(id)}
                  title={t.label}
                >
                  <t.Icon size={15} />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        )}
        <button type="button" className="tg-close" onClick={onCancel} aria-label="Cancel (Esc)" title="Cancel (Esc)">
          ×
        </button>
      </div>
      <p className="tg-step">{stepHint(tool, readout)}</p>
      <LiveChips r={readout} />
      {multi && (
        <div className="tg-actions">
          <button type="button" className="tg-btn" onClick={onUndo} disabled={!vertices}>
            Undo <kbd>⌫</kbd>
          </button>
          <button type="button" className="tg-btn primary" data-guide="draw.finish" onClick={onFinish} disabled={vertices < minPoints(tool)}>
            Finish <kbd>↵</kbd>
          </button>
        </div>
      )}
    </div>,
    container,
  )
}
