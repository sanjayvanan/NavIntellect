// Zone form state <-> API body conversions (pure, unit-tested).
import { KIND_COLORS, ZONE_COLORS } from './zoneStyle'

/** Form state for a new zone. */
export const newZoneForm = () => ({
  name: '',
  kind: 'monitoring',
  color: ZONE_COLORS[0],
  description: '',
  scope: 'personal',
  active: false,
  rules: {},
})

/** Form state from an existing zone feature. */
export const zoneFormFrom = (zone) => {
  const p = zone.properties
  return {
    name: p.name,
    kind: p.kind,
    color: p.color || KIND_COLORS[p.kind],
    description: p.description || '',
    scope: p.scope,
    active: p.active,
    rules: { ...p.rules },
  }
}

/** Form state -> API body (rules only carry non-default values). */
export function zoneBodyFrom(f) {
  const rules = {}
  for (const k of ['alert_on_enter', 'alert_on_exit', 'alert_on_gap']) if (f.rules[k] === false) rules[k] = false
  if (Number(f.rules.max_speed) > 0) rules.max_speed = Number(f.rules.max_speed)
  if (Number(f.rules.loiter_minutes) > 0) rules.loiter_minutes = Math.round(Number(f.rules.loiter_minutes))
  return { name: f.name.trim(), kind: f.kind, color: f.color, description: f.description.trim() || null, scope: f.scope, active: f.active, rules }
}
