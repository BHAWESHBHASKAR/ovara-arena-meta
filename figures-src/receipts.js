/**
 * Receipts: six paper slips joined end to end by flat links, a hash chain you
 * could put on a desk. At rest only the first slip is seated; the rest lie
 * loose, lifted, skewed and drifting apart. The pointer runs along the chain:
 * every slip up to the one under it drops flat, squares up and closes onto its
 * link, staggered out from the pointer; the slips past it stay loose. Each slip
 * carries printed rules and a four-dot code, its number in binary. The slider
 * is the stagger, in ms.
 */
const {
  Cam, facing, fit, prism, proj, rings, circ, unproj, ringAt, poly, seg, clamp, lerp, rad,
  tween, tset, tval, tdone, mk, place, pointer, put, register, disposer, solid,
} = HL;

const N = 6, PL = 30, PW = 46, T = 3, GAP = 10, PITCH = PL + GAP, LR = 7.2, LH = 3.6, LT = 1.6;
// the loose pose of each slip: lift, extra drift along the chain, sideways shift, yaw in degrees
const LIFT = [0, 6, 14, 9, 20, 28], DX = [0, 4, 9, 13, 19, 26], DY = [0, -5, 6, -4, 8, -6], YAW = [0, 8, -11, 9, -14, 16];

/** A ring rotated by deg about (cx, cy) and moved by (ox, oy): samples and their normals turn together. */
function turn(ring, cx, cy, deg, ox, oy) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return ring.map((q) => {
    const u = q.u - cx, v = q.v - cy;
    return { u: cx + ox + u * c - v * s, v: cy + oy + u * s + v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c };
  });
}
const shift = (ring, ox, oy) => ring.map((q) => ({ u: q.u + ox, v: q.v + oy, nu: q.nu, nv: q.nv }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const END = (N - 1) * PITCH + PL + DX[N - 1];
  const C = Cam(45, 0.5, 1.55);
  fit(C, [[-6, -8, 0], [END + 6, PW + 8, 0], [END + 6, -8, LIFT[N - 1] + T], [-6, PW + 8, 0], [0, -8, T]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const slips = [], links = [];
  for (let i = 0; i < N; i++) {
    const x0 = i * PITCH, [ring, inner] = rings(x0, 0, x0 + PL, PW, 3.2, 1.1);
    const el = solid(g), ink = mk("path", { class: "nf lo" }, el.g), total = mk("path", { class: "nf" }, el.g);
    const dots = [];
    for (let k = 0; k < 4; k++) dots.push(mk("circle", { r: 1.15, class: "dot off" }, el.g));
    slips.push({ i, x0, ring, inner, el, ink, total, dots, s: tween(i === 0 ? 1 : 0), drawn: NaN });
    if (i > 0) {
      const lel = solid(g), hole = mk("path", { class: "nf" }, lel.g);
      links.push({ el: lel, hole, drawn: "" });
    }
  }

  /** Slip i's pose at seat share s (1 = seated): its offset, yaw and height. */
  function pose(i, s) {
    const k = 1 - s;
    return { ox: DX[i] * k, oy: DY[i] * k, yaw: YAW[i] * k, z: LIFT[i] * k };
  }
  /** A point on slip i's top, in its own coordinates (u along the chain, v across), at its pose. */
  function onTop(sl, q, u, v) {
    const cx = sl.x0 + PL / 2, cy = PW / 2, c = Math.cos(rad(q.yaw)), s = Math.sin(rad(q.yaw));
    const du = u - cx, dv = v - cy;
    return [cx + q.ox + du * c - dv * s, cy + q.oy + du * s + dv * c, q.z + T];
  }

  function drawSlip(sl, sv) {
    if (sv === sl.drawn) return false;
    sl.drawn = sv;
    const q = pose(sl.i, sv), cx = sl.x0 + PL / 2, cy = PW / 2;
    put(sl.el, prism(P, front, turn(sl.ring, cx, cy, q.yaw, q.ox, q.oy), turn(sl.inner, cx, cy, q.yaw, q.ox, q.oy), q.z, q.z + T));
    const at = (u, v) => P(...onTop(sl, q, u, v));
    sl.ink.setAttribute("d", [17, 22, 27, 32].map((v) => seg(at(sl.x0 + 6, v), at(sl.x0 + (v === 27 ? PL - 12 : PL - 6), v))).join(""));
    sl.total.setAttribute("d", seg(at(sl.x0 + 6, 38), at(sl.x0 + PL - 6, 38)));
    sl.dots.forEach((d, k) => place(d, at(sl.x0 + 7.5 + k * 5, 8)));
    return true;
  }

  function drawLink(j) {
    const a = slips[j], b = slips[j + 1];
    const qa = pose(j, a.drawn), qb = pose(j + 1, b.drawn);
    const pa = onTop(a, qa, a.x0 + PL - 2, PW / 2), pb = onTop(b, qb, b.x0 + 2, PW / 2);
    const cx = (pa[0] + pb[0]) / 2, cy = (pa[1] + pb[1]) / 2, z = Math.max(pa[2], pb[2]);
    const key = [cx, cy, z].map((n) => n.toFixed(2)).join();
    const L = links[j];
    if (key === L.drawn) return;
    L.drawn = key;
    put(L.el, prism(P, front, shift(circ(LR, 16), cx, cy), shift(circ(LR - 1.1, 16), cx, cy), z, z + LT));
    L.hole.setAttribute("d", poly(ringAt(P, shift(circ(LH, 12), cx, cy), z + LT)));
  }

  // paint order: slip 0, then each slip followed by the link that rides on it and the one before
  slips.forEach((sl, i) => { if (i > 0) sl.el.g.after(links[i - 1].el.g); });

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const sl of slips) { drawSlip(sl, tval(sl.s, now)); if (!tdone(sl.s, now)) moving = true; }
    for (let j = 0; j < N - 1; j++) drawLink(j);
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  function bright(a) {
    const m = a < 0 ? 0 : a;
    // a seated slip shows its code, its number in binary; a loose one's is blank
    slips.forEach((sl, i) => sl.dots.forEach((d, k) => d.setAttribute("class", i <= m && ((i + 1) >> (3 - k)) & 1 ? "dot m" : "dot off")));
    slips.forEach((sl, i) => sl.el.sil.classList.toggle("hi", i === m));
    links.forEach((L, j) => L.el.sil.classList.toggle("hi", a > 0 && j === a - 1));
  }
  /** Seats every slip up to a (-1: only the first), staggered out from a, or from the one let go. */
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    slips.forEach((sl, i) => tset(sl.s, i <= Math.max(a, 0) ? 1 : 0, now, Math.abs(i - from) * stag));
    bright(a);
    read.textContent = a < 0 ? "rest" : `link ${a + 1}`;
    B.wake();
  }

  /** The hit test reads the seated chain on the ground, which never moves. */
  function hit(p) {
    const [wx, wy] = unproj(C, p[0], p[1], 0);
    if (wy < -30 || wy > PW + 20 || wx < -14 || wx > END + 10) return -1;
    return clamp(Math.floor((wx + GAP / 2) / PITCH), 0, N - 1);
  }

  bright(-1);
  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "receipts",
  means: "A chain of signed receipts: run the pointer along it and every link up to the pointer seats and locks.",
  rules: [1, 2, 5, 10],
  range: [0, 45, 90],
  tour: [[150, 140], [215, 175], [290, 210], null],
  mount,
});
