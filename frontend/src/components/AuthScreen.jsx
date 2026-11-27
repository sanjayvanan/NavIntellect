/* eslint-disable react/prop-types -- small internal components; the project does not use PropTypes */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearAuthError, login, register } from '../store/authSlice'
import logoFull from '../assets/navintellect-logo.svg'
import './AuthScreen.css'

const FEATURES = [
  { title: 'Live AIS, worldwide', text: 'Every vessel position, pushed to the map as it is reported.' },
  { title: 'Geofences & alerts', text: 'Restricted zones, loitering, speeding and AIS gaps flagged instantly.' },
  { title: 'Your workspace, remembered', text: 'Theme, layers and the exact region you were watching, restored on sign-in.' },
]

// 0–4: length, mixed case, digits, symbols.
function passwordScore(pw) {
  if (!pw) return 0
  let score = pw.length >= 10 ? 1 : 0
  if (pw.length >= 14) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}
const STRENGTH = ['Too short', 'Fair', 'Good', 'Strong', 'Excellent']

function Field({ id, label, type = 'text', value, onChange, autoComplete, icon, children, inputRef }) {
  return (
    <div className="auth-field">
      <span className="auth-field-icon" aria-hidden="true">{icon}</span>
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder=" "
        required={id !== 'name'}
      />
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

const MailIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)
const LockIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const UserIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
)
const EyeIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {!open && <path d="M3 3l18 18" />}
  </svg>
)

/**
 * Full-screen sign-in / create-account page. `mode` comes from the address (/login or /signup);
 * switching tabs reports the new mode so the address follows. `onBack` returns to the landing page.
 */
function AuthScreen({ mode: initialMode = 'signin', onModeChange, onBack }) {
  const dispatch = useDispatch()
  const { busy, error } = useSelector((state) => state.auth)
  const [mode, setMode] = useState(initialMode) // 'signin' | 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [localError, setLocalError] = useState(null)
  const [shake, setShake] = useState(0)
  const firstInput = useRef(null)

  const isRegister = mode === 'register'
  const score = useMemo(() => passwordScore(password), [password])
  const shownError = localError || error

  useEffect(() => {
    firstInput.current?.focus()
  }, [mode])

  // Back/forward between /login and /signup.
  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (shownError) setShake((n) => n + 1)
  }, [shownError])

  const switchMode = (next) => {
    if (next === mode) return
    setMode(next)
    onModeChange?.(next)
    setLocalError(null)
    setConfirm('')
    dispatch(clearAuthError())
  }

  const submit = (e) => {
    e.preventDefault()
    setLocalError(null)
    if (isRegister) {
      if (password.length < 10) return setLocalError('Use at least 10 characters for your password.')
      if (password !== confirm) return setLocalError('The passwords do not match.')
      dispatch(register({ name: name.trim(), email: email.trim(), password }))
    } else {
      dispatch(login({ email: email.trim(), password }))
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-grid" />
        <div className="auth-radar">
          <div className="auth-radar-sweep" />
          <span className="auth-blip" style={{ top: '28%', left: '62%' }} />
          <span className="auth-blip" style={{ top: '64%', left: '30%', animationDelay: '1.4s' }} />
          <span className="auth-blip" style={{ top: '40%', left: '22%', animationDelay: '2.6s' }} />
          <span className="auth-blip" style={{ top: '72%', left: '70%', animationDelay: '3.3s' }} />
        </div>
        <svg className="auth-waves" viewBox="0 0 1440 220" preserveAspectRatio="none">
          <path className="wave w1" d="M0 120 C 240 60 480 180 720 120 S 1200 60 1440 120 V220 H0Z" />
          <path className="wave w2" d="M0 150 C 260 100 520 200 780 150 S 1220 100 1440 150 V220 H0Z" />
          <path className="wave w3" d="M0 180 C 300 140 600 220 900 180 S 1260 150 1440 180 V220 H0Z" />
        </svg>
      </div>

      {onBack && (
        <button type="button" className="auth-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to home
        </button>
      )}

      <div className="auth-layout">
        <section className="auth-hero">
          <p className="auth-eyebrow">
            <span className="auth-live-dot" /> Maritime domain awareness
          </p>
          <h1>
            Watch every coastline.
            <br />
            <span>Pick up right where you left off.</span>
          </h1>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="auth-feature-mark" aria-hidden="true" />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="auth-card" aria-label={isRegister ? 'Create account' : 'Sign in'}>
          <img className="auth-logo" src={logoFull} alt="NavIntellect, Coastal Surveillance System" />

          <div className="auth-tabs" role="tablist" data-mode={mode}>
            <span className="auth-tab-indicator" aria-hidden="true" />
            <button type="button" role="tab" aria-selected={!isRegister} onClick={() => switchMode('signin')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={isRegister} onClick={() => switchMode('register')}>
              Create account
            </button>
          </div>

          <form key={mode} className="auth-form" onSubmit={submit} noValidate={false}>
            {isRegister && (
              <Field id="name" label="Full name (optional)" value={name} onChange={setName} autoComplete="name" icon={UserIcon} inputRef={firstInput} />
            )}
            <Field
              id="email"
              label="Email address"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              icon={MailIcon}
              inputRef={isRegister ? undefined : firstInput}
            />
            <Field
              id="password"
              label="Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              icon={LockIcon}
            >
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showPw} />
              </button>
            </Field>

            {isRegister && (
              <>
                <div className={`auth-strength s${score}`} aria-live="polite">
                  <div className="bars">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className={score >= i ? 'on' : ''} />
                    ))}
                  </div>
                  <small>{password ? STRENGTH[score] : 'At least 10 characters'}</small>
                </div>
                <Field
                  id="confirm"
                  label="Confirm password"
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  icon={LockIcon}
                />
              </>
            )}

            {shownError && (
              <p key={shake} className="auth-error" role="alert">
                {shownError}
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? <span className="auth-spinner" aria-label="Please wait" /> : isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? 'Already have an account?' : 'New to NavIntellect?'}{' '}
            <button type="button" onClick={() => switchMode(isRegister ? 'signin' : 'register')}>
              {isRegister ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </div>
    </div>
  )
}

export default AuthScreen
