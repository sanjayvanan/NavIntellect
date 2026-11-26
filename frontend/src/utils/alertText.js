/** Wording and look of a zone alert, shared by the Notifications panel and the pop-ups. */

export const ALERT_ICONS = {
  zone_enter: '⤵',
  zone_exit: '⤴',
  loitering: '⏱',
  speeding: '⚡',
  ais_gap: '📡',
}

const knots = (v) => (v == null || Number.isNaN(Number(v)) ? null : `${Number(v).toFixed(1)} kn`)

/** { vessel, action, zone, extra } for "<vessel> <action> <zone>", plus a detail line (extra, may be null). */
export function describeAlert(a) {
  const vessel = a.vessel_name?.trim() || `MMSI ${a.mmsi}`
  const zone = a.zone_name || 'a zone'
  const d = a.details || {}
  switch (a.type) {
    case 'zone_enter':
      return { vessel, action: 'entered', zone, extra: knots(d.sog) }
    case 'zone_exit':
      return { vessel, action: 'left', zone, extra: knots(d.sog) }
    case 'loitering':
      return { vessel, action: 'is loitering in', zone, extra: d.loiter_minutes ? `Slow for ${d.loiter_minutes}+ min` : null }
    case 'speeding': {
      const sog = knots(d.sog)
      const max = knots(d.max_speed)
      return { vessel, action: 'is speeding in', zone, extra: sog && max ? `${sog} (limit ${max})` : sog }
    }
    case 'ais_gap':
      return { vessel, action: 'stopped transmitting in', zone, extra: d.gap_minutes ? `No AIS for ${d.gap_minutes}+ min` : null }
    default:
      return { vessel, action: String(a.type || 'alert').replace(/_/g, ' '), zone, extra: null }
  }
}

/** "just now", "5m ago", "3h ago", "2d ago". `when` is an ISO string or epoch ms. */
export function timeAgo(when, now = Date.now()) {
  const t = typeof when === 'number' ? when : Date.parse(when)
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Opens the ship an alert is about (selects it, or goes to where it was reported): see ShipLayer. */
export const focusAlert = (a) => window.handleShipFocus?.(a.mmsi, a.latitude, a.longitude)

export { isPhoneLayout } from '../hooks/usePhoneLayout'
