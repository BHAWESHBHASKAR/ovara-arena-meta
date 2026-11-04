/**
 * Hidden: a wire confirmation lying on a second sheet, a sticky note on its
 * corner. Two rows of footer print are there but near-white: only their grains
 * show, as dim dots. Where the pointer passes, the words nearest it draw in
 * and lift a little off the page, falling off with distance, each on its own
 * spring. At rest one word at the footer's end already shows: the glimpse.
 * The slider is the reach, in world units.
 */
const {
  Cam, clamp, facing, fit, prism, proj, rings, rrect, ringAt, unproj, spring, stepS,
  mk, place, pointer, put, register, disposer, solid, seg, poly,
} = HL;

const SW = 110, SH = 148, T0 = 1.6, T1 = 3.2, LIFT = 12, WH = 2.1;
const ROWS = [119, 129, 139];
const LENS = [[13, 8, 17, 6, 12, 15, 9], [7, 15, 10, 13, 6, 16, 11], [16, 9, 12, 7, 18, 11, 6]];

/** 1 → .31 at 42% of the reach → .09 beyond, as Terrain's. */
const falloff = (u) =>
  u <= 0 ? 1 : u <= 0.417 ? 1 - (u / 0.417) * 0.6875 : u <= 1 ? 0.3125 - ((u - 0.417) / 0.583) * 0.2185 : 0.094;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let R = value, over = null;
  const C = Cam(45, 0.5, 1.76);
  fit(C, [[0, 0, 0], [SW + 7, -6, 0], [0, SH, 0], [SW + 7, SH, 0], [70, -8, 6], [0, 0, 14]], 200, 170);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the sheet underneath, then the confirmation on it
  const [ur, ui] = rings(7, -6, SW + 7, SH - 6, 2.5, 1);
  put(solid(g), prism(P, front, ur, ui, 0, T0));
  const [sr, si] = rings(0, 0, SW, SH, 2.5, 1.2);
  put(solid(g), prism(P, front, sr, si, T0, T1));

  // what anyone sees: a bank's box, a header, the amount boxed, the body lines
  const at = (x, y) => P(x, y, T1);
  const flat = (r) => poly(ringAt(P, r, T1));
  mk("path", { d: flat(rrect(9, 9, 29, 21, 3, 4)), class: "nf lo" }, g);
  mk("path", { d: seg(at(35, 12), at(66, 12)) + seg(at(35, 18), at(54, 18)), class: "nf lo" }, g);
  mk("path", { d: flat(rrect(52, 32, 102, 48, 3, 4)), class: "nf" }, g);
  mk("path", { d: seg(at(9, 37), at(42, 37)) + seg(at(9, 43), at(34, 43)) + seg(at(58, 40), at(96, 40)), class: "nf lo" }, g);
  const body = [[58, 92], [66, 80], [74, 98], [82, 70], [90, 88], [98, 54]];
  mk("path", { d: body.map(([y, l]) => seg(at(9, y), at(9 + l, y))).join(""), class: "nf lo" }, g);
  mk("path", { d: seg(at(60, 109), at(100, 109)), class: "nf lo" }, g);

  // the footer print: words, each with its grains and its own spring
  const words = [];
  ROWS.forEach((y, row) => {
    let x = 9;
    LENS[row].forEach((len, k) => {
      const grains = [];
      for (let u = 1; u < len; u += 3) { const d = mk("circle", { r: 0.75, class: "dot off" }, g); place(d, at(x + u, y)); grains.push(d); }
      words.push({ row, k, x, y, len, grains, el: mk("path", { class: "nf" }, g), sp: spring(0, { eps: 0.004 }), rest: 0, drawn: NaN });
      x += len + 3.5;
    });
  });
  // the glimpse: the last two words of the bottom row show at rest
  const last = words.filter((w) => w.row === 2);
  [1, 0.62, 0.3].forEach((v, k) => { last[last.length - 1 - k].rest = v; });
  words.forEach((w) => { w.sp.x = w.sp.t = w.rest; });

  // the sticky note, laid over the far corner
  const [nr, ni] = rings(72, -9, 104, 22, 1.6, 1);
  put(solid(g), prism(P, front, nr, ni, T1, T1 + 1.4));
  const nz = T1 + 1.4;
  mk("path", { d: seg(P(77, 2, nz), P(99, 2, nz)) + seg(P(77, 8, nz), P(93, 8, nz)), class: "nf lo" }, g);

  function draw(w) {
    const r = w.sp.x;
    if (r === w.drawn) return;
    w.drawn = r;
    const z = T1 + LIFT * r, l = Math.max(2 * WH, w.len * clamp(r * 2, 0, 1));
    w.el.setAttribute("d", r < 0.08 ? "" : poly(ringAt(P, rrect(w.x, w.y - WH, w.x + l, w.y + WH, WH, 3), z)));
    w.el.classList.toggle("hi", r > 0.55);
  }

  const B = register(stage, (dt) => {
    let m = false;
    for (const w of words) { if (stepS(w.sp, dt)) m = true; draw(w); }
    return m;
  });
  bag.add(B.unregister);

  const onSheet = (p) => p && p[0] > -8 && p[0] < SW + 8 && p[1] > -8 && p[1] < SH + 8;
  const dist = (w, p) => Math.hypot(Math.max(0, Math.abs(p[0] - (w.x + w.len / 2)) - w.len / 2), p[1] - w.y);
  function retarget() {
    const live = onSheet(over);
    for (const w of words) w.sp.t = live ? clamp((falloff(dist(w, over) / R) - 0.12) / 0.5, 0, 1) : w.rest;
    if (!live) read.textContent = "rest";
    else {
      const near = words.reduce((a, b) => (dist(b, over) < dist(a, over) ? b : a));
      read.textContent = dist(near, over) < 5 ? `hidden ${near.row + 1}·${near.k + 1}` : "sheet";
    }
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => { over = unproj(C, p[0], p[1], T1); retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { R = v; if (over) retarget(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "hidden",
  means: "A wire confirmation with a line nobody reads: run the pointer over the page and its near-white print draws in.",
  rules: [1, 3, 4, 5],
  range: [28, 44, 64],
  tour: [[86, 177], [120, 205], [205, 160], null],
  mount,
});
