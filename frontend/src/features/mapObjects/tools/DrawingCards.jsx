/* eslint-disable react/prop-types -- presentational components; the project does not use PropTypes */
import { formatNm } from '../../../utils/geo'
import { Metric, Metrics } from '../ui/controls'

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
