/* eslint-disable react/prop-types -- feature components; the project does not use PropTypes */
import { useState } from 'react'
import { CloseIcon } from '../../../components/Icons'
import { coordsForClipboard } from '../../../utils/coords'
import { scopeLabel } from '../scope'
import { CopyIcon, EditIcon, TargetIcon, TrashIcon } from '../ui/icons'
import { IconButton } from '../ui/controls'
import { Coordinates, PinGlyph } from './PinParts'
import { PIN_ICON_LABELS, pinLatLng } from './pinStyle'
import { OBJECT_TYPES } from '../objectTypes'
import { TypeChip } from '../ui/ObjectList'

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Selected pin: where it is, notes, actions. */
export function PinDetails({ pin, editable, onEdit, onDelete, onZoom, onClose }) {
  const p = pin.properties
  const latlng = pinLatLng(pin)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coordsForClipboard(latlng))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked (permissions / insecure context): nothing else to do
    }
  }

  return (
    <div className="gf-details" style={{ '--zone': p.style?.color }}>
      <div className="gf-details-head">
        <span className="gf-type-tile big pin" aria-hidden="true">
          <PinGlyph style={p.style} size={20} />
        </span>
        <div>
          <strong>{p.name}</strong>
          <span className="gf-details-sub">
            <TypeChip type={OBJECT_TYPES.point} />
            <small>
              {PIN_ICON_LABELS[p.style?.icon] || 'Pin'} · {scopeLabel(pin)}
            </small>
          </span>
        </div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
          <CloseIcon size={14} />
        </button>
      </div>
      <Coordinates latlng={latlng} />
      {p.description && <p className="gf-desc">{p.description}</p>}
      <p className="gf-meta">Dropped {dateFmt.format(new Date(p.created_at))}</p>
      <div className="gf-actions">
        <button type="button" className="gf-btn ghost" onClick={onZoom}>
          <TargetIcon /> Zoom to
        </button>
        <button type="button" className="gf-btn ghost" onClick={copy}>
          <CopyIcon /> {copied ? 'Copied' : 'Copy'}
        </button>
        {editable && (
          <>
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
