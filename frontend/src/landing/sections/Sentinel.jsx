import { useEffect, useRef, useState } from 'react'
import { reduceMotion } from '../lib/motion'

/** Alerts as they appear in the feed (demo). [severity, title, detail] */
const EVENTS = [
  ['hi', 'UNK-07 switched off AIS inside the restricted zone', 'Last position kept · operator notified'],
  ['hi', 'Two vessels stopped together at the anchorage', 'TGT-01 + UNK-07 · 38 min, both under 0.5 kn'],
  ['md', 'TGT-03 loitering 2.4 nm off the harbour mouth', 'Speed under 1 kn for 52 min'],
  ['hi', 'Identity swap suspected on TGT-08', 'Name and MMSI changed mid-voyage'],
  ['md', 'Fishing vessel entered the no-fishing zone', 'Zone N-2 · 03:14 local'],
  ['lo', 'TGT-04 deviated from its declared route', '6.2 nm off track · now heading 285°'],
  ['md', 'TGT-02 exceeded the zone speed limit', '18.5 kn in a 15 kn zone · Strait TSS'],
  ['lo', 'TGT-06 left the monitored zone', 'Zone S-1 · heading 250°'],
]
const SEV_LABEL = { hi: 'High', md: 'Med', lo: 'Info' }

/** Questions the chat demo types out, with their answers. */
const QA = [
  [
    'Which ships near Kovalam went dark this week?',
    <>
      Two vessels stopped transmitting inside your zone: <em>UNK-07</em> (Tue 02:10, last seen at the anchorage) and <em>UNK-09</em> (Thu 23:40, 18 nm
      out). <span className="r">UNK-07 raised a critical alert.</span>
    </>,
  ],
  [
    'Show me what TGT-01 did in the last 6 hours.',
    <>
      Drawing its track now. <em>TGT-01</em> slowed to <em>0.1 kn</em> at Anchorage A-2 at 02:41 and has not moved since. Another vessel has been
      within <em>0.2 nm</em> of it for <em>38 min</em>.
    </>,
  ],
  [
    'Which vessels are heading for the restricted zone?',
    <>
      Two on current course: <em>TGT-04</em> (about 22 min) and <em>UNK-09</em> (about 41 min).{' '}
      <span className="r">UNK-09 has not reported a destination.</span>
    </>,
  ],
]

