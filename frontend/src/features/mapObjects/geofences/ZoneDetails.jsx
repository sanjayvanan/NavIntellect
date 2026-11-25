/* eslint-disable react/prop-types -- feature components; the project does not use PropTypes */
import { useEffect, useState } from 'react'
import { CloseIcon } from '../../../components/Icons'
import { formatArea, formatNm } from '../../../utils/geo'
import { zonesApi } from '../api'
import { scopeLabel } from '../scope'
import { BellIcon, EditIcon, TargetIcon, TrashIcon } from '../ui/icons'
import { IconButton, Metric, Metrics } from '../ui/controls'
import { KIND_LABEL, zoneColor } from './zoneStyle'

const VESSEL_PREVIEW = 8

/** Vessels inside a zone right now ({ total, vessels } | null while loading). */
function useZoneVessels(zoneId) {
  const [state, setState] = useState(null)
  useEffect(() => {
    let live = true
    setState(null)
    zonesApi
      .vessels(zoneId, VESSEL_PREVIEW)
      .then((r) => live && setState(r))
      .catch(() => live && setState({ total: null, vessels: [] }))
    return () => {
      live = false
    }
  }, [zoneId])
  return state
}

/** Selected zone: facts, vessels inside right now, actions. */
export function ZoneDetails({ zone, editable, onEdit, onDelete, onZoom, onToggleAlerts, onClose }) {
  const p = zone.properties
  const vessels = useZoneVessels(zone.id)

  return (
    <div className="gf-details" style={{ '--zone': zoneColor(zone) }}>
      <div className="gf-details-head">
        <span className="gf-swatch" />
        <div>
          <strong>{p.name}</strong>
          <small>
            {KIND_LABEL[p.kind]} · {scopeLabel(zone)}
          </small>
        </div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
          <CloseIcon size={14} />
        </button>
      </div>
      {p.description && <p className="gf-desc">{p.description}</p>}
      <Metrics compact>
        <Metric label="Area" value={formatArea(Number(p.area_nm2))} strong />
        <Metric label="Perimeter" value={formatNm(Number(p.perimeter_nm))} />
        <Metric label="Vessels now" value={vessels ? (vessels.total ?? '–').toLocaleString() : '…'} strong />
      </Metrics>
      {vessels?.vessels?.length > 0 && (
        <ul className="gf-vessels">
          {vessels.vessels.map((v) => (
            <li key={v.mmsi}>
              <span>{v.name || `MMSI ${v.mmsi}`}</span>
              <small>{v.sog != null ? `${v.sog} kn` : ''}</small>
            </li>
          ))}
        </ul>
      )}
      <div className="gf-actions">
        <button type="button" className="gf-btn ghost" onClick={onZoom}>
          <TargetIcon /> Zoom to
        </button>
        {editable && (
          <>
            <button type="button" className={`gf-btn ghost ${p.active ? 'live' : ''}`} onClick={onToggleAlerts} title="Alerts for this zone">
              <BellIcon on={p.active} /> {p.active ? 'Alerts on' : 'Alerts off'}
            </button>
            <span className="gf-spacer" />
            <IconButton label="Edit" onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton label="Delete" onClick={onDelete} danger>
              <TrashIcon />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}
