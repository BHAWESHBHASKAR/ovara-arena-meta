/**
 * Agent: a magnifying glass hovering over a fanned stack of four sheets, the
 * way a model reads an inbox: pixel by pixel. The glass follows the pointer on
 * a spring; a dashed drop and a dot mark the point it reads, and the line under
 * it takes the bright stroke. The sheet being read slides out of the stack and
 * its neighbours follow a little, staggered from it. Each sheet is numbered by
 * a row of dots on its edge. The slider is how far the read sheet slides out.
 */
const {
  Cam, clamp, circ, facing, fit, hull, open, poly, prism, proj, rings, ringAt, run, seg, unproj,
  spring, stepS, tween, tset, tval, tdone, flatDot, mk, place, pointer, put, register, disposer, solid,
} = HL;

const N = 4, STEP = 18, FAN = -5, PW = 56, PH = 72, TH = 1.2, LZ = 30, R = 15, RI = 11.5, RT = 2.5;
const REST = 2, RX = 44, RY = 21;
const X = (i) => i * STEP, Y = (i) => i * FAN, Z = (i) => i * TH;

/** Signed area of a screen polygon, to set the winding of the lens's hole. */
const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
const shift = (ring, dx, dy) => ring.map((q) => ({ ...q, u: q.u + dx, v: q.v + dy }));

