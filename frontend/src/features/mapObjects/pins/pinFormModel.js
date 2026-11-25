// Pin form state <-> API body conversions (pure, unit-tested).
import { DEFAULT_PIN_STYLE } from './pinStyle'

/** Form state for a new pin. */
export const newPinForm = () => ({ name: '', description: '', scope: 'personal', ...DEFAULT_PIN_STYLE })

export const pinFormFrom = (pin) => {
  const p = pin.properties
  return { name: p.name, description: p.description || '', scope: p.scope, color: p.style?.color || DEFAULT_PIN_STYLE.color, icon: p.style?.icon || 'pin' }
}

/** Form state -> API fields. */
export const pinBodyFrom = (f) => ({
  name: f.name.trim(),
  description: f.description.trim() || null,
  style: { color: f.color, icon: f.icon },
  scope: f.scope,
})
