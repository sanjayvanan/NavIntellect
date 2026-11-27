import { DEG, reduceMotion, whileVisible } from './motion'

/**
 * Radar scope preview (2D canvas): sweep, echoes, AIS symbols and unidentified contacts, with a
 * readout for the contact under the pointer. Returns { setMode, stop }.
 */
export function startScope({ canvas, els }) {
  const reduce = reduceMotion()
  const $ = (q) => (q === '#scope' ? canvas : els[q])
  const scope = $('#scope'), sx = scope.getContext('2d'), trail = document.createElement('canvas'), tx = trail.getContext('2d');
  let SR = 600, rMode = 'fused', sweep = 0, rHover = null, smx = -1, smy = -1;
  const RANGE = 12, OWN = { sog: 14.6, cog: 72 };
  function sizeScope() { const r = scope.getBoundingClientRect(); SR = Math.max(280, Math.round(r.width * Math.min(2, devicePixelRatio || 1))); scope.width = scope.height = trail.width = trail.height = SR; }
  let ro = null;
  if ('ResizeObserver' in window) { ro = new ResizeObserver(sizeScope); ro.observe(scope); } else addEventListener('resize', sizeScope);
  sizeScope();
  const RT = [
    { n: 'KAVERI STAR', t: 'Container', r: 5.2, b: 28, sog: 16.4, cog: 248, ais: 1, sz: 1.3 },
    { n: 'ARABIAN PEARL', t: 'Crude tanker', r: 8.4, b: 96, sog: 12.8, cog: 300, ais: 1, sz: 1.6 },
    { n: 'NORDIC ASTER', t: 'Product tanker', r: 9.6, b: 150, sog: 18.1, cog: 20, ais: 1, sz: 1.4 },
    { n: 'SAGAR PRATHAM', t: 'Bulk carrier', r: 3.6, b: 200, sog: 10.2, cog: 70, ais: 1, sz: 1.2 },
    { n: 'COBALT MARINER', t: 'Ro-Ro', r: 7.1, b: 228, sog: 15.0, cog: 95, ais: 1, sz: 1.1 },
    { n: 'BLUE NILGIRI', t: 'Fishing', r: 2.4, b: 58, sog: 4.2, cog: 160, ais: 1, sz: .7 },
    { n: 'TIDEWATER NINE', t: 'Tug', r: 4.3, b: 118, sog: 8.0, cog: 250, ais: 1, sz: .8 },
    { n: 'UNIDENTIFIED', t: 'No AIS', r: 6.2, b: 166, sog: 9.5, cog: 320, ais: 0, sz: 1.0 },
    { n: 'UNIDENTIFIED', t: 'No AIS', r: 10.4, b: 252, sog: 6.1, cog: 10, ais: 0, sz: .9 },
  ].map(o => ({ ...o, x: o.r * Math.sin(o.b * DEG), y: o.r * Math.cos(o.b * DEG) }));
  const LANDPTS = []; for (let i = 0; i < 700; i++) { const b = (286 + Math.random() * 70) * DEG, e = 8.2 + 2.2 * Math.sin(b * 7) + 1.2 * Math.sin(b * 17 + 1), r = e + Math.random() * (RANGE + 1 - e); LANDPTS.push([r * Math.sin(b), r * Math.cos(b)]); }
  $('#rCount').textContent = `${RT.filter(t => t.ais).length} AIS · ${RT.filter(t => !t.ais).length} UNID`;
  const ownV = () => [OWN.sog * Math.sin(OWN.cog * DEG), OWN.sog * Math.cos(OWN.cog * DEG)];
  const cpa = t => { const [ox, oy] = ownV(), vx = t.sog * Math.sin(t.cog * DEG) - ox, vy = t.sog * Math.cos(t.cog * DEG) - oy, v2 = vx * vx + vy * vy || 1e-6, tc = -(t.x * vx + t.y * vy) / v2; return [Math.hypot(t.x + vx * tc, t.y + vy * tc), tc * 60]; };
  const setPtr = e => { const r = scope.getBoundingClientRect(), k = SR / r.width; smx = (e.clientX - r.left) * k; smy = (e.clientY - r.top) * k; };
  scope.addEventListener('pointermove', setPtr); scope.addEventListener('pointerdown', setPtr);
  scope.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') smx = smy = -1; });
  const nm2px = (x, y) => { const s = SR / 2 * .9 / RANGE; return [SR / 2 + x * s, SR / 2 - y * s]; };
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';
  function drawScope(dt) {
    const C = SR / 2, R = SR / 2 * .9, S = SR / 1000, [ox, oy] = ownV();
    RT.forEach(t => { t.x += (t.sog * Math.sin(t.cog * DEG) - ox) * dt / 60; t.y += (t.sog * Math.cos(t.cog * DEG) - oy) * dt / 60;
      if (Math.hypot(t.x, t.y) > RANGE * 1.02) { const b = Math.random() * 360 * DEG; t.x = RANGE * .98 * Math.sin(b); t.y = RANGE * .98 * Math.cos(b); t.cog = (b / DEG + 180 + (Math.random() - .5) * 60 + 360) % 360; } });
    tx.globalCompositeOperation = 'destination-out'; tx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * .42)})`; tx.fillRect(0, 0, SR, SR); tx.globalCompositeOperation = 'lighter';
    const prev = sweep; sweep = (sweep + dt * Math.PI * 2 / 4.2) % (Math.PI * 2);
    const passed = a => { a = (a + Math.PI * 2) % (Math.PI * 2); return prev <= sweep ? (a > prev && a <= sweep) : (a > prev || a <= sweep); };
    const blob = (x, y, rad, a) => { const g = tx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(200,230,255,${a})`); g.addColorStop(.4, `rgba(110,182,255,${a * .55})`); g.addColorStop(1, 'rgba(60,120,200,0)'); tx.fillStyle = g; tx.beginPath(); tx.arc(x, y, rad, 0, 7); tx.fill(); };
    if (rMode !== 'ais') {
      RT.forEach(t => { if (passed(Math.atan2(t.x, t.y))) { const [px, py] = nm2px(t.x, t.y); blob(px, py, (10 + t.sz * 9) * S, .95); } });
      LANDPTS.forEach(p => { if (passed(Math.atan2(p[0], p[1]))) { const [px, py] = nm2px(p[0], p[1]); blob(px, py, (7 + Math.random() * 7) * S, .3); } });
      for (let i = 0; i < 5; i++) { const a = prev + Math.random() * ((sweep - prev + Math.PI * 2) % (Math.PI * 2)), r = Math.random() * 1.6, [px, py] = nm2px(r * Math.sin(a), r * Math.cos(a)); blob(px, py, (4 + Math.random() * 5) * S, .26); }
    }
    sx.clearRect(0, 0, SR, SR);
    const bg = sx.createRadialGradient(C, C, 0, C, C, C); bg.addColorStop(0, '#0a1626'); bg.addColorStop(.88, '#050b14'); bg.addColorStop(1, '#03060b');
    sx.fillStyle = bg; sx.beginPath(); sx.arc(C, C, C, 0, 7); sx.fill();
    sx.save(); sx.beginPath(); sx.arc(C, C, R, 0, 7); sx.clip();
    sx.strokeStyle = 'rgba(148,190,240,.13)'; sx.lineWidth = 1.4 * S;
    for (let k = 1; k <= 6; k++) { sx.beginPath(); sx.arc(C, C, R * k / 6, 0, 7); sx.stroke(); }
    for (let a = 0; a < 360; a += 30) { const r = a * DEG; sx.beginPath(); sx.moveTo(C, C); sx.lineTo(C + Math.sin(r) * R, C - Math.cos(r) * R); sx.stroke(); }
    sx.drawImage(trail, 0, 0);
    if (rMode !== 'ais') {
      for (let i = 0; i < 36; i++) { const a0 = sweep - (i + 1) * .013, a1 = sweep - i * .013; sx.fillStyle = `rgba(110,182,255,${.2 * (1 - i / 36) ** 2})`; sx.beginPath(); sx.moveTo(C, C); sx.arc(C, C, R, a0 - Math.PI / 2, a1 - Math.PI / 2); sx.closePath(); sx.fill(); }
      sx.strokeStyle = 'rgba(200,230,255,.85)'; sx.lineWidth = 2 * S; sx.beginPath(); sx.moveTo(C, C); sx.lineTo(C + Math.sin(sweep) * R, C - Math.cos(sweep) * R); sx.stroke();
    }
    const hd = OWN.cog * DEG; sx.strokeStyle = 'rgba(243,203,126,.55)'; sx.setLineDash([6 * S, 6 * S]); sx.lineWidth = 1.4 * S;
    sx.beginPath(); sx.moveTo(C, C); sx.lineTo(C + Math.sin(hd) * R, C - Math.cos(hd) * R); sx.stroke(); sx.setLineDash([]);
    sx.save(); sx.translate(C, C); sx.rotate(hd); sx.fillStyle = '#f3cb7e'; sx.beginPath(); sx.moveTo(0, -14 * S); sx.lineTo(7 * S, 10 * S); sx.lineTo(-7 * S, 10 * S); sx.closePath(); sx.fill(); sx.restore();
    rHover = null; let best = (30 * S) ** 2;
    RT.forEach(t => { const [px, py] = nm2px(t.x, t.y), d = (px - smx) ** 2 + (py - smy) ** 2; if (d < best) { best = d; rHover = t; } });
    const fs = Math.round(14 * S * 1.1);
    RT.forEach(t => {
      const [px, py] = nm2px(t.x, t.y), hov = t === rHover;
      if (rMode !== 'radar' && t.ais) {
        const c = t.cog * DEG, v = t.sog / 60 * 6, [vx, vy] = nm2px(t.x + Math.sin(c) * v, t.y + Math.cos(c) * v);
        sx.strokeStyle = hov ? '#fff' : 'rgba(220,236,250,.8)'; sx.lineWidth = (hov ? 2 : 1.4) * S;
        sx.beginPath(); sx.moveTo(px, py); sx.lineTo(vx, vy); sx.stroke();
        sx.save(); sx.translate(px, py); sx.rotate(c); sx.beginPath(); sx.moveTo(0, -11 * S); sx.lineTo(7 * S, 8 * S); sx.lineTo(-7 * S, 8 * S); sx.closePath();
        sx.fillStyle = hov ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.08)'; sx.fill(); sx.stroke(); sx.restore();
        sx.font = `500 ${fs}px ${MONO}`; sx.fillStyle = hov ? '#fff' : 'rgba(214,228,244,.75)'; sx.fillText(t.n, px + 14 * S, py - 10 * S);
        if (rMode === 'fused') { sx.strokeStyle = 'rgba(110,182,255,.5)'; sx.lineWidth = S; sx.beginPath(); sx.arc(px, py, 20 * S, 0, 7); sx.stroke(); }
      }
      if (rMode === 'fused' && !t.ais) {
        const s = 17 * S; sx.strokeStyle = '#ff5048'; sx.lineWidth = 1.6 * S; sx.setLineDash([4 * S, 3 * S]); sx.strokeRect(px - s, py - s, s * 2, s * 2); sx.setLineDash([]);
        sx.font = `500 ${fs}px ${MONO}`; sx.fillStyle = '#ff7a72'; sx.fillText('UNID · NO AIS', px + s + 6 * S, py + 4 * S);
      }
      if (hov) { sx.strokeStyle = '#f3cb7e'; sx.lineWidth = 1.6 * S; sx.beginPath(); sx.arc(px, py, 28 * S + Math.sin(performance.now() / 200) * 3 * S, 0, 7); sx.stroke(); }
    });
    sx.restore();
    sx.fillStyle = 'rgba(200,220,240,.55)'; sx.font = `500 ${Math.round(12 * S * 1.2)}px ${MONO}`; sx.textAlign = 'center'; sx.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) { const r = a * DEG, l = a % 30 === 0 ? 14 : a % 10 === 0 ? 8 : 4;
      sx.strokeStyle = 'rgba(200,220,240,.35)'; sx.lineWidth = S; sx.beginPath(); sx.moveTo(C + Math.sin(r) * R, C - Math.cos(r) * R); sx.lineTo(C + Math.sin(r) * (R + l * S), C - Math.cos(r) * (R + l * S)); sx.stroke();
      if (a % 30 === 0) sx.fillText(String(a).padStart(3, '0'), C + Math.sin(r) * (R + 34 * S), C - Math.cos(r) * (R + 34 * S)); }
    sx.textAlign = 'start'; sx.textBaseline = 'alphabetic';
    const t = rHover;
    if (t) { const b = ((Math.atan2(t.x, t.y) / DEG) + 360) % 360, rng = Math.hypot(t.x, t.y), [cp, tc] = cpa(t);
      $('#rcTitle').textContent = t.ais ? `${t.n} · ${t.t} · ${t.sog.toFixed(1)} kn` : 'Radar-only contact · no AIS broadcast';
      $('#rcT').classList.toggle('warn', !t.ais);
      $('#rcBrg').textContent = b.toFixed(1) + '°'; $('#rcRng').textContent = rng.toFixed(2) + ' nm';
      $('#rcCpa').textContent = tc < 0 ? 'Opening' : cp.toFixed(2) + ' nm'; $('#rcTcpa').textContent = tc < 0 ? '—' : tc.toFixed(1) + ' min';
      $('#rcCpa').classList.toggle('w', tc > 0 && cp < 1); }
  }
  drawScope(.016);
  const redraw = () => drawScope(0);
  const stop = reduce ? () => {} : whileVisible(scope, drawScope);
  if (reduce) scope.addEventListener('pointermove', redraw);
  return {
    setMode: (m) => { rMode = m; if (reduce) drawScope(0); },
    stop: () => { stop(); ro?.disconnect(); removeEventListener('resize', sizeScope); scope.removeEventListener('pointermove', redraw); },
  };
}
