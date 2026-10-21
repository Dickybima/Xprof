// Wallet picker. Installed browser wallets announce themselves through
// EIP-6963; popular wallets that aren't installed get an install link, and
// on phones without an injected wallet we offer each app's in-app browser.

const KNOWN = [
  { rdns: "io.metamask", name: "MetaMask", install: "https://metamask.io/download/", mobile: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { rdns: "io.rabby", name: "Rabby Wallet", install: "https://rabby.io/" },
  { rdns: "com.okex.wallet", name: "OKX Wallet", install: "https://www.okx.com/web3", mobile: (u) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", install: "https://www.coinbase.com/wallet/downloads", mobile: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { rdns: "com.trustwallet.app", name: "Trust Wallet", install: "https://trustwallet.com/download", mobile: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}` },
];

const discovered = new Map(); // rdns -> { info, provider }
window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider } = e.detail || {};
  if (info?.rdns && provider) discovered.set(info.rdns, { info, provider });
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LAST_KEY = "spiderpad:wallet";

export function rememberWallet(rdns) {
  try { rdns ? localStorage.setItem(LAST_KEY, rdns) : localStorage.removeItem(LAST_KEY); } catch {}
}

/** The wallet used last time, if it is still installed. */
export function lastWallet() {
  let rdns = null;
  try { rdns = localStorage.getItem(LAST_KEY); } catch {}
  if (!rdns) return null;
  if (rdns === "injected") return window.ethereum ? injected() : null;
  return discovered.get(rdns) ?? null;
}

function injected() {
  return { info: { rdns: "injected", name: "Browser wallet", icon: "" }, provider: window.ethereum };
}

function walletList() {
  const list = [...discovered.values()];
  // Older wallets that only inject window.ethereum.
  if (!list.length && window.ethereum) list.push(injected());
  return list;
}

function icon(info) {
  return info.icon
    ? `<img src="${esc(info.icon)}" alt="" />`
    : `<span class="w-fallback">${esc(info.name[0] || "?")}</span>`;
}

let dialog;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "wallet-modal";
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

/**
 * Opens the picker. Resolves with { info, provider } for the chosen wallet,
 * { disconnect: true } when the user disconnects, or null if dismissed.
 */
export function pickWallet({ connected } = {}) {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const d = ensureDialog();
  return new Promise((resolve) => {
    let result = null;
    const installed = walletList();
    const missing = KNOWN.filter((k) => !discovered.has(k.rdns));
    const here = location.href;

    d.innerHTML = `
      <div class="wm-head">
        <h3>${connected ? "Wallet" : "Connect a wallet"}</h3>
        <button class="wm-close" aria-label="Close">×</button>
      </div>
      ${connected ? `
        <div class="wm-connected">
          ${icon(connected.info)}
          <div><b>${esc(connected.info.name)}</b><div class="muted mono">${esc(connected.account)}</div></div>
        </div>
        <button class="btn btn-ghost btn-block wm-disconnect">Disconnect</button>
        <div class="wm-label">Switch wallet</div>` : ""}
      ${installed.length ? `
        ${connected ? "" : `<div class="wm-label">Installed</div>`}
        <div class="wm-list">${installed.map((w, i) => `
          <button class="wm-item" data-i="${i}">${icon(w.info)}<span>${esc(w.info.name)}</span><em>Detected</em></button>`).join("")}
        </div>` : `<p class="wm-note">${isMobile() ? "Open SPIDERPAD inside your wallet app's browser:" : "No browser wallet detected. Install one to continue:"}</p>`}
      ${missing.length ? `
        <div class="wm-label">${installed.length ? "More wallets" : isMobile() ? "Wallet apps" : "Get a wallet"}</div>
        <div class="wm-list">${missing.map((k) => {
          const href = isMobile() && k.mobile ? k.mobile(here) : k.install;
          return `<a class="wm-item" href="${esc(href)}" target="_blank" rel="noopener"><span class="w-fallback">${esc(k.name[0])}</span><span>${esc(k.name)}</span><em>${isMobile() && k.mobile ? "Open app ↗" : "Install ↗"}</em></a>`;
        }).join("")}
        </div>` : ""}
      <p class="wm-foot">Launches run on Robinhood Chain. Your wallet will be asked to switch networks.</p>`;

    d.querySelector(".wm-close").onclick = () => d.close();
    d.querySelector(".wm-disconnect")?.addEventListener("click", () => { result = { disconnect: true }; d.close(); });
    d.querySelectorAll("button.wm-item").forEach((b) => b.addEventListener("click", () => {
      result = installed[Number(b.dataset.i)];
      d.close();
    }));
    d.addEventListener("close", () => resolve(result), { once: true });
    d.showModal();
  });
}