const utcTime = () => new Date().toISOString().slice(11, 19)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export default function Sentinel() {
  const visRef = useRef(null)
  const feedRef = useRef(null)
  const chatRef = useRef(null)
  const [visOn, setVisOn] = useState(false)
  const [analysed, setAnalysed] = useState(1284)
  const [feed, setFeed] = useState([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)

  // The track drawing plays once, when it scrolls into view.
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          setVisOn(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(visRef.current)
    const t = setInterval(() => setAnalysed(1280 + Math.round(Math.random() * 9)), 1400)
    return () => {
      io.disconnect()
      clearInterval(t)
    }
  }, [])

  // Feed: four alerts to start, then a new one every few seconds while it is on screen.
  useEffect(() => {
    let n = 0
    const make = () => {
      const [sev, title, detail] = EVENTS[n % EVENTS.length]
      return { id: `${Date.now()}-${n++}`, sev, title, detail, at: utcTime() }
    }
    const next = () => setFeed((f) => [make(), ...f].slice(0, 5))
    setFeed([make(), make(), make(), make()].reverse())
    let timer = null
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !timer && !reduceMotion()) timer = setInterval(next, 3200)
      else if (!es[0].isIntersecting && timer) {
        clearInterval(timer)
        timer = null
      }
    })
    io.observe(feedRef.current)
    return () => {
      io.disconnect()
      clearInterval(timer)
    }
  }, [])

  // Chat: types each question, then shows its answer, while the chat is on screen.
  useEffect(() => {
    let visible = false
    let running = false
    let unmounted = false
    let qi = 0
    const play = async () => {
      if (running) return
      running = true
      while (visible && !unmounted) {
        const [q, a] = QA[qi++ % QA.length]
        setAnswer(null)
        setQuestion('')
        for (let i = 1; i <= q.length && visible && !unmounted; i++) {
          setQuestion(q.slice(0, i))
          await wait(reduceMotion() ? 0 : 32)
        }
        await wait(600)
        if (unmounted) break
        setAnswer(a)
        await wait(6500)
      }
      running = false
    }
    const io = new IntersectionObserver((es) => {
      visible = es[0].isIntersecting
      if (visible) play()
    })
    io.observe(chatRef.current)
    return () => {
      unmounted = true
      io.disconnect()
    }
  }, [])

  return (
    <section className="sec sec-dark" id="caps">
      <div className="wrap">
        <div className="head">
          <div className="rv"><span className="eyebrow">Sentinel AI</span><h2>An AI watch officer.<br /><b>On duty 24/7.</b></h2></div>
          <p className="lead rv" style={{ '--d': '.1s' }}>An AI built into the surveillance picture. Sentinel works on the same live AIS data your operators see — with their permissions — answers questions in plain words, explains every alert, and briefs you on any ship in one click.</p>
        </div>
        <div className="ai-grid">
          <article className="ai-card ai-vision rv">
            <header className="ai-bar"><span><i className="dot g"></i>Sentinel analysis · AIS</span><span className="hide-m">Tracks analysed <b>{analysed.toLocaleString('en-US')}</b></span></header>
            <div className={`vis${visOn ? ' on' : ''}`} ref={visRef}>
              <svg className="tracks" viewBox="0 0 700 330" preserveAspectRatio="xMidYMid meet" aria-label="Two vessel tracks meeting at an anchorage, one on AIS and one that switched its AIS off, with their speeds dropping to zero">
                <defs><pattern id="gp" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="rgba(148,178,214,.08)"/></pattern></defs>
                <rect width="700" height="330" fill="url(#gp)"/>
                <path d="M0 40 C 60 70, 40 140, 90 180 S 70 250, 120 330 L0 330Z" fill="rgba(148,178,214,.07)" stroke="rgba(148,178,214,.35)"/>
                <text x="16" y="300" className="tk-l" fill="#5a6a80">COAST</text>
                <path d="M330 90 L540 80 L560 220 L320 236 Z" fill="rgba(243,203,126,.04)" stroke="#f3cb7e" strokeDasharray="6 5" strokeOpacity=".6"/>
                <text x="338" y="106" className="tk-l" fill="#f3cb7e">ANCHORAGE A-2</text>
                <path className="draw a" d="M690 30 C 620 60, 560 110, 500 140 S 450 160, 440 166" fill="none" stroke="#6eb6ff" strokeWidth="2"/>
                <g fill="#6eb6ff" className="pts a"><path d="M640 50 l8 -3 -3 8z"/><path d="M570 100 l8 -4 -2 8z"/><path d="M500 140 l8 -4 -2 8z"/></g>
                <path className="draw b" d="M140 320 C 230 290, 330 250, 400 210 S 440 184, 448 176" fill="none" stroke="#ff5048" strokeWidth="2" strokeDasharray="6 5"/>
                <circle cx="444" cy="171" r="16" fill="none" stroke="#ff5048" className="meet"/>
                <circle cx="440" cy="166" r="4.5" fill="#6eb6ff"/><circle cx="448" cy="176" r="4.5" fill="#ff5048"/>
                <g className="tk-tag"><rect x="462" y="160" width="234" height="60" fill="rgba(3,6,11,.85)" stroke="rgba(255,80,72,.5)"/><rect x="462" y="160" width="3" height="60" fill="#ff5048"/>
                  <text x="476" y="180" className="tk-l" fill="#ff8a83">RENDEZVOUS · 38 MIN</text><text x="476" y="198" className="tk-v">TGT-01 + UNK-07</text><text x="476" y="213" className="tk-l" fill="#8d9cb2">0.2 NM APART · BOTH &lt; 0.5 KN</text></g>
                <text x="600" y="24" className="tk-l" fill="#6eb6ff">TGT-01 · AIS</text>
                <text x="150" y="308" className="tk-l" fill="#ff8a83">UNK-07 · AIS OFF</text>
              </svg>
              <div className="spd">
                <span className="lbl">Speed · last 3 h</span>
                <svg viewBox="0 0 700 70" preserveAspectRatio="none" aria-hidden="true">
                  <path className="draw a" d="M0 18 C 120 18, 260 20, 330 34 S 400 62, 440 64 L700 64" fill="none" stroke="#6eb6ff" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
                  <path className="draw b" d="M0 30 C 140 30, 300 28, 360 44 S 420 62, 450 63 L700 63" fill="none" stroke="#ff5048" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>
                  <path d="M450 0 V70" stroke="rgba(243,203,126,.6)" strokeDasharray="3 3"/>
                </svg>
                <span className="mk">Met · 02:41</span>
              </div>
            </div>
            <div className="vis-foot">
              <div><small>Sees the picture you see</small><p>Sentinel works on the same AIS picture your operators watch — reading speed, course, position history and reception gaps to explain what every vessel is doing.</p></div>
              <div className="flag"><small>AI explanation</small><b>Possible ship-to-ship transfer</b><span>TGT-01 + UNK-07 (AIS off) · 38 min</span></div>
            </div>
          </article>
          <article className="ai-card ai-feed rv" style={{ '--d': '.08s' }}>
            <header className="ai-bar"><span><i className="dot r"></i>Flagged by your rules · explained by AI</span><span>Last 24 h · <b>17</b></span></header>
            <ul className="feed" ref={feedRef}>
              {feed.map((e) => (
                <li key={e.id}>
                  <span className={`sev ${e.sev}`}>{SEV_LABEL[e.sev]}</span>
                  <span>
                    <b>{e.title}</b>
                    <small>
                      {e.at} UTC · {e.detail}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </article>
          <article className="ai-card ai-chat rv">
            <header className="ai-bar"><span><i className="dot b"></i>Ask Sentinel</span><span>Natural language</span></header>
            <div className="chat" ref={chatRef}>
              <div className="msg me"><span>{question}</span><i className="caret"></i></div>
              <div className={`msg ai${answer ? ' on' : ''}`}>{answer}</div>
            </div>
            <div className="ask"><span>Ask about any ship, zone or incident…</span><kbd>↵</kbd></div>
          </article>
          <article className="ai-card ai-auto rv" style={{ '--d': '.08s' }}>
            <header className="ai-bar"><span><i className="dot y"></i>Autonomous watch</span><span>On the roadmap</span></header>
            <div className="auto">
              <div className="toggles">
                <label className="tg"><span><b>Monitor ships for me</b><small>AI keeps an eye on the vessels you pick and reports changes</small></span><input type="checkbox" defaultChecked /><i></i></label>
                <label className="tg"><span><b>Flag suspicious behaviour</b><small>Raised automatically, with the evidence attached</small></span><input type="checkbox" defaultChecked /><i></i></label>
                <label className="tg"><span><b>Learn normal traffic</b><small>Builds a pattern of life for your coastline</small></span><input type="checkbox" defaultChecked /><i></i></label>
                <label className="tg"><span><b>Escalate to duty officer</b><small>Only when confidence is high</small></span><input type="checkbox" /><i></i></label>
              </div>
              <div className="chips"><small>Watching for</small>
                <span>AIS switched off</span><span>Loitering</span><span>Ship-to-ship meeting</span><span>Zone breach</span><span>Identity swap</span><span>Speed anomaly</span><span>Route deviation</span><span>AIS gaps at night</span>
              </div>
            </div>
          </article>
        </div>
        <div className="caps-strip rv">
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><circle cx="22" cy="22" r="16"/><circle cx="22" cy="22" r="8" stroke="#6eb6ff"/><path d="M22 22 L34 13"/></svg><b>Live AIS tracking</b><span>Worldwide AIS, streamed to the map as ships report</span></div>
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><path d="M6 30 L16 24"/><path d="M16 24 L22 21" stroke="#ff5048" strokeDasharray="2 3"/><path d="M22 21 L38 12"/><rect x="18" y="18" width="7" height="7" stroke="#ff5048"/></svg><b>AIS gap alerts</b><span>Ships that stop transmitting inside your zones</span></div>
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><path d="M8 12 L30 8 L37 30 L14 36 Z" strokeDasharray="3 3"/><circle cx="22" cy="22" r="3" fill="#6eb6ff" stroke="none"/></svg><b>Geofence &amp; EEZ</b><span>Entry, exit, loitering and speed alerts</span></div>
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><path d="M8 34 L22 22" /><path d="M36 30 L22 22" stroke="#6eb6ff"/><circle cx="22" cy="22" r="7" strokeDasharray="3 3"/></svg><b>AI copilot</b><span>Ask about ships, zones and alerts in plain words</span></div>
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><path d="M6 34 C 14 30, 16 18, 24 16 S 34 10, 38 8" strokeDasharray="3 3"/><circle cx="38" cy="8" r="2.5" fill="#f3cb7e" stroke="none"/><path d="M6 38 H38" stroke="#6eb6ff"/></svg><b>Track history</b><span>Three days of tracks per ship, gaps marked</span></div>
          <div className="cs"><svg viewBox="0 0 44 44" fill="none" stroke="#f3cb7e" strokeWidth="1.5"><rect x="6" y="8" width="32" height="28" rx="2"/><path d="M12 18 l5 4 -5 4 M21 27 h10" stroke="#6eb6ff"/></svg><b>Secure API</b><span>Role-based access for viewers, operators and admins</span></div>
        </div>
      </div>
    </section>
  )
}
