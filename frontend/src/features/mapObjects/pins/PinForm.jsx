/* eslint-disable react/prop-types -- feature components; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { SCOPE_OPTIONS } from '../scope'
import { ColorSwatches, ErrorNote, Field } from '../ui/controls'
import { GLYPHS, PIN_COLORS, PIN_ICON_LABELS, PIN_ICONS } from './pinStyle'
import { pinBodyFrom } from './pinFormModel'
import { Coordinates, PinGlyph } from './PinParts'

/** Icon picker: one button per glyph, drawn in the chosen colour. */
function IconPicker({ value, color, onChange }) {
  return (
    <div className="gf-icon-picker" role="radiogroup" aria-label="Icon">
      {PIN_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={value === icon}
          className={value === icon ? 'on' : ''}
          onClick={() => onChange(icon)}
          title={PIN_ICON_LABELS[icon]}
          aria-label={PIN_ICON_LABELS[icon]}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" color={color} dangerouslySetInnerHTML={{ __html: GLYPHS[icon] }} />
        </button>
      ))}
    </div>
  )
}

/** Create / edit a pin. `latlng` is where it is (or will be) placed. */
export function PinForm({ initial, latlng, isNew, canShare, saving, error, onSave, onCancel }) {
  const [f, setF] = useState(initial)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const nameRef = useRef(null)
  useEffect(() => nameRef.current?.focus(), [])

  const submit = (e) => {
    e.preventDefault()
    onSave(pinBodyFrom(f))
  }

  return (
    <form className="gf-form" onSubmit={submit}>
      <div className="gf-form-title">
        <PinGlyph style={f} size={18} />
        {isNew ? 'New pin' : 'Edit pin'}
      </div>
      <Coordinates latlng={latlng} />
      <Field label="Name">
        <input ref={nameRef} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required placeholder="e.g. Fairway buoy" />
      </Field>
      <div className="gf-field">
        <span>Icon</span>
        <IconPicker value={f.icon} color={f.color} onChange={(icon) => set('icon', icon)} />
      </div>
      <div className="gf-field">
        <span>Colour</span>
        <ColorSwatches colors={PIN_COLORS} value={f.color} onChange={(c) => set('color', c)} />
      </div>
      {isNew && (
        <Field label="Visible to">
          <select value={f.scope} onChange={(e) => set('scope', e.target.value)} disabled={!canShare}>
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Notes">
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} rows={2} placeholder="Optional" />
      </Field>
      {!isNew && <p className="gf-hint">Drag the pin on the map to move it.</p>}
      <ErrorNote>{error}</ErrorNote>
      <div className="gf-actions">
        <span className="gf-spacer" />
        <button type="button" className="gf-btn ghost" onClick={onCancel}>
          {isNew ? 'Discard' : 'Cancel'}
        </button>
        <button type="submit" className="gf-btn primary" disabled={saving || !f.name.trim()}>
          {saving ? 'Saving…' : 'Save pin'}
        </button>
      </div>
    </form>
  )
}

