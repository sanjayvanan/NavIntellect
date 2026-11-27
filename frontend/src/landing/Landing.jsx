import './Landing.css'

/**
 * Public landing page for signed-out visitors. The page itself is a standalone document in
 * public/landing/ (its own styles and scripts, so nothing leaks into the map app); it is shown
 * full-screen here so the address stays '/'. Its Log in / Sign up links open /login and /signup
 * in the top window.
 */
function Landing() {
  return <iframe className="landing-frame" src="/landing/index.html" title="NavIntellect: Coastal Surveillance System" />
}

export default Landing
