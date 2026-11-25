/* eslint-disable react/prop-types -- small presentational components; the project does not use PropTypes */
// Building blocks shared by every map-object form, card and list.

/** Label + value tile; `strong` highlights the main figure. */
export function Metric({ label, value, strong }) {
  return (
    <div className={`gf-metric ${strong ? 'strong' : ''}`}>
      <small>{label}</small>
      <span>{value}</span>
    </div>
  )
}

export function Metrics({ compact, children }) {
  return <div className={`gf-metrics ${compact ? 'compact' : ''}`}>{children}</div>
}

/** Switch with a label and optional hint. */
export function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={`gf-toggle ${disabled ? 'disabled' : ''}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <i aria-hidden="true" />
    </label>
  )
}

/** Labelled form field wrapper. */
export function Field({ label, children }) {
  return (
    <label className="gf-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function ColorSwatches({ colors, value, onChange }) {
  return (
    <div className="gf-swatches" role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={value === c ? 'on' : ''}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
        />
      ))}
    </div>
  )
}

export function IconButton({ label, onClick, danger, children }) {
  return (
    <button type="button" className={`gf-icon ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  )
}

/** Inline "are you sure" card. */
export function ConfirmBox({ message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div className="gf-confirm" role="alertdialog">
      <p>{message}</p>
      <div className="gf-actions">
        <span className="gf-spacer" />
        <button type="button" className="gf-btn ghost" onClick={onCancel}>
          Keep
        </button>
        <button type="button" className="gf-btn danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

export function ErrorNote({ children }) {
  return children ? <p className="gf-error">{children}</p> : null
}
