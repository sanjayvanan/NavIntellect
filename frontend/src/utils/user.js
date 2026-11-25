/** Name to show for a user: their display name, else the part of the email before @. */
export const displayName = (user) => user?.name?.trim() || user?.email?.split('@')[0] || 'Account'

/** One or two letters for the avatar. */
export function initials(user) {
  const name = displayName(user)
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}
