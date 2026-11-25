/* eslint-disable react/prop-types -- presentational components; the project does not use PropTypes */
import { EditIcon, EyeIcon, TargetIcon, TrashIcon } from './icons'
import { IconButton } from './controls'

/** Small labelled chip saying what an object is (Point, Polygon, Rectangle, Circle). */
export function TypeChip({ type }) {
  const Icon = type.Icon
  return (
    <span className={`gf-type-chip t-${type.id}`}>
      <Icon size={12} />
      {type.label}
    </span>
  )
}

/**
 * One row of a map-object list (zone, pin, …).
 *   type   – entry of OBJECT_TYPES (what the object is); facts – short figures for it
 *   tile   – optional React node replacing the default type tile (e.g. the pin's own glyph)
 */
export function ObjectRow({ color, type, facts = [], tile, title, badge, live, hidden, selected, editable, onSelect, onToggleHidden, onZoom, onEdit, onDelete }) {
  const Icon = type.Icon
  return (
    <li className={`gf-zone ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`} style={{ '--zone': color }}>
      <button type="button" className="gf-zone-main" onClick={onSelect} aria-label={`${type.label}: ${title}`}>
        {tile ?? (
          <span className="gf-type-tile" aria-hidden="true">
            <Icon size={16} />
          </span>
        )}
        <span className="gf-zone-text">
          <span className="gf-zone-name">
            <span className="gf-zone-title">{title}</span>
            {badge && <em>{badge}</em>}
            {live && <b className="gf-live" title="Alerts on" />}
          </span>
          <span className="gf-zone-facts">
            <TypeChip type={type} />
            {facts.length > 0 && <small>{facts.join(' · ')}</small>}
          </span>
        </span>
      </button>
      <div className="gf-zone-actions">
        <IconButton label={hidden ? 'Show on map' : 'Hide from map'} onClick={onToggleHidden}>
          <EyeIcon off={hidden} />
        </IconButton>
        <IconButton label="Zoom to" onClick={onZoom}>
          <TargetIcon />
        </IconButton>
        {editable && (
          <>
            <IconButton label="Edit" onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton label="Delete" onClick={onDelete} danger>
              <TrashIcon />
            </IconButton>
          </>
        )}
      </div>
    </li>
  )
}
