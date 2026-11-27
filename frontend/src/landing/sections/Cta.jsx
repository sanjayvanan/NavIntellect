import heroSunrise from '../assets/hero-sunrise.webp'
import AuthLink from '../AuthLink'

/** Final call to action. */
export default function Cta() {
  return (
    <section className="cta" id="cta">
      <img src={heroSunrise} alt="" aria-hidden="true" loading="lazy" decoding="async" />
      <div className="wrap">
        <span className="eyebrow rv">Access</span>
        <h2 className="rv" style={{ '--d': '.1s' }}>Secure your<br /><b>coastline.</b></h2>
        <p className="lead rv" style={{ '--d': '.15s' }}>Create your account, draw the waters you watch, and get alerted the moment something happens.</p>
        <div className="cta-row rv" style={{ '--d': '.2s' }}>
          <AuthLink kind="signup" className="btn btn-b">Sign up <span className="ar">→</span></AuthLink>
          <AuthLink kind="login" className="btn btn-o">Log in to Nav-Intellect</AuthLink>
        </div>
        <small className="rv" style={{ '--d': '.25s' }}>Encrypted in transit and at rest · Role-based access</small>
      </div>
    </section>
  )
}
