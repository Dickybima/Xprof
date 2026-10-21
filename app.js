(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- formatting ----------
  const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const usd = (n) => "$" + compact(n);
  const price = (n) => (n < 0.01 ? "$" + n.toFixed(6) : n < 1 ? "$" + n.toFixed(4) : "$" + n.toFixed(2));
  const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  const ticker = (h) => "$" + h.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();

  // deterministic RNG per handle so data is stable across reloads
  const seeded = (str) => {
    let h = 2166136261;
    for (const c of str.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  };

  const SUPPLY = 1e9;
  const GRADUATION_MCAP = 69_000;

  const fallbackAvatar = (name) => {
    const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='#18181b'/><text x='50%' y='54%' fill='#e4e4e7' font-family='Inter,sans-serif' font-size='30' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${initials}</text></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27");
  };
  const avatarUrl = (h) => `https://unavatar.io/x/${encodeURIComponent(h)}`;
  const img = (p, cls = "avatar") =>
    `<img class="${cls}" src="${avatarUrl(p.handle)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallbackAvatar(p.name)}'" />`;
  const badge = `<svg class="verified" viewBox="0 0 22 22"><path fill="#1d9bf0" d="M20.4 11c0-1.3-.8-2.4-1.9-2.9.4-1.2.2-2.5-.7-3.4-.9-.9-2.2-1.1-3.4-.7C13.9 2.8 12.8 2 11.5 2s-2.4.8-2.9 1.9c-1.2-.4-2.5-.2-3.4.7-.9.9-1.1 2.2-.7 3.4C3.3 8.6 2.5 9.7 2.5 11s.8 2.4 1.9 2.9c-.4 1.2-.2 2.5.7 3.4.9.9 2.2 1.1 3.4.7.5 1.1 1.6 1.9 2.9 1.9s2.4-.8 2.9-1.9c1.2.4 2.5.2 3.4-.7.9-.9 1.1-2.2.7-3.4 1.1-.5 1.9-1.6 1.9-2.9z"/><path fill="#fff" d="M9.6 14.6 6.5 11.5l1.1-1.1 2 2 4.9-4.9 1.1 1.1z"/></svg>`;

  // ---------- model ----------
  function makeToken(p) {
    const r = seeded(p.handle);
    // market cap loosely tracks reach, with randomness
    const mcap = Math.max(4_000, Math.pow(p.followers, 0.62) * (6 + r() * 14));
    const history = [];
    let v = mcap * (0.55 + r() * 0.4);
    for (let i = 0; i < 48; i++) {
      v *= 1 + (r() - 0.46) * 0.08;
      history.push(v);
    }
    history.push(mcap);
    return {
      ...p,
      ticker: ticker(p.handle),
      mcap,
      open: history[0],
      volume: mcap * (0.15 + r() * 0.9),
      holders: Math.round(80 + Math.sqrt(mcap) * (2 + r() * 4)),
      history,
    };
  }
  const derive = (t) => ({
    price: t.mcap / SUPPLY,
    change: ((t.mcap - t.open) / t.open) * 100,
    bonding: Math.min(100, (t.mcap / GRADUATION_MCAP) * 100),
  });

  const tokens = window.PROFILES.map(makeToken);
  const byHandle = (h) => tokens.find((t) => t.handle.toLowerCase() === h.toLowerCase());

  // ---------- state ----------
  let sortKey = "mcap";
  let query = "";

  const sorters = {
    mcap: (a, b) => b.mcap - a.mcap,
    change: (a, b) => derive(b).change - derive(a).change,
    followers: (a, b) => b.followers - a.followers,
    volume: (a, b) => b.volume - a.volume,
  };

  // ---------- render ----------
  function sparkline(canvas, data, up) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const min = Math.min(...data), max = Math.max(...data);
    const x = (i) => (i / (data.length - 1)) * w;
    const y = (v) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
    const color = up ? "#22c55e" : "#ef4444";
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? "rgba(34,197,94,.25)" : "rgba(239,68,68,.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }

  function renderPodium(list) {
    const top = [...tokens].sort(sorters.mcap).slice(0, 3);
    $("#podium").innerHTML = top.map((t, i) => {
      const d = derive(t);
      return `<article class="card" data-handle="${t.handle}">
        <span class="rank">#${i + 1}</span>
        <div class="who">${img(t, "avatar lg")}
          <div><div class="name">${t.name}${t.verified ? badge : ""}</div><div class="handle">@${t.handle} · <span class="tick">${t.ticker}</span></div></div>
        </div>
        <canvas></canvas>
        <div class="meta">
          <div><span>Market cap</span>${usd(t.mcap)}</div>
          <div><span>24h</span><b class="${d.change >= 0 ? "up" : "down"}">${pct(d.change)}</b></div>
          <div><span>Followers</span>${compact(t.followers)}</div>
        </div>
      </article>`;
    }).join("");
    $$("#podium canvas").forEach((c, i) => sparkline(c, top[i].history, derive(top[i]).change >= 0));
  }

  function renderBoard(flash = {}) {
    const q = query.trim().toLowerCase();
    const list = tokens
      .filter((t) => !q || t.handle.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q))
      .sort(sorters[sortKey]);
    $("#board").innerHTML = list.length
      ? list.map((t, i) => {
          const d = derive(t);
          const f = flash[t.handle] ? (flash[t.handle] > 0 ? "flash-up" : "flash-down") : "";
          return `<tr data-handle="${t.handle}" class="${f}">
            <td class="rk">${i + 1}</td>
            <td><div class="who">${img(t)}<div><div class="name">${t.name}${t.verified ? badge : ""}</div><div class="handle">@${t.handle}<span class="sep"> · </span><span class="tick">${t.ticker}</span></div></div></div></td>
            <td class="num">${price(d.price)}</td>
            <td class="num ${d.change >= 0 ? "up" : "down"}">${pct(d.change)}</td>
            <td class="num hide-sm">${usd(t.mcap)}</td>
            <td class="num hide-sm">${compact(t.followers)}</td>
            <td class="hide-md"><div class="bar" title="${d.bonding.toFixed(0)}% to graduation"><i style="width:${d.bonding}%"></i></div></td>
            <td class="num hide-sm"><button class="btn btn-ghost btn-sm" data-trade="${t.handle}">Trade</button></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="8" class="empty">No profiles match “${query}”. Tokenize it above ↑</td></tr>`;
  }

  function renderTicker() {
    const items = [...tokens].sort(() => Math.random() - 0.5).slice(0, 14).map((t) => {
      const buy = Math.random() > 0.35;
      const amt = (Math.random() * 4 + 0.05).toFixed(2);
      return `<span class="ticker-item">${img(t)}<b>@${t.handle}</b> ${buy ? '<span class="up">bought</span>' : '<span class="down">sold</span>'} ${amt} SOL of ${t.ticker}</span>`;
    }).join("");
    $("#ticker").innerHTML = items + items; // doubled for seamless loop
  }

  function renderStats() {
    $("#statProfiles").textContent = compact(tokens.length * 1371 + 412);
    $("#statVolume").textContent = usd(tokens.reduce((s, t) => s + t.volume, 0));
    $("#statHolders").textContent = compact(tokens.reduce((s, t) => s + t.holders, 0));
  }

  // ---------- modal ----------
  const modal = $("#modal");
  function openToken(t, isNew = false) {
    const d = derive(t);
    $("#modalBody").innerHTML = `
      <div class="modal-head">${img(t, "avatar lg")}
        <div><div class="name">${t.name}${t.verified ? badge : ""}</div><div class="handle">@${t.handle} · <span class="tick">${t.ticker}</span></div></div>
        <button class="x-close" value="close" aria-label="Close">×</button>
      </div>
      ${isNew ? `<p class="bio">🚀 <b>${t.ticker}</b> has been launched on the bonding curve. Be the first buyer.</p>` : t.bio ? `<p class="bio">${t.bio}</p>` : ""}
      <canvas class="chart"></canvas>
      <div class="kv">
        <div><span>Price</span><b>${price(d.price)}</b></div>
        <div><span>24h</span><b class="${d.change >= 0 ? "up" : "down"}">${pct(d.change)}</b></div>
        <div><span>Market cap</span><b>${usd(t.mcap)}</b></div>
        <div><span>Holders</span><b>${compact(t.holders)}</b></div>
        <div><span>Followers on X</span><b>${compact(t.followers)}</b></div>
        <div><span>Bonding curve</span><b>${d.bonding.toFixed(0)}%</b></div>
      </div>
      <div class="trade">
        <input type="number" min="0" step="0.1" value="0.5" aria-label="Amount in SOL" />
        <button type="button" class="btn btn-buy" data-act="buy">Buy</button>
        <button type="button" class="btn btn-sell" data-act="sell">Sell</button>
      </div>
      <a class="btn btn-primary" style="text-align:center;text-decoration:none" href="launch.html?handle=${encodeURIComponent(t.handle)}&source=x">Launch @${t.handle} on Pons v2 →</a>
      <a class="handle" href="https://x.com/${t.handle}" target="_blank" rel="noopener">View @${t.handle} on X ↗</a>`;
    modal.showModal();
    sparkline($(".chart", modal), t.history, d.change >= 0);
    $$("[data-act]", modal).forEach((b) =>
      b.addEventListener("click", () => {
        const amt = parseFloat($(".trade input", modal).value) || 0;
        if (amt <= 0) return toast("Enter an amount");
        const sign = b.dataset.act === "buy" ? 1 : -1;
        t.mcap = Math.max(1000, t.mcap * (1 + sign * amt * 0.01));
        t.history.push(t.mcap);
        modal.close();
        renderBoard({ [t.handle]: sign });
        renderPodium();
        toast(`${sign > 0 ? "Bought" : "Sold"} ${amt} SOL of ${t.ticker} (demo)`);
      })
    );
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- events ----------
  $("#tokenizeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("#handleInput").value.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?]/)[0];
    if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) return toast("Enter a valid X handle");
    location.href = `launch.html?handle=${encodeURIComponent(raw)}&source=x`;
  });

  $$("[data-try]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    $("#handleInput").value = a.dataset.try;
    $("#handleInput").focus();
  }));

  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
    sortKey = b.dataset.sort;
    renderBoard();
  }));

  $("#search").addEventListener("input", (e) => { query = e.target.value; renderBoard(); });

  const openFrom = (e) => {
    const el = e.target.closest("[data-handle]");
    if (el) openToken(byHandle(el.dataset.handle));
  };
  $("#board").addEventListener("click", openFrom);
  $("#podium").addEventListener("click", openFrom);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });


  // simulated live market
  setInterval(() => {
    const flash = {};
    for (let i = 0; i < 3; i++) {
      const t = tokens[Math.floor(Math.random() * tokens.length)];
      const m = 1 + (Math.random() - 0.47) * 0.03;
      t.mcap *= m;
      t.volume += t.mcap * 0.002;
      t.history.push(t.mcap);
      if (t.history.length > 60) t.history.shift();
      flash[t.handle] = m >= 1 ? 1 : -1;
    }
    renderBoard(flash);
    renderStats();
  }, 3000);

  window.addEventListener("resize", () => renderPodium());

  $("#year").textContent = new Date().getFullYear();
  renderStats();
  renderTicker();
  renderPodium();
  renderBoard();
})();
