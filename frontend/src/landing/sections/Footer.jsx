import logo from '../assets/logo.webp'
import AuthLink from '../AuthLink'
import { useUtcClock } from '../lib/motion'

export default function Footer() {
  const utc = useUtcClock()
  return (
    <footer>
      <div className="wrap">
        <div className="fgrid">
          <div><img className="logo-full" src={logo} width="900" height="578" alt="Coastal Surveillance System" loading="lazy" decoding="async" /></div>
          <div><h5>System</h5><a href="#caps">Sentinel AI</a><a href="#cop">Operating picture</a><a href="#profile">Identification</a><a href="#radar">Radar fusion</a></div>
          <div><h5>Operations</h5><a href="#flow">How it works</a><a href="#caps">Command API</a><a href="#cta">Deployment</a></div>
          <div><h5>Account</h5><AuthLink kind="login">Log in</AuthLink><AuthLink kind="signup">Sign up</AuthLink><a href="#cta">Contact</a></div>
        </div>
        <div className="fbar"><span>© {new Date().getFullYear()} Coastal Surveillance System · Nav-Intellect</span><span>{utc}</span></div>
      </div>
    </footer>
  )
}
