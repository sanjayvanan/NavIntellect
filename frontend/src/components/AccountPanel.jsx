/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useDispatch } from 'react-redux'
import { logout } from '../store/authSlice'
import { useIsolateFromMap } from '../hooks/useIsolateFromMap'
import { displayName, initials } from '../utils/user'
import { CloseIcon } from './Icons'

const ROLE_LABEL = { admin: 'Administrator', operator: 'Operator', viewer: 'Viewer' }

/** Account popover from the avatar at the bottom of the rail. */
function AccountPanel({ user, theme, onClose }) {
  const dispatch = useDispatch()
  const ref = useIsolateFromMap()

  return (
    <div ref={ref} className={`layer-control-panel account-panel ${theme}`} style={{ bottom: 12 }}>
      <div className="panel-header">
        <span>Account</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="account-identity">
        <span className="account-avatar">{initials(user)}</span>
        <div>
          <strong>{displayName(user)}</strong>
          <small>{user?.email}</small>
        </div>
      </div>
      <span className={`account-role ${user?.role}`}>{ROLE_LABEL[user?.role] ?? user?.role}</span>

      <p className="account-sync">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        Theme, layers, settings and your map position are saved to this account and restored when you sign in.
      </p>

      <button className="account-signout" onClick={() => dispatch(logout())}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        Sign out
      </button>
    </div>
  )
}

export default AccountPanel
