import tankerTop from '../assets/tanker-top.webp'
/** Identification: one vessel profile from its AIS data and the AI briefing. */
export default function Identification() {
  return (
    <section className="sec sec-dark" id="profile">
      <div className="wrap">
        <div className="head">
          <div className="rv"><span className="eyebrow">Identification</span><h2>Identify. Classify.<br /><b>Explain.</b></h2></div>
          <p className="lead rv" style={{ '--d': '.1s' }}>Every vessel’s AIS identity, size, speed and heading in one profile — with an AI briefing that points out anything that doesn’t add up, like a long stop at sea or a gap in reception.</p>
        </div>
        <div className="profile rv" style={{ '--d': '.15s' }}>
          <div className="img">
            <img src={tankerTop} width="1400" height="543" alt="Top-down view of a red product tanker on dark blue water" loading="lazy" decoding="async" />
            <div className="scan"></div>
            <svg className="ov" viewBox="0 0 1400 543" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <g fill="none" stroke="#f3cb7e" strokeWidth="1.5">
                <path d="M282 182 h22 M282 182 v22"/><path d="M1196 182 h-22 M1196 182 v22"/><path d="M282 356 h22 M282 356 v-22"/><path d="M1196 356 h-22 M1196 356 v-22"/>
              </g>
              <g stroke="#b4dbff" strokeWidth="1" fill="none">
                <path d="M295 410 V430 M1180 410 V430 M295 420 H1180" />
                <path d="M1240 197 H1260 M1240 340 H1260 M1250 197 V340" />
              </g>
              <g fontFamily="IBM Plex Mono, monospace" fontSize="15" fill="#e8eef5" letterSpacing="2">
                <rect x="660" y="406" width="160" height="28" fill="#03060b" opacity=".75"/><text x="740" y="425" textAnchor="middle">LOA 183.2 M</text>
                <g transform="translate(1290 268) rotate(90)"><rect x="-70" y="-14" width="140" height="28" fill="#03060b" opacity=".75"/><text x="0" y="5" textAnchor="middle">BEAM 32.2 M</text></g>
              </g>
              <g stroke="#f3cb7e" strokeWidth="2" fill="none"><path d="M1205 268 H1330"/><path d="M1318 258 L1334 268 L1318 278"/></g>
              <text x="1206" y="252" fontFamily="IBM Plex Mono, monospace" fontSize="14" fill="#f3cb7e" letterSpacing="2">HDG 090°</text>
              <g fontFamily="IBM Plex Mono, monospace" fontSize="13" letterSpacing="2" fill="#e8eef5">
                <rect x="300" y="120" width="300" height="46" fill="#03060b" opacity=".72"/><rect x="300" y="120" width="3" height="46" fill="#f3cb7e"/>
                <text x="316" y="139" fill="#8d9cb2" fontSize="11">TGT-01 · AIS PROFILE</text><text x="316" y="157">PRODUCT TANKER · UNDER WAY</text>
              </g>
            </svg>
          </div>
          <div className="spec">
            <div><small>Class</small><b>Product tanker</b></div>
            <div><small>Length / beam (AIS)</small><b>183 × 32 m</b></div>
            <div><small>Heading</small><b>090.0°</b></div>
            <div><small>AIS status</small><b className="ok">Reporting</b></div>
            <div><small>Draught</small><b>11.2 m</b></div>
            <div><small>AI briefing</small><b className="br">Nothing unusual</b></div>
          </div>
        </div>
      </div>
    </section>
  )
}
