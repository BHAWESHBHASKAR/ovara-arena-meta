/**
 * Gate: a track runs from the agent's block to the till. Halfway along stands
 * a gate, two posts and a bar, with a holding tray beside it. Calls wait on
 * the track as tokens: a flat disc for a read, a stack of coins for a call
 * that moves money. The pointer picks a token: a disc rides under the lifted
 * bar to the till; a coin stack runs up to the shut bar and is turned into
 * the tray, held. The queue behind it closes up, staggered from the token
 * picked. At rest one stack already sits held in the tray: the bright mark.
 * The slider is the stagger, in ms.
 */
const {
  Cam, circ, clamp, facing, fit, open, prism, proj, rings, ringAt, run, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const GX = 90, POST = 13, PH = 30, BAR0 = 10, BAR1 = 23, SLOT = 14;
const KINDS = [["get", 0], ["refund", 1], ["list", 0], ["send", 0], ["cancel", 1], ["read", 0]];
const QX = KINDS.map((_, i) => 2 + i * SLOT);
const TRAY = [[72, 23, 106, 43], [81, 33], [97, 33]];

/** A token's rings at (x, y): a read is a thin disc, money a stack of coins. */
const disc = (r, x, y) => circ(r, 24).map((q) => ({ ...q, u: q.u + x, v: q.v + y }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const C = Cam(45, 0.5, 1.58);
  fit(C, [[-44, -16, 0], [198, 16, 0], [-44, 16, 0], [198, -16, 0], [90, 43, 0], [-44, -16, 26], [GX, -POST, PH]], 200, 166);
  const P = proj(C), front = facing(C);
  const ground = mk("g", {}, svg), layer = mk("g", {}, svg);

  // the track and the tray lie on the ground, under everything
  const [tr, ti] = rings(-12, -4, 166, 4, 3, 1);
  put(solid(ground), prism(P, front, tr, ti, 0, 1.2));
  const [yr, yi] = rings(...TRAY[0], 4, 2);
  put(solid(ground), prism(P, front, yr, yi, 0, 2.4));

  // the things that stand, each with a depth key; painted far to near
  const items = [];
  const block = (x0, y0, x1, y1, h, mark) => {
    const el = solid(layer), [r, i] = rings(x0, y0, x1, y1, 6, 1.6);
    put(el, prism(P, front, r, i, 0, h));
    if (mark) mk("path", { d: mark(h), class: "nf lo" }, el.g);
    items.push({ g: el.g, key: () => (x1 + y1) - 4 });
  };
  // the agent's block, with a slot the track leaves from; the till, with its drawer
  block(-44, -16, -12, 16, 26, (h) => seg(P(-12, -6, 5), P(-12, 6, 5)) + seg(P(-12, -6, 5), P(-12, -6, 0.5)) + seg(P(-12, 6, 5), P(-12, 6, 0.5)));
  block(166, -16, 198, 16, 20, (h) => seg(P(176, -7, h), P(188, -7, h)) + seg(P(176, 7, h), P(188, 7, h)));
  for (const y of [-POST, POST]) {
    const el = solid(layer), [r, i] = rings(GX - 3, y - 3, GX + 3, y + 3, 3, 0.8);
    put(el, prism(P, front, r, i, 0, PH));
    items.push({ g: el.g, key: () => GX + y });
  }
  const bar = solid(layer), barT = tween(BAR0);
  const [br, bi] = rings(GX - 1.6, -POST, GX + 1.6, POST, 1.6, 0.6);
  items.push({ g: bar.g, key: () => GX });

  // the tokens: six in the queue, and one already held in the tray
  const toks = KINDS.map(([name, heavy], i) => ({ name, heavy, i, x: QX[i], y: 0 }));
  toks.push({ name: "cancel", heavy: 1, i: -1, x: TRAY[2][0], y: TRAY[2][1] });
  for (const t of toks) {
    t.r = t.heavy ? 6.4 : 6; t.h = t.heavy ? 10 : 2.8; t.z0 = t.i < 0 ? 2.4 : 1.2;
    t.el = solid(layer); t.lines = mk("path", { class: "nf lo" }, t.el.g);
    t.p = tween(0); t.q = tween(0); t.drawn = "";
    t.rest = P(t.x, t.y, t.z0 + t.h / 2);
    items.push({ g: t.el.g, key: () => t.at[0] + t.at[1] });
  }

  /** Where token t is: q slides it one slot on; p runs its route, to the till or the tray. */
  function where(t, now) {
    const p = tval(t.p, now), x = t.x + SLOT * tval(t.q, now);
    if (t.i < 0 || p === 0) return [x, t.y];
    const legs = t.heavy ? [[x, 0], [GX - 12, 0], [TRAY[1][0], 0], TRAY[1]] : [[x, 0], [134, 0]];
    let len = 0; const L = [];
    for (let k = 1; k < legs.length; k++) { L.push(Math.hypot(legs[k][0] - legs[k - 1][0], legs[k][1] - legs[k - 1][1])); len += L[k - 1]; }
    let s = p * len, k = 0;
    while (k < L.length - 1 && s > L[k]) s -= L[k++];
    const a = legs[k], b = legs[k + 1], u = L[k] ? clamp(s / L[k], 0, 1) : 1;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }

  function drawTok(t, now) {
    t.at = where(t, now);
    const [x, y] = t.at, ring = disc(t.r, x, y), inner = disc(t.r - 1.2, x, y);
    const z0 = t.i < 0 || (t.heavy && tval(t.p, now) > 0.8) ? 2.4 : t.z0, k = `${x.toFixed(2)},${y.toFixed(2)},${z0}`;
    if (k === t.drawn) return;
    t.drawn = k;
    put(t.el, prism(P, front, ring, inner, z0, z0 + t.h));
    const fr = run(ring, front);
    t.lines.setAttribute("d", t.heavy ? [1, 2].map((n) => open(ringAt(P, fr, z0 + (t.h * n) / 3))).join("") : "");
  }

  let order = "";
  const B = register(stage, (_dt, now) => {
    let m = false;
    for (const t of toks) { drawTok(t, now); if (!tdone(t.p, now) || !tdone(t.q, now)) m = true; }
    const bz = tval(barT, now);
    put(bar, prism(P, front, br, bi, bz, bz + 3));
    if (!tdone(barT, now)) m = true;
    const sorted = items.map((it, n) => [it.key(), n]).sort((a, b) => a[0] - b[0]), sig = sorted.map((s) => s[1]).join();
    if (sig !== order) { order = sig; for (const [, n] of sorted) layer.appendChild(items[n].g); }
    return m;
  });
  bag.add(B.unregister);

  let act = null;
  /** Sends token a (null sends nothing): the queue behind it closes up, staggered outwards from it. */
  function choose(a) {
    if (a === act) return;
    const now = performance.now(), from = a ?? act;
    act = a;
    const sent = a && a.i >= 0 ? a : null;
    for (const t of toks) {
      if (t.i < 0) continue;
      const d = Math.abs(t.i - from.i) * stag;
      tset(t.p, t === sent ? 1 : 0, now, 0);
      tset(t.q, sent && t.i < sent.i ? 1 : 0, now, d);
    }
    tset(barT, sent && !sent.heavy ? BAR1 : BAR0, now, 0);
    const lit = a ?? toks[toks.length - 1];
    for (const t of toks) t.el.sil.classList.toggle("hi", t === lit);
    read.textContent = a ? `${a.name} · ${a.heavy ? "held" : "pass"}` : "rest";
    B.wake();
  }
  // picked by each token's resting place on screen, which never moves
  const hit = ([sx, sy]) => {
    let best = null, bd = 13;
    for (const t of toks) { const d = Math.hypot(sx - t.rest[0], sy - t.rest[1]); if (d < bd) { bd = d; best = t; } }
    return best;
  };
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  toks[toks.length - 1].el.sil.classList.add("hi");
  read.textContent = "rest";
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "gate",
  means: "Calls queue for a gate: reads ride under the bar to the till; a call that moves money is turned aside and held.",
  rules: [1, 2, 4, 6],
  range: [0, 45, 90],
  tour: [[147, 154], [179, 165], [185, 204], null],
  mount,
});
