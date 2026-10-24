// Animated neon spider-web background. The web sways gently, ripples away
// from the cursor, and light pulses run out along its threads.
(() => {
  const canvas = document.createElement("canvas");
  canvas.id = "web-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const NEON = "255, 255, 255";
  const SPOKES = 20;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w, h, dpr, cx, cy, rings, spokes, maxR;
  const mouse = { x: -9999, y: -9999, energy: 0 };
  const pulses = [];

  // deterministic jitter so the web keeps its shape across resizes
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cx = w * 0.5;
    cy = h * (w < 700 ? 0.3 : 0.36);
    maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.05;

    seed = 7;
    spokes = Array.from({ length: SPOKES }, (_, i) => {
      const a = (i / SPOKES) * Math.PI * 2 + (rand() - 0.5) * 0.18;
      return { a, cos: Math.cos(a), sin: Math.sin(a), phase: rand() * 6.28 };
    });

    // spiral rings, spacing widening toward the edge like a real orb web
    rings = [];
    let r = Math.min(w, h) * 0.05;
    while (r < maxR) {
      rings.push(spokes.map(() => r * (0.94 + rand() * 0.12)));
      r *= 1.13 + rand() * 0.03;
    }
  }

  function point(k, i, t) {
    const s = spokes[i];
    const base = k < 0 ? 0 : rings[k][i];
    // slow breathing sway, stronger toward the rim
    const sway = Math.sin(t * 0.7 + s.phase + k * 0.35) * base * 0.012;
    let x = cx + s.cos * (base + sway);
    let y = cy + s.sin * (base + sway);
    // ripple away from the cursor
    if (mouse.energy > 0.01) {
      const dx = x - mouse.x, dy = y - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d < 220 && d > 0.1) {
        const push = (1 - d / 220) * 18 * mouse.energy * (0.6 + 0.4 * Math.sin(t * 9 - d * 0.05));
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
    }
    return [x, y];
  }

  function strokeWeb(t) {
    ctx.beginPath();
    // radial threads
    for (let i = 0; i < SPOKES; i++) {
      const [x0, y0] = point(-1, i, t);
      ctx.moveTo(x0, y0);
      for (let k = 0; k < rings.length; k++) {
        const [x, y] = point(k, i, t);
        ctx.lineTo(x, y);
      }
    }
    // capture spiral, each segment sagging slightly toward the hub
    for (let k = 0; k < rings.length; k++) {
      let [px, py] = point(k, 0, t);
      ctx.moveTo(px, py);
      for (let i = 1; i <= SPOKES; i++) {
        const [x, y] = point(k, i % SPOKES, t);
        const mx = (px + x) / 2, my = (py + y) / 2;
        const sag = 0.07 + 0.02 * Math.sin(t + k);
        ctx.quadraticCurveTo(mx + (cx - mx) * sag, my + (cy - my) * sag, x, y);
        px = x; py = y;
      }
    }
  }

  function spawnPulse() {
    pulses.push({ i: Math.floor(Math.random() * SPOKES), p: 0, speed: 0.12 + Math.random() * 0.12 });
  }

  function draw(now) {
    const t = now / 1000;
    ctx.clearRect(0, 0, w, h);

    // fade the web out toward the edges so content stays readable
    const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    fade.addColorStop(0, `rgba(${NEON}, 0.4)`);
    fade.addColorStop(0.45, `rgba(${NEON}, 0.32)`);
    fade.addColorStop(1, `rgba(${NEON}, 0.08)`);

    strokeWeb(t);
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${NEON}, 0.07)`;
    ctx.lineWidth = 4;
    ctx.stroke(); // soft glow pass
    ctx.strokeStyle = fade;
    ctx.lineWidth = 0.9;
    ctx.stroke(); // crisp thread pass

    // hub glow
    const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
    hub.addColorStop(0, `rgba(${NEON}, 0.16)`);
    hub.addColorStop(1, `rgba(${NEON}, 0)`);
    ctx.fillStyle = hub;
    ctx.fillRect(cx - 90, cy - 90, 180, 180);

    // light pulses travelling out along the spokes
    if (!reduceMotion && Math.random() < 0.035 && pulses.length < 6) spawnPulse();
    ctx.globalCompositeOperation = "lighter";
    for (let n = pulses.length - 1; n >= 0; n--) {
      const pl = pulses[n];
      pl.p += pl.speed / 60;
      if (pl.p >= 1) { pulses.splice(n, 1); continue; }
      const pos = pl.p * (rings.length - 1);
      const k = Math.floor(pos), f = pos - k;
      const [ax, ay] = point(k, pl.i, t);
      const [bx, by] = point(Math.min(k + 1, rings.length - 1), pl.i, t);
      const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      const alpha = Math.sin(pl.p * Math.PI);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, `rgba(${NEON}, ${0.9 * alpha})`);
      g.addColorStop(1, `rgba(${NEON}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 14, y - 14, 28, 28);
    }
    ctx.globalCompositeOperation = "source-over";

    mouse.energy *= 0.96;
    if (!reduceMotion) requestAnimationFrame(draw);
  }

  addEventListener("resize", () => { build(); if (reduceMotion) draw(0); });
  addEventListener("pointermove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.energy = Math.min(1, mouse.energy + 0.15);
  }, { passive: true });

  build();
  if (reduceMotion) draw(0);
  else requestAnimationFrame(draw);
})();
