import { useEffect, useRef } from 'react'
import Cta from './sections/Cta'
import Flow from './sections/Flow'
import Footer from './sections/Footer'
import Hero from './sections/Hero'
import Identification from './sections/Identification'
import Nav from './sections/Nav'
import OperatingPicture from './sections/OperatingPicture'
import RadarScope from './sections/RadarScope'
import Sentinel from './sections/Sentinel'
import Ticker from './sections/Ticker'
import './landing.css'

/**
 * Public landing page for signed-out visitors at '/'. Log in and Sign up open the sign-in page
 * (/login, /signup). Styles are scoped under .nw, and the page scrolls inside its own container.
 */
export default function Landing() {
  const root = useRef(null)

  // Sections rise into place as they scroll into view.
  useEffect(() => {
    const items = root.current.querySelectorAll('.rv')
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="nw" ref={root}>
      <Nav scroller={root} />
      <main id="top">
        <Hero />
        <Ticker />
        <OperatingPicture />
        <Identification />
        <RadarScope />
        <Sentinel />
        <Flow />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
