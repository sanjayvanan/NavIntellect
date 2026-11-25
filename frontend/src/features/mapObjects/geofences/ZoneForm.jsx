/* eslint-disable react/prop-types -- feature components; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { formatArea, formatNm } from '../../../utils/geo'
import { SCOPE_OPTIONS } from '../scope'
import { ColorSwatches, ErrorNote, Field, Metric, Metrics, Toggle } from '../ui/controls'
import { ZONE_COLORS, ZONE_KINDS } from './zoneStyle'
import { zoneBodyFrom } from './zoneFormModel'

/** Create / edit a zone: name, type, colour, visibility, notes, alert rules. */
export function ZoneForm({ initial, isNew, canShare, measures, saving, error, onSave, onCancel, onRedraw }) {
  const [f, setF] = useState(initial)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const setRule = (k, v) => setF((x) => ({ ...x, rules: { ...x.rules, [k]: v } }))
  const flipRule = (k) => setRule(k, f.rules[k] === false)
  const nameRef = useRef(null)
  useEffect(() => nameRef.current?.focus(), [])

  const submit = (e) => {
    e.preventDefault()
    onSave(zoneBodyFrom(f))
  }

  return (
    <form className="gf-form" onSubmit={submit}>
      <div className="gf-form-title">{isNew ? 'Save this shape' : 'Edit zone'}</div>
      {measures && (
        <Metrics compact>
          <Metric label="Area" value={formatArea(measures.areaNm2)} strong />
          <Metric label="Perimeter" value={formatNm(measures.perimeterNm)} />
          {measures.radiusNm != null && <Metric label="Radius" value={formatNm(measures.radiusNm)} />}
        </Metrics>
      )}
      <Field label="Name">
        <input ref={nameRef} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required placeholder="e.g. Harbour approach" />
      </Field>
      <div className="gf-row">
        <Field label="Type">
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {ZONE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
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
      </div>
      <div className="gf-field">
        <span>Colour</span>
        <ColorSwatches colors={ZONE_COLORS} value={f.color} onChange={(c) => set('color', c)} />
      </div>
      <Field label="Notes">
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={2} placeholder="Optional" />
      </Field>

      <Toggle
        label="Alerts for this zone"
        hint="Raise alerts when vessels enter, leave, speed or loiter here"
        checked={f.active}
        onChange={() => set('active', !f.active)}
      />
      {f.active && (
        <div className="gf-rules">
          <Toggle label="Vessel enters" checked={f.rules.alert_on_enter !== false} onChange={() => flipRule('alert_on_enter')} />
          <Toggle label="Vessel leaves" checked={f.rules.alert_on_exit !== false} onChange={() => flipRule('alert_on_exit')} />
          <Toggle label="AIS signal lost inside" checked={f.rules.alert_on_gap !== false} onChange={() => flipRule('alert_on_gap')} />
          <div className="gf-row">
            <Field label="Speed limit (kn)">
              <input type="number" min="0" max="102" step="0.5" value={f.rules.max_speed ?? ''} onChange={(e) => setRule('max_speed', e.target.value)} placeholder="None" />
            </Field>
            <Field label="Loitering after (min)">
              <input type="number" min="0" max="10080" step="5" value={f.rules.loiter_minutes ?? ''} onChange={(e) => setRule('loiter_minutes', e.target.value)} placeholder="None" />
            </Field>
          </div>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      <div className="gf-actions">
        {onRedraw && (
          <button type="button" className="gf-btn ghost" onClick={onRedraw}>
            Redraw shape
          </button>
        )}
        <span className="gf-spacer" />
        <button type="button" className="gf-btn ghost" onClick={onCancel}>
          {isNew ? 'Discard' : 'Cancel'}
        </button>
        <button type="submit" className="gf-btn primary" disabled={saving || !f.name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
