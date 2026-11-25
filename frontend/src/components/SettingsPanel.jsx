/* eslint-disable react/prop-types -- small internal components; the project does not use PropTypes */
import { useEffect, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import L from 'leaflet'
import { DENSITY_LEVELS } from '../config/shipDensity'
import { CloseIcon } from './Icons'
import { FULL_DETAIL_ZOOM } from '../store/shipSlice'
import {
  SHIP_SIZES,
  resetSettings,
  setShipDensity,
  setShipSize,
  toggleClustering,
  toggleLabels,
  toggleLiveUpdates,
  toggleTheme,
} from '../store/themeSlice'

const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' }

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="setting-toggle">
      <span className="setting-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

/** Map & display settings (sidebar ⚙️). All values persist in localStorage (themeSlice). */
function SettingsPanel({ style, onClose }) {
  const dispatch = useDispatch()
  const settings = useSelector((state) => state.theme)
  const shipCount = useSelector((state) => state.ships.data.length)
  const ref = useRef(null)

  // The panel lives inside the map container: keep clicks, drags and wheel from moving the map.
  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [])

  const level = DENSITY_LEVELS[settings.shipDensity]
  const theme = settings.mode

  return (
    <div ref={ref} className={`layer-control-panel settings-panel ${theme}`} style={style}>
      <div className="panel-header">
        <span>Settings</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="settings-section">
        <h4>Ships</h4>

        <div className="setting-block">
          <div className="setting-text">
            <span>Ship density</span>
            <small>
              {level.label} · {level.hint}
            </small>
          </div>
          <input
            type="range"
            className="density-slider"
            min={0}
            max={DENSITY_LEVELS.length - 1}
            step={1}
            value={settings.shipDensity}
            onChange={(e) => dispatch(setShipDensity(Number(e.target.value)))}
            aria-label="Ship density"
          />
          <div className="density-scale">
            <span>Fewer</span>
            <span>More</span>
          </div>
          <small className="setting-note">
            {level.density == null
              ? 'No thinning: every ship in view is loaded.'
              : `Zoomed out, one ship per area keeps the map fast. From zoom ${FULL_DETAIL_ZOOM} every ship is shown.`}
          </small>
        </div>

        <Toggle
          label="Cluster ships"
          hint="Group nearby ships into count bubbles"
          checked={settings.clustering}
          onChange={() => dispatch(toggleClustering())}
        />

        <div className="setting-block">
          <div className="setting-text">
            <span>Ship icon size</span>
          </div>
          <div className="segmented">
            {SHIP_SIZES.map((size) => (
              <button
                key={size}
                className={settings.shipSize === size ? 'active' : ''}
                onClick={() => dispatch(setShipSize(size))}
              >
                {SIZE_LABELS[size]}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          label="Ship names"
          hint="Labels next to ships when zoomed in"
          checked={settings.showLabels}
          onChange={() => dispatch(toggleLabels())}
        />
      </div>

      <div className="settings-section">
        <h4>Data</h4>
        <Toggle
          label="Live updates"
          hint={settings.liveUpdates ? 'Positions stream in real time' : 'Refreshes every 60 s'}
          checked={settings.liveUpdates}
          onChange={() => dispatch(toggleLiveUpdates())}
        />
      </div>

      <div className="settings-section">
        <h4>Appearance</h4>
        <Toggle label="Dark mode" checked={theme === 'dark'} onChange={() => dispatch(toggleTheme())} />
      </div>

      <div className="settings-footer">
        <span>{shipCount.toLocaleString()} ships on the map</span>
        <button className="link-button" onClick={() => dispatch(resetSettings())}>
          Reset
        </button>
      </div>
    </div>
  )
}

export default SettingsPanel
