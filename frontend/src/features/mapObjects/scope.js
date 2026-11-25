// Ownership scopes of map objects (mirrors backend/src/api/auth/scope.ts):
//   shared   – visible to everyone, changed by operators/admins
//   personal – visible to and changed by its owner only (the API returns only the caller's own)

export const isOperator = (user) => user?.role === 'operator' || user?.role === 'admin'

/** Can `user` change this map object (zone, pin, …)? */
export const canEdit = (feature, user) => feature?.properties.scope === 'personal' || isOperator(user)

/** Short label for where an object is visible. */
export function scopeLabel(feature) {
  const p = feature.properties
  if (p.scope === 'personal') return 'Only you'
  return p.preset ? 'Preset' : 'Shared'
}

export const SCOPE_OPTIONS = [
  { value: 'personal', label: 'Only me' },
  { value: 'shared', label: 'Everyone (shared)' },
]
