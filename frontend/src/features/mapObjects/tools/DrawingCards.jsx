/* eslint-disable react/prop-types -- presentational components; the project does not use PropTypes */
import { formatArea, formatBearing, formatNm } from '../../../utils/geo'
import { Metric, Metrics } from '../ui/controls'
import { isMultiPointTool, minPoints } from './registry'

/** Live numbers for the active drawing (mirrors the tooltip at the cursor). */
export function Readout({ r }) {
  if (!r) return null
  if (r.mode === 'circle')
    return (
      <Metrics>
        <Metric label="Radius" value={formatNm(r.radiusNm)} strong />
        <Metric label="Area" value={formatArea(r.areaNm2)} />
        <Metric label="Circumference" value={formatNm(r.perimeterNm)} />
      </Metrics>
    )
  if (r.mode === 'rectangle')
    return (
      <Metrics>
        <Metric label="Width" value={formatNm(r.widthNm)} strong />
        <Metric label="Height" value={formatNm(r.heightNm)} strong />
        <Metric label="Area" value={formatArea(r.areaNm2)} />
      </Metrics>
    )
  return (
    <Metrics>
      <Metric label="Current leg" value={r.legNm != null ? formatNm(r.legNm) : '–'} strong />
      <Metric label="Bearing" value={r.bearing != null ? formatBearing(r.bearing) : '–'} />
      <Metric label={r.mode === 'ruler' ? 'Total' : 'Path'} value={formatNm(r.totalNm)} />
      {r.mode === 'polygon' && <Metric label="Area" value={r.areaNm2 ? formatArea(r.areaNm2) : '–'} />}
      <Metric label="Points" value={r.vertices} />
    </Metrics>
  )
}

/** Card shown while a tool is active: hint, live readout, Undo / Cancel / Finish. */
export function ActiveToolCard({ tool, title, readout, onUndo, onCancel, onFinish }) {
  const multi = isMultiPointTool(tool)
  const vertices = readout?.vertices ?? 0
  return (
    <div className="gf-live-card">
      <div className="gf-live-head">
        <span className="gf-pulse" />
        {title}
      </div>
      <p className="gf-hint">{tool.hint}</p>
      <Readout r={readout} />
      <div className="gf-actions">
        {multi && (
          <button type="button" className="gf-btn ghost" onClick={onUndo} disabled={!vertices}>
            Undo <kbd>⌫</kbd>
          </button>
        )}
        <span className="gf-spacer" />
        <button type="button" className="gf-btn ghost" onClick={onCancel}>
          Cancel <kbd>Esc</kbd>
        </button>
        {multi && (
          <button type="button" className="gf-btn primary" onClick={onFinish} disabled={vertices < minPoints(tool)}>
            Finish
          </button>
        )}
      </div>
    </div>
  )
}

/** Result of the Measure tool (kept on the map until cleared). */
export function RulerResultCard({ readout, onClear, onAgain }) {
  return (
    <div className="gf-live-card">
      <div className="gf-live-head">Measured route</div>
      <Metrics compact>
        <Metric label="Total distance" value={formatNm(readout.totalNm)} strong />
        <Metric label="Legs" value={Math.max(0, readout.vertices - 1)} />
      </Metrics>
      <div className="gf-actions">
        <span className="gf-spacer" />
        <button type="button" className="gf-btn ghost" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="gf-btn primary" onClick={onAgain}>
          Measure again
        </button>
      </div>
    </div>
  )
}
