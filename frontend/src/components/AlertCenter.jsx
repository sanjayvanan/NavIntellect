/* eslint-disable react/prop-types -- internal components; the project does not use PropTypes */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { alertsUserChanged, dismissToast, fetchAlerts } from '../store/alertsSlice'
import { ALERT_ICONS, describeAlert, focusAlert } from '../utils/alertText'
import { CloseIcon } from './Icons'
import './Notifications.css'

const POLL_MS = 60_000
const TOAST_MS = 6000

function Toast({ alert, theme, onClose }) {
  // Timer starts once per toast (onClose is a new function on every render).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const t = setTimeout(() => closeRef.current(), TOAST_MS)
    return () => clearTimeout(t)
  }, [])
  const { vessel, action, zone } = describeAlert(alert)
  return (
    <div className={`alert-toast ${theme} sev-${alert.severity}`} role="status">
      <button
        type="button"
        className="alert-toast-body"
        onClick={() => {
          focusAlert(alert)
          onClose()
        }}
      >
        <span className="alert-icon" aria-hidden="true">{ALERT_ICONS[alert.type] || '!'}</span>
        <span className="alert-text">
          <strong>{vessel}</strong> {action} <strong>{zone}</strong>
        </span>
      </button>
      <button type="button" className="alert-toast-close" onClick={onClose} aria-label="Dismiss">
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

/**
 * Keeps the notifications current (load on sign-in, poll as a fallback to the live socket in
 * ShipLayer) and pops up alerts that arrive while the app is open.
 */
function AlertCenter() {
  const dispatch = useDispatch()
  const userId = useSelector((state) => state.auth.user?.id ?? null)
  const theme = useSelector((state) => state.theme.mode)
  const items = useSelector((state) => state.alerts.items)
  const toastIds = useSelector((state) => state.alerts.toasts)
  const newestRef = useRef(null)
  newestRef.current = items[0]?.created_at ?? null

  useEffect(() => {
    dispatch(alertsUserChanged(userId))
    const startedAt = new Date().toISOString()
    dispatch(fetchAlerts())
    const timer = setInterval(() => dispatch(fetchAlerts({ since: newestRef.current ?? startedAt })), POLL_MS)
    return () => clearInterval(timer)
  }, [dispatch, userId])

  const toasts = toastIds.map((id) => items.find((a) => a.id === id)).filter(Boolean)
  if (!toasts.length) return null
  return createPortal(
    <div className="alert-toasts" aria-live="polite">
      {toasts.map((a) => (
        <Toast key={a.id} alert={a} theme={theme} onClose={() => dispatch(dismissToast(a.id))} />
      ))}
    </div>,
    document.body,
  )
}

export default AlertCenter
