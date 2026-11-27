import emblem from '../assets/emblem.webp'
/* eslint-disable react/prop-types -- small internal component; the project does not use PropTypes */
import { useEffect, useState } from 'react'
import AuthLink from '../AuthLink'

const LINKS = [
  ['#cop', 'Operating picture'],
  ['#profile', 'Identification'],
  ['#radar', 'Radar fusion'],
  ['#caps', 'Sentinel AI'],
  ['#cta', 'Access'],
]

/** Top bar (turns solid once the page scrolls) and the full-screen menu on phones. */
export default function Nav({ scroller }) {
  const [solid, setSolid] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const el = scroller.current
    const onScroll = () => setSolid(el.scrollTop > 40)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [scroller])

  const close = () => setOpen(false)

  return (
    <>
      <header className={`nav ${solid ? 'solid' : ''}`}>
        <div className="wrap">
          <a className="brand" href="#top" aria-label="Coastal Surveillance System — home">
            <img src={emblem} width="240" height="197" alt="" />
            <span>
              <b>Coastal Surveillance</b>
              <small>System · Nav-Intellect</small>
            </span>
          </a>
          <nav className="links" aria-label="Main">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="nav-r">
            <AuthLink kind="login" className="login">Log in</AuthLink>
            <AuthLink kind="signup" className="btn btn-b btn-sm">Sign up</AuthLink>
            <button className="menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
              <i></i>
            </button>
          </div>
        </div>
      </header>

      <div className={`sheet ${open ? 'on' : ''}`} role="dialog" aria-label="Menu" aria-hidden={!open}>
        <button className="x" aria-label="Close menu" onClick={close}>
          ×
        </button>
        {LINKS.map(([href, label]) => (
          <a key={href} className="l" href={href} onClick={close}>
            {label}
          </a>
        ))}
        <div className="row">
          <AuthLink kind="login" className="btn btn-o" onClick={close}>Log in</AuthLink>
          <AuthLink kind="signup" className="btn btn-b" onClick={close}>Sign up</AuthLink>
        </div>
      </div>
    </>
  )
}
