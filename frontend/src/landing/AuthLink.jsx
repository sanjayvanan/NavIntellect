/* eslint-disable react/prop-types -- small internal component; the project does not use PropTypes */
import { navigate } from '../hooks/usePath'
import { LOGIN_URL, SIGNUP_URL } from './config'

/** Log in / Sign up: open the app's sign-in page on the matching tab (no page reload). */
export default function AuthLink({ kind, className, children, onClick }) {
  const href = kind === 'login' ? LOGIN_URL : SIGNUP_URL
  const go = (e) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(href)
  }
  return (
    <a className={className} href={href} onClick={go}>
      {children}
    </a>
  )
}
