(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- formatting ----------
  const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const usd = (n) => "$" + compact(n);
  const ticker = (h) => "$" + h.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();

  // deterministic RNG per handle so data is stable across reloads
  const seeded = (str) => {
    let h = 2166136261;
    for (const c of str.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  };

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
  const tokens = window.PROFILES.map(makeToken);

  // ---------- state ----------
  let query = "";
  const byFollowers = (a, b) => b.followers - a.followers;

  // ---------- render ----------
  function renderPodium(list) {
    const top = [...tokens].sort(byFollowers).slice(0, 3);
    $("#podium").innerHTML = top.map((t, i) => `<article class="card" data-handle="${t.handle}">
        <span class="rank">#${i + 1}</span>
        <div class="who">${img(t, "avatar lg")}
          <div><div class="name">${t.name}${t.verified ? badge : ""}</div><div class="handle">@${t.handle}</div></div>
        </div>
        <div class="meta card-foot">
          <div><span>Followers</span>${compact(t.followers)}</div>
          <a class="btn btn-ghost btn-sm tokenize-btn" href="${launchUrl(t.handle)}">Tokenize</a>
        </div>
      </article>`).join("");
  }

  function renderBoard() {
    const q = query.trim().toLowerCase();
    const list = tokens
      .filter((t) => !q || t.handle.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q))
      .sort(byFollowers);
    $("#board").innerHTML = list.length
      ? list.map((t, i) => `<tr data-handle="${t.handle}">
            <td class="rk">${i + 1}</td>
            <td><div class="who">${img(t)}<div><div class="name">${t.name}${t.verified ? badge : ""}</div><div class="handle">@${t.handle}</div></div></div></td>
            <td class="num">${compact(t.followers)}</td>
            <td class="num"><a class="btn btn-ghost btn-sm tokenize-btn" href="${launchUrl(t.handle)}">Tokenize</a></td>
          </tr>`).join("")
      : `<tr><td colspan="4" class="empty">No profiles match “${query}”. Tokenize it above ↑</td></tr>`;
  }

  function renderTicker() {
    const items = [...tokens].sort(() => Math.random() - 0.5).slice(0, 14).map((t) => {
      const buy = Math.random() > 0.35;
      const amt = (Math.random() * 0.2 + 0.002).toFixed(3);
      return `<span class="ticker-item">${img(t)}<b>@${t.handle}</b> ${buy ? '<span class="up">bought</span>' : '<span class="down">sold</span>'} ${amt} ETH of ${t.ticker}</span>`;
    }).join("");
    $("#ticker").innerHTML = items + items; // doubled for seamless loop
  }

  function renderStats() {
    $("#statProfiles").textContent = compact(tokens.length * 1371 + 412);
    $("#statVolume").textContent = usd(tokens.reduce((s, t) => s + t.volume, 0));
    $("#statHolders").textContent = compact(tokens.reduce((s, t) => s + t.holders, 0));
  }

  const launchUrl = (handle) => `launch.html?handle=${encodeURIComponent(handle)}&source=x`;

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
    location.href = launchUrl(raw);
  });

  $$("[data-try]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    $("#handleInput").value = a.dataset.try;
    $("#handleInput").focus();
  }));

  $("#search").addEventListener("input", (e) => { query = e.target.value; renderBoard(); });

  const openFrom = (e) => {
    if (e.target.closest("a")) return;
    const el = e.target.closest("[data-handle]");
    if (el) location.href = launchUrl(el.dataset.handle);
  };
  $("#board").addEventListener("click", openFrom);
  $("#podium").addEventListener("click", openFrom);


  // simulated live market
  setInterval(() => {
    for (let i = 0; i < 3; i++) {
      const t = tokens[Math.floor(Math.random() * tokens.length)];
      const m = 1 + (Math.random() - 0.47) * 0.03;
      t.mcap *= m;
      t.volume += t.mcap * 0.002;
      t.history.push(t.mcap);
      if (t.history.length > 60) t.history.shift();
    }
    renderStats();
  }, 3000);

  $("#year").textContent = new Date().getFullYear();
  renderStats();
  renderTicker();
  renderPodium();
  renderBoard();
})();
