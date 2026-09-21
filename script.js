/* ==========================================================
   Invernadero Xeno · una flor desde la semilla
   JavaScript puro, sin librerías.

   Cómo funciona
   · Todo el crecimiento es una función del tiempo `state.t` (ms).
     Cada frame se calcula el estado de la semilla, las raíces, el
     tallo, las hojas y la flor a partir de `t`. Por eso "Saltar"
     solo acelera el reloj y "Volver a plantar" lo pone a cero.
   · El tallo es una cadena de segmentos cuyos ángulos suman una
     curva base + una flexión (muelle) + una onda de viento.
   · Al terminar (t >= TL.end) se activa la interacción.
   ========================================================== */

(() => {
  'use strict';

  /* ---------- Utilidades ---------- */

  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, r) => clamp((t - r[0]) / (r[1] - r[0]));
  const smooth = (a, b, v) => {
    const x = clamp((v - a) / (b - a));
    return x * x * (3 - 2 * x);
  };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeInQuad = (x) => x * x;
  const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
  const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOutBack = (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const fx1 = (n) => n.toFixed(1);
  const fx2 = (n) => n.toFixed(2);

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  const $ = (sel) => document.querySelector(sel);

  /* ---------- Referencias al DOM ---------- */

  const stageEl = $('#stage');
  const scene = $('#scene');
  const plantLayer = $('#plant');
  const undergroundLayer = $('#underground');
  const seedLayer = $('#seedLayer');
  const fxLayer = $('#fxLayer');
  const moundEl = $('#mound');
  const canvas = $('#fx');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;

  const ui = {
    name: $('#stageName'),
    bar: $('#stageBar'),
    hint: $('#hint'),
    growing: $('#actionsGrowing'),
    ready: $('#actionsReady'),
    skip: $('#btnSkip'),
    gust: $('#btnGust'),
    spores: $('#btnSpores'),
    replay: $('#btnReplay'),
  };

  const reduceMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Geometría y línea de tiempo ---------- */

  const GROUND_Y = 597; // superficie de la tierra
  const SEED = { x: 300, y: 690 }; // posición de la semilla enterrada
  const N = window.innerWidth < 768 ? 24 : 64; // segmentos del tallo
  const STEM_LEN = 452; // longitud total (desde la semilla)

  // Tiempos en milisegundos
  const TL = {
    drop: [300, 1800], // la semilla cae
    glow: [1900, 3800], // la semilla se ilumina
    crack: [3400, 4500], // se agrieta
    stem: [4700, 13800], // crece el tallo
    bud: [13000, 15200], // aparece y se hincha el capullo
    bloom: [15200, 20400], // la flor se abre
    end: 20900, // fin: empieza la interacción
  };

  /* ---------- Tallo: curva base ---------- */

  let S_GROUND = 0.2; // fracción del tallo donde cruza la tierra (se ajusta más abajo)

  function baseAngle(s) {
    const k = smooth(0.06, 0.34, s);
    return k * (0.21 * Math.sin(s * TAU * 0.92 + 0.9) - 0.035);
  }

  function buildChain(bendAmt, waveAmp, time) {
    const pts = new Array(N + 1);
    let x = SEED.x;
    let y = SEED.y - 6;
    pts[0] = { x, y, a: 0, s: 0 };
    const seg = STEM_LEN / N;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      const sr = Math.max(0, (s - S_GROUND) / (1 - S_GROUND));
      const a =
        baseAngle(s) +
        bendAmt * Math.pow(sr, 1.6) +
        waveAmp * Math.sin(time * 1.9 - sr * 4.2) * sr * sr;
      x += Math.sin(a) * seg;
      y -= Math.cos(a) * seg;
      pts[i + 1] = { x, y, a, s: (i + 1) / N };
    }
    pts[0].a = pts[1].a;
    return pts;
  }

  // Punto donde el tallo en reposo cruza la tierra, y hacia dónde apunta la flor
  const REST = buildChain(0, 0, 0);
  for (let i = 1; i <= N; i++) {
    if (REST[i].y <= GROUND_Y) {
      const p0 = REST[i - 1];
      const p1 = REST[i];
      S_GROUND = lerp(p0.s, p1.s, (p0.y - GROUND_Y) / (p0.y - p1.y));
      break;
    }
  }
  const TIP_REST_X = REST[N].x;

  function stemWidth(s) {
    if (s < S_GROUND) return 4.5 + 10.5 * smooth(0, S_GROUND, s);
    const u = (s - S_GROUND) / (1 - S_GROUND);
    return 15 - 6 * Math.pow(u, 0.85);
  }

  function visibleChain(pts, g) {
    const len = g * N;
    const whole = Math.floor(len);
    const out = pts.slice(0, whole + 1);
    if (whole < N && len > whole) {
      const p0 = pts[whole];
      const p1 = pts[whole + 1];
      const k = len - whole;
      out.push({ x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k), a: p1.a, s: g });
    }
    return out;
  }

  function pointAt(pts, s) {
    const f = clamp(s, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(f));
    const k = f - i;
    return {
      x: lerp(pts[i].x, pts[i + 1].x, k),
      y: lerp(pts[i].y, pts[i + 1].y, k),
      a: pts[i + 1].a,
    };
  }

  function stemOutline(vis, taper, shineOnly) {
    const n = vis.length;
    const tipS = vis[n - 1].s;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const p = vis[i];
      let w = stemWidth(p.s) * 0.5;
      w *= lerp(1, 0.16 + 0.84 * smooth(0, 44, (tipS - p.s) * STEM_LEN), taper);
      const nx = Math.cos(p.a);
      const ny = Math.sin(p.a);
      if (shineOnly) {
        left.push(fx1(p.x - nx * w * 0.42) + ' ' + fx1(p.y - ny * w * 0.42));
      } else {
        left.push(fx1(p.x - nx * w) + ' ' + fx1(p.y - ny * w));
        right.push(fx1(p.x + nx * w) + ' ' + fx1(p.y + ny * w));
      }
    }
    if (shineOnly) return 'M' + left.join('L');
    return 'M' + left.join('L') + 'L' + right.reverse().join('L') + 'Z';
  }

  function centerLine(vis) {
    const pts = vis.filter((p) => p.y < GROUND_Y + 2);
    if (pts.length < 2) return '';
    return 'M' + pts.map((p) => fx1(p.x) + ' ' + fx1(p.y)).join('L');
  }

  /* ---------- Decoración de la tierra ---------- */

  (function buildSoil() {
    const rng = mulberry32(11);
    const body = $('#soilBodyDots');
    const top = $('#soilTopDots');
    const tones = ['#2a1530', '#5a3557', '#6d476a', '#241226', '#7d5478'];
    for (let i = 0; i < 150; i++) {
      svgEl(
        'circle',
        {
          cx: fx1(140 + rng() * 320),
          cy: fx1(600 + rng() * 178),
          r: fx2(0.8 + rng() * 2.4),
          fill: tones[Math.floor(rng() * tones.length)],
          opacity: fx2(0.45 + rng() * 0.45),
        },
        body
      );
    }
    // minerales que brillan
    for (let i = 0; i < 9; i++) {
      svgEl(
        'circle',
        {
          class: 'mineral',
          cx: fx1(160 + rng() * 280),
          cy: fx1(640 + rng() * 120),
          r: fx2(1.4 + rng() * 1.3),
          fill: '#7cffea',
          style: `--d:${fx1(2.4 + rng() * 3)}s;--delay:${fx1(-rng() * 4)}s`,
        },
        body
      );
    }
    for (let i = 0; i < 80; i++) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng());
      svgEl(
        'circle',
        {
          cx: fx1(300 + Math.cos(a) * r * 146),
          cy: fx1(597 + Math.sin(a) * r * 13),
          r: fx2(0.7 + rng() * 1.8),
          fill: tones[Math.floor(rng() * tones.length)],
          opacity: fx2(0.5 + rng() * 0.4),
        },
        top
      );
    }
  })();

  /* ---------- Raíces ---------- */

  const ROOTS = [
    { d: 'M300 708 C297 724 304 738 299 758', w: 4.4, t: [4200, 6400] },
    { d: 'M299 716 C280 721 254 728 228 746', w: 3.4, t: [4700, 6900] },
    { d: 'M301 718 C322 723 348 730 374 746', w: 3.4, t: [4850, 7000] },
    { d: 'M298 728 C272 732 246 731 216 722', w: 3.0, t: [5500, 7600] },
    { d: 'M302 730 C328 735 354 732 386 722', w: 3.0, t: [5650, 7700] },
    { d: 'M297 712 C274 709 252 698 232 680', w: 3.0, t: [5900, 7900] },
    { d: 'M303 712 C326 709 348 698 368 680', w: 3.0, t: [6050, 8000] },
    { d: 'M298 744 C288 749 276 754 262 757', w: 2.2, t: [6400, 8200] },
    { d: 'M301 746 C312 751 326 755 340 757', w: 2.2, t: [6500, 8300] },
    { d: 'M252 700 C246 692 244 684 246 674', w: 2.0, t: [7000, 8600] },
    { d: 'M348 700 C354 692 356 684 354 674', w: 2.0, t: [7100, 8700] },
  ].map((r) => {
    const common = { d: r.d, fill: 'none', pathLength: 1, 'stroke-linecap': 'round', 'stroke-dasharray': '1 1' };
    const glow = svgEl('path', { ...common, stroke: '#7cffea', 'stroke-opacity': 0.16, 'stroke-width': r.w + 5 }, undergroundLayer);
    const line = svgEl('path', { ...common, stroke: '#f2e6c0', 'stroke-width': r.w }, undergroundLayer);
    return { ...r, glow, line };
  });

  /* ---------- Semilla ---------- */

  const seedG = svgEl('g', null, seedLayer);
  const seedHalo = svgEl('circle', { r: 36, fill: 'url(#gSeedHalo)', opacity: 0 }, seedG);
  const seedBody = svgEl('g', null, seedG);
  svgEl(
    'path',
    { d: 'M0 -17 C11 -9 13 7 0 17 C-13 7 -11 -9 0 -17Z', fill: 'url(#gSeed)', stroke: '#2e1a0d', 'stroke-width': 1.6, 'stroke-linejoin': 'round' },
    seedBody
  );
  svgEl('path', { d: 'M-5 -8 C-8 -2 -8 5 -4 11', fill: 'none', stroke: '#2e1a0d', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.45 }, seedBody);
  svgEl('path', { d: 'M5 -8 C8 -2 8 5 4 11', fill: 'none', stroke: '#2e1a0d', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.45 }, seedBody);
  svgEl('ellipse', { cx: -4, cy: -6, rx: 2.6, ry: 5, fill: '#fff', opacity: 0.35, transform: 'rotate(20 -4 -6)' }, seedBody);
  const crackEl = svgEl(
    'path',
    { d: 'M0 -15 L-2 -8 L2 -2 L-1 5 L1 12', fill: 'none', stroke: '#b6fff2', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': '1 1', visibility: 'hidden' },
    seedBody
  );

  /* ---------- Planta: capas ---------- */

  const leavesBack = svgEl('g', null, plantLayer);
  const stemShape = svgEl('path', { class: 'stem', fill: 'url(#gStem)', stroke: 'url(#gStemLine)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, plantLayer);
  const stemShine = svgEl('path', { fill: 'none', stroke: '#eaffd0', 'stroke-opacity': 0.28, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, plantLayer);
  const stemHit = svgEl('path', { class: 'stem-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 34, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, plantLayer);
  const leavesFront = svgEl('g', null, plantLayer);
  const head = svgEl('g', { class: 'head', visibility: 'hidden' }, plantLayer);

  /* ---------- Hojas ---------- */

  const LEAF_D = 'M0 0 C14 -26 54 -44 96 -34 C122 -28 142 -12 158 10 C132 26 98 38 62 30 C34 24 12 12 0 0Z';
  const LEAF_SHINE = 'M6 -2 C40 -8 100 -6 150 8 C128 -26 90 -32 60 -30 C30 -26 14 -12 6 -2Z';
  const LEAF_VEINS =
    'M2 0 C40 -8 100 -6 154 9 M34 -4 Q48 -22 66 -30 M62 -6 Q80 -24 100 -30 M34 -2 Q44 12 58 22 M64 -5 Q80 10 96 24 M98 -2 Q112 -14 128 -14';
  const COT_D = 'M0 0 C7 -24 52 -30 66 0 C52 30 7 24 0 0Z';
  const COT_VEINS = 'M4 0 L56 0 M22 0 Q30 -9 40 -11 M22 0 Q30 9 40 11';

  // f = posición sobre el tallo (0 = suelo, 1 = punta)
  const LEAF_DEFS = [
    { f: 0.035, side: 1, size: 1.0, open: 74, kind: 'cot', grad: 'gLeafB' },
    { f: 0.035, side: -1, size: 1.0, open: 74, kind: 'cot', grad: 'gLeafB' },
    { f: 0.2, side: 1, size: 1.0, open: 80, grad: 'gLeafA' },
    { f: 0.31, side: -1, size: 1.06, open: 76, grad: 'gLeafB' },
    { f: 0.46, side: 1, size: 0.94, open: 68, grad: 'gLeafB' },
    { f: 0.58, side: -1, size: 0.86, open: 62, grad: 'gLeafA' },
    { f: 0.73, side: 1, size: 0.68, open: 54, grad: 'gLeafA' },
    { f: 0.84, side: -1, size: 0.56, open: 48, grad: 'gLeafB' },
  ];

  const stemG = (t) => easeInOutSine(prog(t, TL.stem));
  function timeWhenStemReaches(s) {
    for (let t = TL.stem[0]; t <= TL.stem[1]; t += 10) if (stemG(t) >= s) return t;
    return TL.stem[1];
  }
  const T_EMERGE = timeWhenStemReaches(S_GROUND);

  const leaves = LEAF_DEFS.map((d, i) => {
    const s = S_GROUND + d.f * (1 - S_GROUND);
    const isCot = d.kind === 'cot';
    const g = svgEl('g', { class: 'leaf', 'data-i': i, visibility: 'hidden' }, d.side > 0 ? leavesFront : leavesBack);
    svgEl('path', { d: isCot ? COT_D : LEAF_D, fill: `url(#${d.grad})`, stroke: '#0a4a37', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, g);
    if (!isCot) svgEl('path', { d: LEAF_SHINE, fill: '#dfffe6', opacity: 0.16, 'pointer-events': 'none' }, g);
    svgEl('path', { d: isCot ? COT_VEINS : LEAF_VEINS, fill: 'none', stroke: '#8dffe0', 'stroke-width': 1.4, 'stroke-linecap': 'round', opacity: 0.55, 'pointer-events': 'none' }, g);
    return {
      ...d,
      i,
      g,
      s,
      len: isCot ? 66 : 158,
      t0: timeWhenStemReaches(s) + 120,
      dur: isCot ? 1700 : 2500 + d.size * 500,
      phase: rand(0, TAU),
      off: 0, // desviación por muelle (grados)
      vel: 0,
      tipX: 0,
      tipY: 0,
    };
  });

  /* ---------- Flor ---------- */

  const flowerHalo = svgEl('circle', { r: 150, fill: 'url(#gHalo)', opacity: 0, 'pointer-events': 'none' }, head);
  const calyxBack = svgEl('g', null, head);
  const petalsOuterG = svgEl('g', null, head);
  const petalsInnerG = svgEl('g', null, head);
  const discG = svgEl('g', null, head);
  const calyxFront = svgEl('g', null, head);
  svgEl('circle', { r: 84, fill: 'transparent' }, head); // zona táctil

  const PETAL_D = 'M0 0 C15 -8 19 -38 9 -64 C6 -73 3 -78 0 -78 C-3 -78 -6 -73 -9 -64 C-19 -38 -15 -8 0 0Z';
  const PETAL_VEIN = 'M0 -6 L0 -58';
  const SEPAL_D = 'M0 0 C11 -8 15 -28 0 -48 C-15 -28 -11 -8 0 0Z';

  function buildPetals(parent, n, offsetDeg, fill, len, wid) {
    const out = [];
    for (let i = 0; i < n; i++) {
      let a = (i * 360) / n + offsetDeg;
      a = ((((a + 180) % 360) + 360) % 360) - 180; // (-180, 180]
      const g = svgEl('g', null, parent);
      svgEl('path', { d: PETAL_D, fill: `url(#${fill})`, stroke: '#e08800', 'stroke-width': 1.3, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, g);
      svgEl('path', { d: PETAL_VEIN, fill: 'none', stroke: '#e08800', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: 0.35, 'vector-effect': 'non-scaling-stroke' }, g);
      out.push({ g, a, stagger: 0.36 * (Math.abs(a) / 180), len, wid, ph: rand(0, TAU) });
    }
    return out;
  }
  const petalsOuter = buildPetals(petalsOuterG, 13, 0, 'gPetalOuter', 1.0, 1.0);
  const petalsInner = buildPetals(petalsInnerG, 13, 180 / 13, 'gPetalInner', 0.72, 1.1);

  const sepalsBack = [];
  const sepalsFront = [];
  for (let i = 0; i < 7; i++) {
    const attrs = { d: SEPAL_D, fill: 'url(#gSepal)', stroke: '#0a4a37', 'stroke-width': 1.2, 'stroke-linejoin': 'round' };
    sepalsBack.push(svgEl('path', attrs, calyxBack));
    sepalsFront.push(svgEl('path', attrs, calyxFront));
  }

  // Disco central: espiral de Fibonacci (ángulo áureo) + núcleo luminoso
  svgEl('circle', { r: 25, fill: 'url(#gDisc)', stroke: '#7a3a00', 'stroke-width': 1.5 }, discG);
  for (let k = 1; k <= 58; k++) {
    const r = 2.95 * Math.sqrt(k);
    if (r > 22) break;
    const th = k * 2.39996;
    svgEl(
      'circle',
      { cx: fx1(r * Math.cos(th)), cy: fx1(r * Math.sin(th)), r: fx2(0.9 + 0.5 * (1 - k / 58)), fill: k % 3 ? '#ffcb55' : '#ffe7a0', opacity: 0.9 },
      discG
    );
  }
  const coreEl = svgEl('circle', { r: 14, fill: 'url(#gCore)' }, discG);
  const scanEl = svgEl('circle', { r: 31, fill: 'none', stroke: '#7cffea', 'stroke-width': 1.4, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round', opacity: 0 }, discG);

  /* ---------- Estado ---------- */

  const state = { t: 0, speed: 1, ready: false };
  const ev = {}; // eventos únicos ya disparados
  let clock = 0; // segundos reales (para movimientos ambientales)
  let last = 0;

  let bend = 0;
  let bendV = 0;
  let wind = 0;
  let windDir = 1;
  let hsOff = 0;
  let hsV = 0;
  let hoverK = 0;
  let hover = false;
  let hoverLeaf = -1;
  let ripple = 0;
  let flash = 0;
  let headLook = 0;
  let pointer = null;
  let pointerIn = false;
  let drag = null;
  const headPos = { x: 300, y: 260 };
  let bloomVar = -1;
  let stageLabel = '';

  const rings = [];

  /* ---------- Conversión de coordenadas ---------- */

  function clientToSvg(cx, cy) {
    const m = scene.getScreenCTM && scene.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function svgToClient(x, y) {
    const m = scene.getScreenCTM && scene.getScreenCTM();
    if (!m) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }
  function unit() {
    const m = scene.getScreenCTM && scene.getScreenCTM();
    return m ? m.a : 1;
  }

  /* ---------- Partículas (canvas) ---------- */

  const particles = [];
  const motes = [];
  let cw = 0;
  let ch = 0;
  const sprites = {};

  function makeSprite(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g) return null;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    gr.addColorStop(0.25, `rgba(${rgb},0.55)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

function resizeCanvas() {
    if (!ctx) return;
    // Si la pantalla es estrecha (móvil), forzamos un pixel ratio de 1 para evitar sobrecargar la memoria VRAM
    const isMobile = window.innerWidth < 768;
    const dpr = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function emit(o) {
    if (!ctx || particles.length > 420) return;
    particles.push({
      kind: 'glow',
      sprite: 'gold',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      g: 0,
      drag: 0,
      sway: 0,
      wob: rand(1, 3),
      ph: rand(0, TAU),
      alpha: 1,
      size: 12,
      life: 2,
      max: 2,
      ...o,
    });
    const p = particles[particles.length - 1];
    p.max = p.life;
  }

  function spawnSpores(x, y, count, power = 1) {
    if (!ctx) return;
    const c = svgToClient(x, y);
    const ks = unit();
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(30, 150) * ks * power;
      emit({
        sprite: Math.random() < 0.68 ? 'gold' : Math.random() < 0.6 ? 'mint' : 'violet',
        x: c.x + rand(-10, 10) * ks,
        y: c.y + rand(-10, 10) * ks,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40 * ks,
        g: -14 * ks,
        drag: 1.1,
        sway: 18 * ks,
        size: rand(9, 24) * ks,
        life: rand(2.4, 5.2),
      });
    }
  }

  function puff(x, y, count) {
    if (!ctx) return;
    const c = svgToClient(x, y);
    const ks = unit();
    for (let i = 0; i < count; i++) {
      emit({
        kind: 'dirt',
        x: c.x + rand(-10, 10) * ks,
        y: c.y,
        vx: rand(-70, 70) * ks,
        vy: rand(-150, -40) * ks,
        g: 340 * ks,
        drag: 0.6,
        size: rand(1.6, 4.2) * ks,
        life: rand(0.7, 1.3),
        color: Math.random() < 0.5 ? '#6d476a' : '#3d2340',
      });
    }
  }

  function windBurst() {
    if (!ctx) return;
    const ks = unit();
    for (let i = 0; i < 34; i++) {
      const fromLeft = windDir > 0;
      emit({
        sprite: Math.random() < 0.6 ? 'mint' : 'gold',
        x: fromLeft ? -20 : cw + 20,
        y: rand(ch * 0.15, ch * 0.75),
        vx: windDir * rand(260, 560),
        vy: rand(-30, 30),
        drag: 0.2,
        sway: 30 * ks,
        size: rand(6, 16) * ks,
        life: rand(1.6, 3),
        alpha: 0.85,
      });
    }
  }

  function initMotes() {
    motes.length = 0;
    if (!ctx || reduceMotion) return;
    const maxMotes = window.innerWidth < 768 ? 12 : 44;
    for (let i = 0; i < maxMotes; i++) {
      motes.push({
        x: rand(0, window.innerWidth),
        y: rand(0, window.innerHeight),
        vy: rand(5, 16),
        size: rand(6, 18),
        sprite: Math.random() < 0.65 ? 'mint' : 'violet',
        a: rand(0.1, 0.34),
        ph: rand(0, TAU),
        w: rand(0.3, 0.9),
      });
    }
  }

  function stepAndDrawParticles(dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);

    // Evitar la fusión aditiva costosa ('lighter') en dispositivos móviles
    ctx.globalCompositeOperation = window.innerWidth < 768 ? 'source-over' : 'lighter';
    for (const m of motes) {
      m.y -= m.vy * dt;
      if (m.y < -24) {
        m.y = ch + 24;
        m.x = rand(0, cw);
      }
      const x = m.x + Math.sin(clock * m.w + m.ph) * 14;
      const spr = sprites[m.sprite];
      if (spr) {
        ctx.globalAlpha = m.a * (0.7 + 0.3 * Math.sin(clock * 1.3 + m.ph));
        ctx.drawImage(spr, x - m.size / 2, m.y - m.size / 2, m.size, m.size);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += (p.vx + Math.sin(clock * p.wob + p.ph) * p.sway) * dt;
      p.y += p.vy * dt;
    }

    for (const p of particles) {
      if (p.kind !== 'glow') continue;
      const k = p.life / p.max;
      const a = p.alpha * Math.min(1, (1 - k) * 9) * Math.min(1, k * 2.2);
      const spr = sprites[p.sprite];
      if (!spr || a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(spr, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const p of particles) {
      if (p.kind !== 'dirt') continue;
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Ondas de energía (SVG) ---------- */

  function addRing(o) {
    const el = svgEl(
      'ellipse',
      { cx: o.x, cy: o.y, rx: o.r0, ry: o.r0 * (o.ry || 1), fill: 'none', stroke: o.color || '#7cffea', 'stroke-width': o.width || 2.5, opacity: 0.9 },
      fxLayer
    );
    rings.push({ el, r0: o.r0, r1: o.r1, ry: o.ry || 1, t0: clock, dur: (o.dur || 900) / 1000 });
  }

  function stepRings() {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const k = (clock - r.t0) / r.dur;
      if (k >= 1) {
        r.el.remove();
        rings.splice(i, 1);
        continue;
      }
      const rad = lerp(r.r0, r.r1, easeOutCubic(k));
      r.el.setAttribute('rx', fx1(rad));
      r.el.setAttribute('ry', fx1(rad * r.ry));
      r.el.setAttribute('opacity', fx2((1 - k) * 0.9));
    }
  }

  /* ---------- Interacciones ---------- */

  function kickLeaf(i, power) {
    const lf = leaves[i];
    if (!lf) return;
    lf.vel += (Math.random() < 0.5 ? -1 : 1) * 260 * power * lf.size;
  }

  function sparkleLeaf(i) {
    const lf = leaves[i];
    spawnSpores(lf.tipX, lf.tipY, 7, 0.5);
  }

  function burstFlower() {
    ripple = Math.min(1.4, ripple + 1);
    flash = 1;
    hsV += 2.4;
    addRing({ x: headPos.x, y: headPos.y, r0: 24, r1: 170, dur: 950, color: '#ffe27a', width: 3 });
    addRing({ x: headPos.x, y: headPos.y, r0: 14, r1: 110, dur: 700, color: '#7cffea', width: 2 });
    spawnSpores(headPos.x, headPos.y, 46);
  }

  function gust() {
    wind = 1;
    windDir = Math.random() < 0.5 ? -1 : 1;
    windBurst();
    leaves.forEach((lf, i) => kickLeaf(i, 0.7));
  }

  function markInteracted() {
    ui.hint.classList.add('is-faded');
  }

  scene.addEventListener('pointermove', (e) => {
    const p = clientToSvg(e.clientX, e.clientY);
    if (p) {
      pointer = p;
      pointerIn = true;
    }
    if (!state.ready) return;
    if (drag && e.pointerId === drag.id) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
        drag.moved = true;
        stageEl.classList.add('is-dragging');
        markInteracted();
      }
      return;
    }
    if (e.pointerType === 'touch') return;
    const t = e.target;
    const leafEl = t.closest ? t.closest('.leaf') : null;
    const idx = leafEl ? Number(leafEl.dataset.i) : -1;
    if (idx !== hoverLeaf) {
      hoverLeaf = idx;
      if (idx >= 0) kickLeaf(idx, 0.55);
    }
    const onHead = !!(t.closest && t.closest('.head'));
    if (onHead !== hover) {
      hover = onHead;
      if (onHead) ripple = Math.min(1.2, ripple + 0.55);
    }
  });

  scene.addEventListener('pointerleave', () => {
    pointerIn = false;
    hover = false;
    hoverLeaf = -1;
  });

  scene.addEventListener('pointerdown', (e) => {
    if (!state.ready) return;
    const t = e.target;
    const leafEl = t.closest ? t.closest('.leaf') : null;
    if (leafEl) {
      const i = Number(leafEl.dataset.i);
      kickLeaf(i, 1.4);
      sparkleLeaf(i);
      markInteracted();
      return;
    }
    const onHead = !!(t.closest && t.closest('.head'));
    if (onHead || (t.closest && t.closest('.stem-hit'))) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, head: onHead };
      try {
        scene.setPointerCapture(e.pointerId);
      } catch (err) {
        /* no pasa nada */
      }
    }
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, head: onHead } = drag;
    drag = null;
    stageEl.classList.remove('is-dragging');
    try {
      scene.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* no pasa nada */
    }
    if (cancelled) return;
    if (moved) {
      ripple = Math.min(1.2, ripple + 0.5); // vuelve vibrando
    } else if (onHead) {
      burstFlower();
      markInteracted();
    }
  }
  scene.addEventListener('pointerup', (e) => endDrag(e, false));
  scene.addEventListener('pointercancel', (e) => endDrag(e, true));

  ui.skip.addEventListener('click', () => {
    state.speed = 8;
    ui.skip.disabled = true;
  });
  ui.gust.addEventListener('click', () => {
    gust();
    markInteracted();
  });
  ui.spores.addEventListener('click', () => {
    burstFlower();
    markInteracted();
  });
  ui.replay.addEventListener('click', reset);

  /* ---------- Fases de la interfaz ---------- */

  const STAGES = [
    [0, 'Siembra'],
    [1900, 'Germinación'],
    [4300, 'Raíces'],
    [T_EMERGE, 'Brote'],
    [T_EMERGE + 2600, 'Hojas'],
    [TL.bud[0], 'Capullo'],
    [TL.bloom[0], 'Floración'],
    [TL.end, 'Planta lista'],
  ];

  function setReady(silent) {
    state.ready = true;
    stageEl.classList.add('is-ready');
    const hadFocus = document.activeElement === ui.skip;
    ui.growing.hidden = true;
    ui.ready.hidden = false;
    ui.hint.textContent = 'Toca la flor, roza las hojas o arrastra el tallo.';
    ui.hint.classList.remove('is-faded');
    if (hadFocus) ui.gust.focus();
    if (!silent) {
      addRing({ x: headPos.x, y: headPos.y, r0: 30, r1: 200, dur: 1400, color: '#ffe27a', width: 3 });
      spawnSpores(headPos.x, headPos.y, 22, 0.6);
    }
  }

  function reset() {
    const hadFocus = document.activeElement === ui.replay;
    state.t = 0;
    state.speed = 1;
    state.ready = false;
    Object.keys(ev).forEach((k) => delete ev[k]);
    particles.length = 0;
    rings.forEach((r) => r.el.remove());
    rings.length = 0;
    bend = bendV = wind = ripple = flash = hsOff = hsV = hoverK = headLook = 0;
    hover = false;
    hoverLeaf = -1;
    drag = null;
    leaves.forEach((lf) => {
      lf.off = 0;
      lf.vel = 0;
    });
    stageEl.classList.remove('is-ready', 'is-dragging');
    ui.growing.hidden = false;
    ui.ready.hidden = true;
    ui.skip.disabled = false;
    ui.hint.textContent = '';
    if (hadFocus) ui.skip.focus();
  }

  /* ---------- Render por frame ---------- */

  function render(dt) {
    const t = state.t;
    const idle = reduceMotion ? 0 : 1;

    /* --- Semilla --- */
    const dropP = prog(t, TL.drop);
    const sy = lerp(400, SEED.y, easeInQuad(dropP));
    const sx = SEED.x + Math.sin(dropP * 9) * 6 * (1 - dropP);
    const rot = lerp(-28, 0, easeOutCubic(dropP));
    const landK = clamp((t - TL.drop[1]) / 500);
    const squash = Math.sin(landK * Math.PI * 3) * 0.16 * (1 - landK);
    const crack = prog(t, TL.crack);
    const glowK = prog(t, TL.glow);
    const shrink = lerp(1, 0.86, prog(t, [6000, 12000]));
    const seedScale = 1.2 * shrink;

    seedG.setAttribute('transform', `translate(${fx1(sx)} ${fx1(sy)})`);
    seedG.setAttribute('opacity', fx2(smooth(0, 350, t)));
    seedBody.setAttribute(
      'transform',
      `rotate(${fx1(rot)}) scale(${fx2(seedScale * (1 + squash + 0.1 * crack))} ${fx2(seedScale * (1 - squash))})`
    );
    seedBody.setAttribute('opacity', fx2(lerp(1, 0.55, prog(t, [6000, 12000]))));
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.008);
    seedHalo.setAttribute('opacity', fx2(glowK * (0.35 + 0.4 * pulse) * (1 - 0.85 * smooth(9000, 13000, t))));
    seedHalo.setAttribute('transform', `scale(${fx2(0.8 + 0.6 * glowK + 0.08 * pulse)})`);
    crackEl.setAttribute('visibility', crack > 0 ? 'visible' : 'hidden');
    crackEl.setAttribute('stroke-dashoffset', fx2(1 - crack));

    if (!ev.land && sy >= 586) {
      ev.land = true;
      puff(SEED.x, GROUND_Y - 6, 16);
      addRing({ x: SEED.x, y: GROUND_Y, r0: 8, r1: 70, ry: 0.26, dur: 1000, color: '#c8a4ff', width: 2 });
    }
    if (!ev.crack && t >= TL.crack[0]) {
      ev.crack = true;
      addRing({ x: SEED.x, y: SEED.y, r0: 10, r1: 62, dur: 1100, color: '#7cffea', width: 2 });
    }

    /* --- Raíces --- */
    for (const r of ROOTS) {
      const g = easeOutCubic(prog(t, r.t));
      const vis = g > 0.002 ? 'visible' : 'hidden';
      const off = fx2(1 - g);
      r.line.setAttribute('visibility', vis);
      r.glow.setAttribute('visibility', vis);
      r.line.setAttribute('stroke-dashoffset', off);
      r.glow.setAttribute('stroke-dashoffset', off);
    }

    /* --- Física del tallo (muelle + viento) --- */
    wind *= Math.exp(-dt / 1.4);
    if (wind < 0.002) wind = 0;

    let target = 0;
    if (state.ready) {
      if (drag && pointer) target = clamp((pointer.x - TIP_REST_X) / 125, -0.9, 0.9);
      else if (pointerIn && pointer) target = clamp((pointer.x - TIP_REST_X) / 320, -1, 1) * 0.15;
    }
    target += idle * 0.03 * Math.sin(clock * 0.62) + windDir * 0.34 * wind * (0.6 + 0.4 * Math.sin(clock * 5));
    bendV += (42 * (target - bend) - 5.2 * bendV) * dt;
    bend += bendV * dt;
    const waveAmp = idle * 0.028 + 0.11 * wind;

    const pts = buildChain(bend, waveAmp, clock);
    const g = stemG(t);

    /* --- Tallo --- */
    const budK = prog(t, TL.bud);
    const taper = 1 - clamp(budK * 3);
    if (g > 0.004) {
      const vis = visibleChain(pts, g);
      stemShape.setAttribute('d', stemOutline(vis, taper, false));
      stemShine.setAttribute('d', stemOutline(vis, taper, true));
      stemHit.setAttribute('d', state.ready ? centerLine(vis) : '');
      stemShape.removeAttribute('visibility');
      stemShine.removeAttribute('visibility');
    } else {
      stemShape.setAttribute('visibility', 'hidden');
      stemShine.setAttribute('visibility', 'hidden');
      stemHit.setAttribute('d', '');
    }
    const vis = visibleChain(pts, Math.max(g, 0.02));
    const tip = vis[vis.length - 1];

    // Montículo alrededor del punto por donde el tallo sale de la tierra
    let gx = SEED.x;
    for (let i = 1; i <= N; i++) {
      if (pts[i].y <= GROUND_Y) {
        gx = lerp(pts[i - 1].x, pts[i].x, (pts[i - 1].y - GROUND_Y) / (pts[i - 1].y - pts[i].y));
        break;
      }
    }
    const moundK = easeOutCubic(clamp((t - (T_EMERGE - 700)) / 1400));
    moundEl.setAttribute('transform', `translate(${fx1(gx)} ${GROUND_Y + 1}) scale(${fx2(moundK)} ${fx2(moundK)})`);

    if (!ev.emerge && t >= T_EMERGE) {
      ev.emerge = true;
      puff(gx, GROUND_Y - 2, 14);
      addRing({ x: gx, y: GROUND_Y, r0: 8, r1: 64, ry: 0.26, dur: 1000, color: '#7cffea', width: 2 });
    }

    /* --- Hojas --- */
    for (const lf of leaves) {
      const u = prog(t, [lf.t0, lf.t0 + lf.dur]);
      if (u <= 0) {
        lf.g.setAttribute('visibility', 'hidden');
        continue;
      }
      lf.g.setAttribute('visibility', 'visible');

      // muelle de la hoja (al tocarla)
      lf.vel += (-90 * lf.off - 6 * lf.vel) * dt;
      lf.off += lf.vel * dt;

      const p = pointAt(pts, lf.s);
      const e = clamp(easeOutBack(u), 0, 1.15);
      const curl = 7 * Math.sin(u * Math.PI * 2.5) * (1 - u);
      const open = lerp(4, lf.open, e) + curl;
      const sway =
        idle * (Math.sin(clock * 1.35 + lf.phase) * 2.2 + Math.sin(clock * 2.7 + lf.phase * 1.7) * 0.9) * (1 + wind * 3);
      const inertia = -bendV * 7 * lf.size;
      const rotDeg = -90 + p.a * DEG + lf.side * open + sway + inertia + lf.off;
      const sc = lf.size * lerp(0.05, 1, easeOutCubic(u));
      const wid = lerp(0.35, 1, easeOutCubic(u));

      lf.g.setAttribute(
        'transform',
        `translate(${fx1(p.x)} ${fx1(p.y)}) rotate(${fx1(rotDeg)}) scale(${fx2(sc)} ${fx2(sc * lf.side * wid)})`
      );
      const rr = (rotDeg / DEG);
      lf.tipX = p.x + Math.cos(rr) * lf.len * sc * 0.9;
      lf.tipY = p.y + Math.sin(rr) * lf.len * sc * 0.9;
    }

    /* --- Flor --- */
    const bloom = easeInOutCubic(prog(t, TL.bloom));
    if (budK <= 0) {
      head.setAttribute('visibility', 'hidden');
    } else {
      head.setAttribute('visibility', 'visible');

      // muelles del cabezal
      hsV += (-130 * hsOff - 9 * hsV) * dt;
      hsOff += hsV * dt;
      hoverK += ((hover ? 1 : 0) - hoverK) * Math.min(1, dt * 8);
      ripple *= Math.exp(-dt * 1.6);
      flash *= Math.exp(-dt * 2.4);
      const lookTarget =
        state.ready && pointerIn && pointer && !drag ? clamp((pointer.x - tip.x) / 300, -1, 1) * 10 : 0;
      headLook += (lookTarget - headLook) * Math.min(1, dt * 6);

      const budScale = easeOutBack(budK) * 1.02;
      const hs = budScale * lerp(1, 1.32, bloom) * (1 + hsOff + 0.045 * hoverK);
      const rotHead = tip.a * DEG + headLook;
      head.setAttribute('transform', `translate(${fx1(tip.x)} ${fx1(tip.y)}) rotate(${fx1(rotHead)}) scale(${fx2(hs)} ${fx2(hs * 0.95)})`);
      headPos.x = tip.x;
      headPos.y = tip.y;

      flowerHalo.setAttribute('opacity', fx2(0.5 * smooth(0.3, 0.9, bloom) + 0.3 * flash));

      // Sépalos: cierran el capullo y se abren al florecer
      const so = easeInOutCubic(prog(bloom, [0, 0.45]));
      for (let i = 0; i < 7; i++) {
        const ang = lerp((i - 3) * 9, (i - 3) * 46, so);
        const tr = `rotate(${fx1(ang)}) scale(${fx2(lerp(1.05, 0.9, so))} ${fx2(lerp(1, 0.8, so))})`;
        sepalsBack[i].setAttribute('transform', tr);
        sepalsFront[i].setAttribute('transform', tr);
      }
      calyxFront.setAttribute('opacity', fx2(1 - smooth(0.1, 0.4, bloom)));

      // Pétalos: se abren en abanico desde arriba hacia abajo
      updatePetals(petalsOuter, bloom);
      updatePetals(petalsInner, bloom);

      // Disco central
      const ds = easeOutBack(prog(bloom, [0.3, 0.72]));
      discG.setAttribute('transform', `scale(${fx2(Math.max(ds, 0.001))})`);
      discG.setAttribute('visibility', ds > 0.001 ? 'visible' : 'hidden');
      coreEl.setAttribute('r', fx2(14 * (1 + idle * 0.08 * Math.sin(clock * 2.2) + flash * 0.45)));
      scanEl.setAttribute('opacity', fx2(0.55 * smooth(0.75, 1, bloom)));
      scanEl.setAttribute('transform', `rotate(${fx1(clock * 14)})`);
    }

    if (!ev.bloom && bloom > 0.02) {
      ev.bloom = true;
      addRing({ x: headPos.x, y: headPos.y, r0: 20, r1: 150, dur: 1200, color: '#ffe27a', width: 2.5 });
    }

    /* --- Resplandor del fondo --- */
    const bv = Math.round(bloom * 100) / 100;
    if (bv !== bloomVar) {
      bloomVar = bv;
      stageEl.style.setProperty('--bloom', String(bv));
    }
  }

  function updatePetals(list, bloom) {
    for (const p of list) {
      const e = easeOutCubic(clamp((bloom - 0.04 - p.stagger) / 0.6));
      const ang = p.a * e;
      const breath = 1 + 0.018 * Math.sin(clock * 1.3 + p.ph);
      const wave = ripple * 0.09 * Math.sin(clock * 13 - p.a * 0.035);
      const l = lerp(0.66, 1, e) * p.len * (breath + wave);
      const w = lerp(0.8, 1, e) * p.wid;
      p.g.setAttribute('transform', `rotate(${fx1(ang)}) scale(${fx2(w)} ${fx2(l)})`);
    }
  }

  function updateHud() {
    const t = state.t;
    let label = STAGES[0][1];
    for (const [from, name] of STAGES) if (t >= from) label = name;
    if (label !== stageLabel) {
      stageLabel = label;
      ui.name.textContent = label;
    }
    ui.bar.style.transform = `scaleX(${fx2(clamp(t / TL.end))})`;
  }

/* ---------- Bucle principal ---------- */
  
  // Detectamos si es móvil para asignarle 30 FPS, en escritorio lo dejamos a 60 FPS o más
  const targetFPS = 60;
  const frameDelay = 1000 / targetFPS;
  let lastDrawTime = 0;

  function frame(now) {
    if (!last) last = now;
    
    // Regulador de fotogramas: si no ha pasado el tiempo suficiente, saltamos al siguiente frame
    const elapsed = now - lastDrawTime;
    if (elapsed < frameDelay) {
      requestAnimationFrame(frame);
      return;
    }
    // Compensar el tiempo extra para mantener el ritmo exacto
    lastDrawTime = now - (elapsed % frameDelay);

    // Calculamos el tiempo transcurrido (Delta Time)
    const rawDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock += rawDt;

    if (!state.ready) {
      state.t = Math.min(TL.end, state.t + rawDt * 1000 * state.speed);
    }

    render(rawDt);
    stepRings();
    updateHud();
    stepAndDrawParticles(rawDt);

    if (!state.ready && state.t >= TL.end) setReady(false);

    requestAnimationFrame(frame);
  }

  /* ---------- Arranque ---------- */

  (function buildStars() {
    const box = $('#stars');
    if (!box) return;
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('i');
      const size = rand(1, 2.6);
      s.style.cssText =
        `left:${fx1(rand(0, 100))}%;top:${fx1(rand(0, 78))}%;width:${fx1(size)}px;height:${fx1(size)}px;` +
        `--d:${fx1(rand(2.5, 6))}s;--delay:${fx1(rand(-6, 0))}s;opacity:${fx2(rand(0.25, 0.8))}`;
      box.appendChild(s);
    }
  })();

  if (ctx) {
    sprites.gold = makeSprite('255,226,122');
    sprites.mint = makeSprite('124,255,234');
    sprites.violet = makeSprite('190,170,255');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }
  initMotes();

  if (reduceMotion) {
    // Sin animación de crecimiento: se muestra la planta terminada
    state.t = TL.end;
    ev.land = ev.crack = ev.emerge = ev.bloom = true;
    render(0.016);
    setReady(true);
  }

  requestAnimationFrame(frame);
})();
