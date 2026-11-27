/** How it works: detect, identify, assess, respond. */
export default function Flow() {
  return (
    <section className="sec sec-mid" id="flow">
      <div className="wrap">
        <div className="head">
          <div className="rv"><span className="eyebrow">How it works</span><h2>Detect to respond.<br /><b>In seconds.</b></h2></div>
          <p className="lead rv" style={{ '--d': '.1s' }}>One continuous loop from the first AIS report to the decision on your operator’s screen.</p>
        </div>
        <div className="flow rv">
          <div className="step"><div className="ph">Phase 01<i>AIS</i></div><h3>Detect</h3><p>AIS messages arrive as ships report — worldwide, every few seconds.</p><div className="bar"><i></i></div></div>
          <div className="step"><div className="ph">Phase 02<i>Tracking</i></div><h3>Identify</h3><p>Each report updates the ship’s identity, position and track — and which of your zones it is in.</p><div className="bar"><i style={{ '--d': '.4s' }}></i></div></div>
          <div className="step"><div className="ph">Phase 03<i>Analysis</i></div><h3>Assess</h3><p>Every position is checked against your zones and rules: entering, leaving, speeding, loitering, going quiet.</p><div className="bar"><i style={{ '--d': '.8s' }}></i></div></div>
          <div className="step"><div className="ph">Phase 04<i>Command</i></div><h3>Respond</h3><p>Operators get the alert, the track and an AI explanation of why it matters.</p><div className="bar"><i style={{ '--d': '1.2s' }}></i></div></div>
        </div>
      </div>
    </section>
  )
}