/** The rule lines of a sheet, as [x along the page, y from, y to]: a short title, then body lines, the last one short. */
const LINES = [];
for (let k = 0; k < 10; k++) LINES.push([8 + 6 * k, 6, k === 0 ? 26 : k === 9 ? 30 : k % 3 === 2 ? 42 : 50]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let SL = value;
  const C = Cam(45, 0.5, 2.15);
  fit(C, [[-22, -9, 0], [X(N - 1) + PH, Y(N - 1), 0], [-22, PW, 0], [X(N - 1) + PH, PW, 0],
    [-19, -12 - R - 24, LZ], [123 + R, 53, LZ], [-19 - R, 53, LZ], [123, 53 + R, LZ - RT]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg), sheets = [];
  for (let i = 0; i < N; i++) {
    const el = solid(g);
    const lines = mk("path", { class: "nf lo" }, el.g), bright = mk("path", { class: "nf hi" }, el.g);
    const dots = [];
    for (let k = 0; k <= i; k++) dots.push(flatDot(el.g, C, 0.6, "dot off"));
    sheets.push({ i, el, lines, bright, dots, tw: tween(0), drawn: NaN, line: -1, lineDrawn: -2 });
  }

  // The glass and what it reads, above the whole stack: drop, dot, handle, rim.
  const drop = mk("path", { class: "dash nf" }, g);
  const dot = flatDot(g, C, 0.9, "dot");
  const handle = solid(g);
  const rim = mk("path", { class: "sil" }, g), wall = mk("path", { class: "nf lo" }, g);
  const crease = mk("path", { class: "nf lo" }, g), glint = mk("path", { class: "nf lo" }, g);
  const outer = circ(R, 24), inner = circ(RI, 24);
  const lx = spring(RX), ly = spring(RY);
  let act = REST, rx = RX, ry = RY;

  function drawSheet(s, now) {
    const d = tval(s.tw, now);
    if (d !== s.drawn) {
      s.drawn = d;
      const x0 = X(s.i) + d, y0 = Y(s.i), z = Z(s.i) + TH;
      const [ring, inn] = rings(x0, y0, x0 + PH, y0 + PW, 2.4, 0.8);
      put(s.el, prism(P, front, ring, inn, Z(s.i), z));
      s.lines.setAttribute("d", LINES.map(([u, a, b]) => seg(P(x0 + u, y0 + a, z), P(x0 + u, y0 + b, z))).join(""));
      s.dots.forEach((el, k) => place(el, P(x0 + 3.5, y0 + PW - 4 - k * 3.2, z)));
      s.lineDrawn = -2;
    }
    if (s.line !== s.lineDrawn) {
      s.lineDrawn = s.line;
      const x0 = X(s.i) + d, y0 = Y(s.i), z = Z(s.i) + TH, L = LINES[s.line];
      s.bright.setAttribute("d", L ? seg(P(x0 + L[0], y0 + L[1], z), P(x0 + L[0], y0 + L[2], z)) : "");
    }
  }

  function drawLens() {
    const x = lx.x, y = ly.x, z = Z(act) + TH;
    const [hr, hi] = rings(x - 3, y - R - 22, x + 3, y - R + 2, 3, 0.8);
    put(handle, prism(P, front, hr, hi, LZ - RT + 0.4, LZ - 0.4));
    const o = shift(outer, x, y), n = shift(inner, x, y);
    const body = hull(ringAt(P, o, LZ - RT).concat(ringAt(P, o, LZ)));
    let hole = ringAt(P, n, LZ);
    if (Math.sign(area(hole)) === Math.sign(area(body))) hole = hole.slice().reverse();
    rim.setAttribute("d", poly(body) + poly(hole));
    wall.setAttribute("d", open(ringAt(P, run(n, (q) => !front(q)), LZ - RT)));
    crease.setAttribute("d", open(ringAt(P, run(o, front), LZ)));
    const arc = [];
    for (let a = 3.5; a <= 4.4; a += 0.15) arc.push(P(x + 8 * Math.cos(a), y + 8 * Math.sin(a), LZ));
    glint.setAttribute("d", open(arc));
    drop.setAttribute("d", seg(P(x, y, LZ - RT), P(x, y, z)));
    place(dot, P(x, y, z));
  }

  const B = register(stage, (dt, now) => {
    let m = stepS(lx, dt);
    if (stepS(ly, dt)) m = true;
    for (const s of sheets) { drawSheet(s, now); if (!tdone(s.tw, now)) m = true; }
    drawLens();
    return m;
  });
  bag.add(B.unregister);

  /** The topmost sheet whose resting rectangle holds the ground point, or -1. */
  const hit = (x, y) => {
    for (let i = N - 1; i >= 0; i--) if (x >= X(i) && x <= X(i) + PH && y >= Y(i) && y <= Y(i) + PW) return i;
    return -1;
  };

  function choose(a, x, y) {
    const now = performance.now(), from = a;
    act = a;
    sheets.forEach((s, i) => {
      const t = i === a ? -SL : Math.abs(i - a) === 1 ? -SL * 0.3 : 0;
      tset(s.tw, t, now, Math.abs(i - from) * 40);
    });
    // The line read is picked against where the sheet is going, not where it is.
    const off = x - X(a) + SL;
    let k = -1, best = 4;
    LINES.forEach(([lu, l0, l1], j) => {
      const dd = Math.abs(off - lu), v = y - Y(a);
      if (dd < best && v >= l0 - 3 && v <= l1 + 3) { best = dd; k = j; }
    });
    sheets.forEach((s, i) => { s.line = i === a ? k : -1; });
    lx.t = x; ly.t = y;
    B.wake();
  }

  function at(p) {
    if (!p) { choose(REST, RX, RY); read.textContent = "rest"; return; }
    const [wx, wy] = unproj(C, p[0], p[1], 0);
    const a = hit(wx, wy);
    if (a < 0) { at(null); return; }
    choose(a, clamp(wx, X(a) - SL + 3, X(a) - SL + PH - 3), clamp(wy, Y(a) + 3, Y(a) + PW - 3));
    read.textContent = `sheet ${a + 1}`;
  }

  at(null);
  bag.add(pointer(stage, { move: at, leave: () => at(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { SL = v; choose(act, lx.t, ly.t); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "agent",
  means: "A glass reads a stack of sheets line by line: the sheet under the pointer slides out, and the line it reads lights up.",
  rules: [1, 2, 5, 8],
  range: [6, 14, 22],
  tour: [[95, 190], [280, 232], [175, 205], null],
  mount,
});
