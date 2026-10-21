const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const EXPLORER = "https://robinhoodchain.blockscout.com";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const eth = (n) => (n >= 1 ? n.toLocaleString("en", { maximumFractionDigits: 2 }) : n.toLocaleString("en", { maximumSignificantDigits: 3 })) + " ETH";
const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : "");

function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  for (const [unit, sec] of [["d", 86400], ["h", 3600], ["m", 60]]) if (s >= sec) return `${Math.floor(s / sec)}${unit} ago`;
}

function initials(name) {
  const t = (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='#0d1f0a'/><text x='50%' y='54%' fill='#39ff14' font-family='Inter,sans-serif' font-size='30' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${t}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27");
}

let launches = [];
let sortKey = "new";
let query = "";

const sorters = {
  new: (a, b) => b.blockNumber - a.blockNumber,
  mcap: (a, b) => b.marketCapEth - a.marketCapEth,
  progress: (a, b) => b.progress - a.progress,
};

function card(c) {
  const logo = safeUrl(c.logo) || (c.logo?.startsWith("data:image/") ? c.logo : "") || initials(c.name);
  return `<article class="coin" data-token="${esc(c.token)}">
    <div class="coin-top">
      <img class="coin-logo" src="${esc(logo)}" alt="" loading="lazy" data-fallback="${esc(initials(c.name))}" />
      <div class="coin-id">
        <div class="name">${esc(c.name)}</div>
        <div class="handle"><span class="tick">$${esc(c.symbol)}</span>${c.handle ? ` · <a href="https://x.com/${esc(c.handle)}" target="_blank" rel="noopener">@${esc(c.handle)}</a>` : ""}</div>
      </div>
      ${c.graduated ? `<span class="badge-grad">Graduated</span>` : ""}
    </div>
    ${c.description ? `<p class="coin-desc">${esc(c.description)}</p>` : ""}
    <div class="coin-stats">
      <div><span>Market cap</span><b>${eth(c.marketCapEth)}</b></div>
      <div><span>Created</span><b>${esc(ago(c.createdAt))}</b></div>
    </div>
    <div class="coin-progress" title="${c.raisedEth.toFixed(4)} / ${c.graduationEth} ETH to graduation">
      <div class="bar"><i style="width:${c.progress.toFixed(1)}%"></i></div>
      <span>${c.progress.toFixed(1)}%</span>
    </div>
    <div class="coin-links">
      <a href="${EXPLORER}/token/${c.token}" target="_blank" rel="noopener">${short(c.token)} ↗</a>
      <a href="token.html?address=${esc(c.token)}" class="trade-link">Trade →</a>
    </div>
  </article>`;
}

function render() {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const list = launches
    .filter((c) => !q || [c.name, c.symbol, c.handle, c.token].some((v) => v && v.toLowerCase().includes(q)))
    .sort(sorters[sortKey]);
  $("#grid").innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="explore-empty">${launches.length ? `No coins match “${esc(query)}”.` : `No profile coins yet. <a href="launch.html">Launch the first one →</a>`}</div>`;
  $$(".coin").forEach((el) => el.addEventListener("click", (e) => {
    if (!e.target.closest("a")) location.href = `token.html?address=${el.dataset.token}`;
  }));
  $$(".coin-logo").forEach((img) => img.addEventListener("error", () => { img.src = img.dataset.fallback; }, { once: true }));
}

async function load() {
  try {
    const res = await fetch("/api/launches");
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`server error ${res.status}${text ? ` — ${text.slice(0, 80)}` : ""}`); }
    if (!res.ok) throw new Error(data.error || res.statusText);
    launches = data.launches;
    if (!data.complete && !launches.length) {
      $("#grid").innerHTML = `<div class="explore-empty">Scanning Robinhood Chain for SPIDERPAD launches…</div>`;
    } else render();
    // The server scans in steps; keep going until it reaches the chain head.
    if (!data.complete) setTimeout(load, 3000);
  } catch (err) {
    $("#grid").innerHTML = `<div class="explore-empty">Couldn't load launches: ${esc(err.message)}. <a href="#" id="retry">Retry</a></div>`;
    $("#retry").addEventListener("click", (e) => { e.preventDefault(); load(); });
  }
}

$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
  sortKey = b.dataset.sort;
  render();
}));
$("#search").addEventListener("input", (e) => { query = e.target.value; render(); });
$("#year").textContent = new Date().getFullYear();
load();
setInterval(load, 60_000);
