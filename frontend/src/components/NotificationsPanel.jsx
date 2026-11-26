/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import L from 'leaflet'
import { fetchAlerts, notificationsPanelToggled } from '../store/alertsSlice'
import { ALERT_ICONS, describeAlert, focusAlert, isPhoneLayout, timeAgo } from '../utils/alertText'
import { CloseIcon } from './Icons'
import './Notifications.css'

/**
 * Notifications (sidebar bell): zone alerts, newest first. Unread ones (since the panel was last
 * open) are marked. Clicking one opens that ship on the map.
 */
function NotificationsPanel({ style, theme, onClose }) {
  const dispatch = useDispatch()
  const { items, status, error, lastReadAt } = useSelector((state) => state.alerts)
  const ref = useRef(null)
  // Read state as it was when the panel opened (opening marks all read), so the new ones stay
  // marked while it is open.
  const [readBefore] = useState(lastReadAt)
  const [, tick] = useState(0)

  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
    dispatch(notificationsPanelToggled(true))
    const timer = setInterval(() => tick((n) => n + 1), 30_000) // refresh "5m ago"
    return () => {
      clearInterval(timer)
      dispatch(notificationsPanelToggled(false))
    }
  }, [dispatch])

  return (
    <div ref={ref} className={`layer-control-panel notifications-panel ${theme}`} style={style}>
      <div className="panel-header">
        <span>Notifications</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      {status === 'failed' && !items.length && (
        <div className="notif-empty">
          <p>{error}</p>
          <button type="button" className="notif-retry" onClick={() => dispatch(fetchAlerts())}>
            Try again
          </button>
        </div>
      )}
      {status === 'loading' && !items.length && <div className="notif-empty">Loading…</div>}
      {status !== 'loading' && status !== 'failed' && !items.length && (
        <div className="notif-empty">
          <p>No alerts yet.</p>
          <small>Turn on alerts for a zone in Graphical objects to be told when ships enter it.</small>
        </div>
      )}

      {items.length > 0 && (
        <ul className="notif-list">
          {items.map((a) => {
            const { vessel, action, zone, extra } = describeAlert(a)
            const unread = Date.parse(a.created_at) > readBefore
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`notif-item sev-${a.severity} ${unread ? 'unread' : ''}`}
                  onClick={() => {
                    focusAlert(a)
                    if (isPhoneLayout()) onClose() // on a phone the panel would hide the ship
                  }}
                  title="Show this ship on the map"
                >
                  <span className="alert-icon" aria-hidden="true">{ALERT_ICONS[a.type] || '!'}</span>
                  <span className="notif-body">
                    <span className="alert-text">
                      <strong>{vessel}</strong> {action} <strong>{zone}</strong>
                    </span>
                    <span className="notif-meta">
                      <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>
                        {timeAgo(a.created_at)}
                      </time>
                      {extra && <span>· {extra}</span>}
                    </span>
                  </span>
                  {unread && <span className="notif-dot" aria-label="New" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default NotificationsPanel
