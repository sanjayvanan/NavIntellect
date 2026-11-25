/* eslint-disable react/prop-types -- presentational components; the project does not use PropTypes */
import { EditIcon, EyeIcon, TargetIcon, TrashIcon } from './icons'
import { IconButton } from './controls'

/**
 * One row of a map-object list (zone, pin, …).
 * `swatch` is a CSS colour or a React node (e.g. a pin glyph); actions show on hover/selection.
 */
export function ObjectRow({ color, swatch, title, badge, live, subtitle, hidden, selected, editable, onSelect, onToggleHidden, onZoom, onEdit, onDelete }) {
  return (
    <li className={`gf-zone ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`} style={{ '--zone': color }}>
      <button type="button" className="gf-zone-main" onClick={onSelect}>
        {swatch ?? <span className="gf-swatch" />}
        <span className="gf-zone-text">
          <span className="gf-zone-name">
            <span className="gf-zone-title">{title}</span>
            {badge && <em>{badge}</em>}
            {live && <b className="gf-live" title="Alerts on" />}
          </span>
          {subtitle && <small>{subtitle}</small>}
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

/** Titled list with a count and "Hide all / Show all". `rows` are ObjectRow props (with `key`). */
export function ObjectSection({ title, rows, empty, onSetAllHidden }) {
  const allHidden = rows.length > 0 && rows.every((r) => r.hidden)
  return (
    <section className="gf-section">
      <div className="gf-section-head">
        <h4>
          {title} <span>{rows.length}</span>
        </h4>
        {rows.length > 0 && (
          <button type="button" className="gf-link" onClick={() => onSetAllHidden(!allHidden)}>
            {allHidden ? 'Show all' : 'Hide all'}
          </button>
        )}
      </div>
      {rows.length ? (
        <ul className="gf-list">
          {rows.map(({ key, ...row }) => (
            <ObjectRow key={key} {...row} />
          ))}
        </ul>
      ) : (
        <p className="gf-empty">{empty}</p>
      )}
    </section>
  )
}
