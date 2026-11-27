import { DEG, reduceMotion, whileVisible } from './motion'

/**
 * Common operating picture: a 3D coastline with a shore station and moving vessels, drawn with
 * raw WebGL (no libraries). Drag to orbit. Returns a function that stops it.
 */
export function startOperatingPicture({ canvas, labels, list, count }) {
  const reduce = reduceMotion()
  const $ = (q) => ({ '#gl3d': canvas, '#tlabels': labels, '#trkList': list, '#trkN': count })[q]
  const cv = $('#gl3d'), wrapEl = cv.parentElement, labelsEl = $('#tlabels');
  const gl = cv.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false }) || cv.getContext('experimental-webgl');
  if (!gl) { wrapEl.insertAdjacentHTML('beforeend', '<p style="position:absolute;inset:0;display:grid;place-items:center;color:#8d9cb2;font:500 12px IBM Plex Mono,monospace;letter-spacing:.14em">3D VIEW NEEDS WEBGL</p>'); return () => {}; }
  const VS = `attribute vec3 p;attribute vec4 c;attribute float s;uniform mat4 m;uniform float pr;uniform float t;varying vec4 vc;
    void main(){vec3 q=p; if(s<0.){q.y+=sin(q.x*1.3+t*1.1)*.035+cos(q.z*1.7+t*.9)*.03;}
    vec4 pp=m*vec4(q,1.);gl_Position=pp;gl_PointSize=abs(s)*pr*(10./pp.w);vc=c;}`;
  const FS = `precision mediump float;varying vec4 vc;uniform float pt;
    void main(){float a=1.;if(pt>.5){vec2 d=gl_PointCoord-.5;float r=length(d);if(r>.5)discard;a=smoothstep(.5,.05,r);}gl_FragColor=vec4(vc.rgb,vc.a*a);}`;
  const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg); gl.useProgram(pg);
  const A = { p: gl.getAttribLocation(pg, 'p'), c: gl.getAttribLocation(pg, 'c'), s: gl.getAttribLocation(pg, 's') };
  const U = { m: gl.getUniformLocation(pg, 'm'), pr: gl.getUniformLocation(pg, 'pr'), t: gl.getUniformLocation(pg, 't'), pt: gl.getUniformLocation(pg, 'pt') };
  // interleaved buffer: x y z r g b a s  (8 floats)
  const mk = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return { b, n: arr.length / 8 }; };
  const dyn = () => ({ b: gl.createBuffer(), n: 0 });
  const upd = (o, arr) => { gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW); o.n = arr.length / 8; };
  const bind = o => { gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(A.c); gl.vertexAttribPointer(A.c, 4, gl.FLOAT, false, 32, 12); gl.enableVertexAttribArray(A.s); gl.vertexAttribPointer(A.s, 1, gl.FLOAT, false, 32, 28); };
  const SON = [.43, .71, 1], BR = [.95, .8, .5], RD = [1, .31, .28], WH = [.9, .94, .98];

  // coastline: land to the west of coastX(z)
  const coastX = z => -3.2 + 1.1 * Math.sin(z * .55) + .55 * Math.sin(z * 1.6 + 1.3) + .25 * Math.sin(z * 3.1);
  const n2 = (x, z) => Math.sin(x * 1.7 + Math.sin(z * .9)) * .5 + Math.sin(z * 2.3 + x * .6) * .3 + Math.sin((x + z) * 4.1) * .12;
  const terr = [], sea = [];
  for (let i = 0; i <= 150; i++) for (let j = 0; j <= 100; j++) {
    const x = -9 + i * .12, z = -6 + j * .12, cx = coastX(z), d = cx - x;
    if (d > 0) { const h = Math.min(1, d / 2.4) ** .8 * (1.05 + n2(x, z) * .55); const k = Math.min(1, h / 1.4), col = [WH[0] * k + SON[0] * (1 - k) * .7, WH[1] * k + SON[1] * (1 - k) * .7, WH[2] * k + SON[2] * (1 - k)];
      terr.push(x, Math.max(.02, h), z, ...col, .42 + k * .5, 2.1); }
    else if (i % 2 === 0 && j % 2 === 0) sea.push(x, 0, z, .3, .5, .75, .16, -1.1);
  }
  // coastline edge
  const edge = []; for (let z = -6; z <= 6; z += .03) { const x = coastX(z); edge.push(x, .02, z, ...SON, .9, 2.2); }
  const terrB = mk(terr), seaB = mk(sea), edgeB = mk(edge);
  // radar station
  const ST = [coastX(-.6) - .35, 0, -.6]; ST[1] = .9;
  const lines = [];
  const L = (a, b, col, al) => lines.push(...a, ...col, al, 1, ...b, ...col, al, 1);
  L([ST[0], 0, ST[2]], ST, BR, .9);
  for (const R of [2.5, 5, 7.5, 10]) for (let a = -100; a < 100; a += 3) { const a0 = a * DEG, a1 = (a + 3) * DEG; L([ST[0] + Math.cos(a0) * R, .01, ST[2] + Math.sin(a0) * R], [ST[0] + Math.cos(a1) * R, .01, ST[2] + Math.sin(a1) * R], SON, R === 10 ? .45 : .22); }
  for (let a = -90; a <= 90; a += 30) L([ST[0], .01, ST[2]], [ST[0] + Math.cos(a * DEG) * 10, .01, ST[2] + Math.sin(a * DEG) * 10], SON, .1);
  // coverage dome
  for (let el = 15; el < 90; el += 15) { const r = 10 * Math.cos(el * DEG), y = 10 * Math.sin(el * DEG) * .55; for (let a = -90; a < 90; a += 4) L([ST[0] + Math.cos(a * DEG) * r, y, ST[2] + Math.sin(a * DEG) * r], [ST[0] + Math.cos((a + 4) * DEG) * r, y, ST[2] + Math.sin((a + 4) * DEG) * r], SON, .07); }
  for (let a = -90; a <= 90; a += 30) for (let el = 0; el < 90; el += 5) { const p = e => [ST[0] + Math.cos(a * DEG) * 10 * Math.cos(e * DEG), 10 * Math.sin(e * DEG) * .55, ST[2] + Math.sin(a * DEG) * 10 * Math.cos(e * DEG)]; L(p(el), p(el + 5), SON, .06); }
  const linesB = mk(lines);
  const sweepB = dyn(), vesB = dyn(), stalkB = dyn(), trailB = dyn(), stB = mk([...ST, ...BR, 1, 4.2]);

  // vessels
  const VES = [
    { id: 'TGT-01', n: 'Crude tanker', k: 'v', x: 3.2, z: 1.6, h: 260, s: .0 },
    { id: 'TGT-02', n: 'Kaveri Star', k: 'v', x: 1.5, z: -3.8, h: 160, s: .16 },
    { id: 'TGT-03', n: 'Arabian Pearl', k: 'v', x: 6.5, z: -1.2, h: 200, s: .12 },
    { id: 'TGT-04', n: 'Nordic Aster', k: 'v', x: 5, z: 4.5, h: 330, s: .2 },
    { id: 'TGT-05', n: 'Fishing vessel', k: 'r', x: .8, z: 2.6, h: 120, s: .06 },
    { id: 'TGT-06', n: 'Tug · Sagar', k: 'v', x: -.4, z: -1.8, h: 30, s: .1 },
    { id: 'UNK-07', n: 'No AIS', k: 'd', x: 7.6, z: 2.4, h: 285, s: .14 },
    { id: 'TGT-08', n: 'Cobalt Mariner', k: 'v', x: 8.2, z: -4.4, h: 225, s: .18 },
    { id: 'UNK-09', n: 'No AIS', k: 'd', x: 4.2, z: -5, h: 20, s: .09 },
  ];
  VES.forEach(v => { v.tr = []; v.tt = 0; });
  const colOf = v => v.k === 'd' ? RD : v.k === 'r' ? BR : SON;
  // labels
  labelsEl.innerHTML = VES.map(v => `<div class="tl ${v.k === 'd' ? 'r' : ''}"><b>${v.id}</b><small>${v.n}</small></div>`).join('');
  const lbl = [...labelsEl.children];
  $('#trkN').textContent = VES.length;
  const tl = $('#trkList');
  tl.innerHTML = VES.map((v, i) => `<div class="trk-row ${v.k === 'd' ? 'r' : ''}"><i style="background:${v.k === 'd' ? 'var(--red)' : v.k === 'r' ? 'var(--brass2)' : 'var(--sonar)'}"></i><span>${v.id}<br/><small>${v.n}</small></span><span class="s" data-i="${i}">—</span></div>`).join('');
  const spEls = [...tl.querySelectorAll('.s')];

  // camera
  let yaw = -.55, pitch = .62, yawV = 0, drag = false, lx = 0, ly = 0, auto = 1;
  cv.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; cv.classList.add('drag'); cv.setPointerCapture(e.pointerId); auto = 0; });
  cv.addEventListener('pointermove', e => { if (!drag) return; yawV = (e.clientX - lx) * .006; yaw += yawV; pitch = Math.max(.22, Math.min(1.25, pitch + (e.clientY - ly) * .004)); lx = e.clientX; ly = e.clientY; });
  const up = () => { drag = false; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

  const persp = (f, a, n, fa) => { const t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; };
  const look = (e, c) => { const z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]], zl = Math.hypot(...z); z.forEach((v, i) => z[i] = v / zl);
    let x = [z[2], 0, -z[0]]; const xl = Math.hypot(...x); x = x.map(v => v / xl); const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]; };
  const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3]; return o; };
  let W = 0, H = 0, PR = 1, MVP = null;
  const size = () => { const r = wrapEl.getBoundingClientRect(); PR = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.round(W * PR); cv.height = Math.round(H * PR); gl.viewport(0, 0, cv.width, cv.height); };
  let ro = null;
  if ('ResizeObserver' in window) { ro = new ResizeObserver(size); ro.observe(wrapEl); } else addEventListener('resize', size);
  size();
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.clearColor(.012, .024, .043, 1);
  let sweep = 0, lastList = 0;
  function frame(dt, now) {
    const t = now / 1000;
    if (!drag) { yaw += yawV; yawV *= .93; auto = Math.min(1, auto + dt * .2); yaw += dt * .05 * auto * (reduce ? 0 : 1); }
    const C = [2.4, 0, 0], R = W < 700 ? 17 : 14.5;
    const eye = [C[0] + Math.cos(yaw) * Math.cos(pitch) * R, Math.sin(pitch) * R, C[2] + Math.sin(yaw) * Math.cos(pitch) * R];
    MVP = mul(persp(40 * DEG, W / H, .1, 100), look(eye, C));
    gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(pg); gl.uniformMatrix4fv(U.m, false, MVP); gl.uniform1f(U.pr, PR); gl.uniform1f(U.t, t);
    // sweep fan
    sweep = (sweep + dt * 1.15) % (Math.PI * 2);
    const fan = [], N = 34; // sweep over the sea side (-90..+90 east)
    const sa = Math.sin(sweep) * 1.55;  // oscillating sector scan
    for (let i = 0; i < N; i++) { const a0 = sa - i * .022, a1 = sa - (i + 1) * .022, al = .32 * (1 - i / N) ** 2;
      fan.push(ST[0], .02, ST[2], ...SON, al, 1, ST[0] + Math.cos(a0) * 10, .02, ST[2] + Math.sin(a0) * 10, ...SON, al * .6, 1, ST[0] + Math.cos(a1) * 10, .02, ST[2] + Math.sin(a1) * 10, ...SON, al * .6, 1); }
    upd(sweepB, fan);
    // vessels
    const vp = [], st = [], tr = [];
    VES.forEach(v => {
      v.x += Math.cos(v.h * DEG) * v.s * dt * .35; v.z += Math.sin(v.h * DEG) * v.s * dt * .35;
      if (v.x > 11 || v.z > 6.5 || v.z < -6.5 || v.x < coastX(v.z) + .4) { v.h = (v.h + 180) % 360; }
      v.tt += dt; if (v.tt > .5) { v.tt = 0; v.tr.push([v.x, v.z]); if (v.tr.length > 26) v.tr.shift(); }
      const c = colOf(v), pulse = v.k === 'd' ? .7 + .3 * Math.sin(t * 5) : 1;
      vp.push(v.x, .32, v.z, ...c, pulse, 5.2, v.x, .02, v.z, ...c, .35, 3.4);
      st.push(v.x, .02, v.z, ...c, .7, 1, v.x, .32, v.z, ...c, .7, 1);
      for (let i = 1; i < v.tr.length; i++) { const a = v.tr[i - 1], b = v.tr[i], al = i / v.tr.length * .5; tr.push(a[0], .02, a[1], ...c, al, 1, b[0], .02, b[1], ...c, al, 1); }
      if (v.tr.length) { const b = v.tr[v.tr.length - 1]; tr.push(b[0], .02, b[1], ...c, .5, 1, v.x, .02, v.z, ...c, .5, 1); }
    });
    upd(vesB, vp); upd(stalkB, st); upd(trailB, tr);
    gl.uniform1f(U.pt, 1); bind(seaB); gl.drawArrays(gl.POINTS, 0, seaB.n); bind(terrB); gl.drawArrays(gl.POINTS, 0, terrB.n); bind(edgeB); gl.drawArrays(gl.POINTS, 0, edgeB.n);
    gl.uniform1f(U.pt, 0); bind(linesB); gl.drawArrays(gl.LINES, 0, linesB.n); bind(sweepB); gl.drawArrays(gl.TRIANGLES, 0, sweepB.n);
    bind(trailB); gl.drawArrays(gl.LINES, 0, trailB.n); bind(stalkB); gl.drawArrays(gl.LINES, 0, stalkB.n);
    gl.uniform1f(U.pt, 1); bind(vesB); gl.drawArrays(gl.POINTS, 0, vesB.n); bind(stB); gl.drawArrays(gl.POINTS, 0, stB.n);
    // labels
    VES.forEach((v, i) => { const x = v.x, y = .42, z = v.z, m = MVP;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const sx = (cx / cw * .5 + .5) * W, sy = (1 - (cy / cw * .5 + .5)) * H;
      lbl[i].style.transform = `translate(${sx + 6}px,${sy - 30}px)`; lbl[i].style.opacity = cw > 0 && sx > 10 && sx < W - 60 ? 1 : 0; });
    if (now - lastList > 700) { lastList = now; VES.forEach((v, i) => spEls[i].textContent = (v.s * 80).toFixed(1) + ' kn'); }
  }
  frame(0, performance.now());
  const stop = whileVisible(wrapEl, frame);
  return () => { stop(); ro?.disconnect(); removeEventListener('resize', size); };
}
