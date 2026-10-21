(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- formatting ----------
  const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

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
  const tokens = window.PROFILES;

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

  // ---------- live launches (same data as Explore) ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ethFmt = (n) => (n >= 100 ? compact(n) : n >= 1 ? n.toFixed(2) : n.toPrecision(2)) + " ETH";
  function ago(ts) {
    if (!ts) return "";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return "just now";
    for (const [unit, sec] of [["d", 86400], ["h", 3600], ["m", 60]]) if (s >= sec) return `${Math.floor(s / sec)}${unit} ago`;
  }

  function renderTicker(launches) {
    const recent = launches.slice(0, 14);
    if (!recent.length) {
      $("#ticker").innerHTML = `<span class="ticker-item">No profile coins yet. <a href="launch.html"><b>Launch the first one →</b></a></span>`;
      $("#ticker").classList.add("still");
      return;
    }
    $("#ticker").classList.remove("still");
    const items = recent.map((c) => {
      const logo = /^https:\/\//i.test(c.logo) ? c.logo : c.handle ? avatarUrl(c.handle) : "";
      return `<a class="ticker-item" href="token.html?address=${esc(c.token)}">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.remove()" />` : ""}<b>${c.handle ? "@" + esc(c.handle) : esc(c.name)}</b> launched <span class="up">$${esc(c.symbol)}</span> · ${ethFmt(c.marketCapEth)} mcap · ${ago(c.createdAt)}</a>`;
    }).join("");
    // Repeat so the strip is wide enough to loop seamlessly.
    const reps = Math.max(2, Math.ceil(8 / recent.length) * 2);
    $("#ticker").innerHTML = items.repeat(reps);
  }

  function renderStats(launches) {
    $("#statCoins").textContent = compact(launches.length);
    $("#statMcap").textContent = ethFmt(launches.reduce((s, c) => s + (c.marketCapEth || 0), 0));
    $("#statRaised").textContent = ethFmt(launches.reduce((s, c) => s + (c.raisedEth || 0), 0));
  }

  async function loadLive() {
    try {
      const res = await fetch("/api/launches");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderStats(data.launches);
      renderTicker(data.launches);
      setTimeout(loadLive, data.complete ? 30_000 : 4_000);
    } catch {
      setTimeout(loadLive, 30_000);
    }
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


  $("#year").textContent = new Date().getFullYear();
  renderTicker([]);
  $("#ticker").innerHTML = `<span class="ticker-item">Loading latest launches from Robinhood Chain…</span>`;
  renderPodium();
  renderBoard();
  loadLive();
})();
