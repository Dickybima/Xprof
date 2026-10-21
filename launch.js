import {
  createPublicClient, createWalletClient, custom, http, parseEther, formatEther,
  decodeEventLog, zeroAddress, isAddress,
} from "./vendor/viem.js";
import { robinhood, PONS, factoryAbi, forwarderAbi, quoteOpeningBuy, applySlippage, randomSalt } from "./pons.js";

const $ = (s) => document.querySelector(s);
const SLIPPAGE_BPS = 300;
const LOGO_MAX = 512;

const els = {
  handle: $("#handle"), detect: $("#detectBtn"), detected: $("#detected"),
  displayName: $("#displayName"), bio: $("#bio"),
  logoPreview: $("#logoPreview"), logoFile: $("#logoFile"),
  coinName: $("#coinName"), ticker: $("#ticker"), hook: $("#hook"),
  twitter: $("#twitter"), website: $("#website"), feeRecipient: $("#feeRecipient"),
  initialBuy: $("#initialBuy"), buyback: $("#buyback"),
  connect: $("#connectBtn"), launch: $("#launchBtn"), status: $("#status"),
};

const state = { logo: "", account: null, wallet: null, client: null, terms: null, busy: false };

// ---------- helpers ----------
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function setStatus(html, kind = "") {
  els.status.hidden = !html;
  els.status.className = "status " + kind;
  els.status.innerHTML = html;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const fmtEth = (wei) => `${Number(formatEther(wei)).toLocaleString("en", { maximumFractionDigits: 6 })} ETH`;
const fmtTokens = (wei) => compact(Number(formatEther(wei)));
const cleanHandle = (v) => v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
const tickerFrom = (s) => s.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase();

function initialsAvatar(name) {
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#18181b'/><text x='50%' y='54%' fill='#e4e4e7' font-family='Inter,sans-serif' font-size='44' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${initials}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function setLogo(url) {
  state.logo = url;
  els.logoPreview.src = url || initialsAvatar(els.coinName.value);
}
els.logoPreview.addEventListener("error", () => { els.logoPreview.src = initialsAvatar(els.coinName.value); });

// ---------- step 1: detect X profile ----------
async function fetchXProfile(handle) {
  // fxtwitter exposes public X profile data with CORS enabled.
  const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
  if (!res.ok) throw new Error(`Profile lookup failed (${res.status})`);
  const data = await res.json();
  if (!data.user) throw new Error("Profile not found");
  const u = data.user;
  return {
    handle: u.screen_name || handle,
    name: u.name || handle,
    bio: u.description || "",
    avatar: (u.avatar_url || "").replace("_normal.", "_400x400."),
    followers: u.followers ?? null,
    website: u.website?.url || "",
  };
}

async function detect() {
  const handle = cleanHandle(els.handle.value);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return toast("Enter a valid X handle");
  els.handle.value = handle;
  els.detect.disabled = true;
  els.detect.textContent = "Detecting…";
  let p;
  try {
    p = await fetchXProfile(handle);
  } catch (err) {
    // Fall back to what we can derive without the profile API.
    p = { handle, name: handle, bio: "", avatar: `https://unavatar.io/x/${handle}`, followers: null, website: "", fallback: true };
  }
  els.detect.disabled = false;
  els.detect.textContent = "Re-detect profile";

  els.displayName.value = p.name;
  els.bio.value = p.bio;
  els.coinName.value = p.name.slice(0, 64);
  els.ticker.value = tickerFrom(p.handle);
  els.hook.value = p.bio.split("\n")[0].slice(0, 280);
  els.twitter.value = `https://x.com/${p.handle}`;
  if (p.website) els.website.value = p.website;
  setLogo(p.avatar);

  els.detected.hidden = false;
  els.detected.innerHTML = `<div><b>@${esc(p.handle)}</b> <span class="muted">· x.com` +
    (p.followers != null ? ` · ${compact(p.followers)} followers` : "") + `</span></div>` +
    `<div class="muted">${p.fallback ? "Couldn't reach the X profile API — fill in the details by hand." : "Creator fees route to the recipient you set on the right."}</div>`;

  const url = new URL(location.href);
  url.searchParams.set("handle", p.handle);
  url.searchParams.set("source", "x");
  history.replaceState(null, "", url);
  updateEstimate();
}

els.detect.addEventListener("click", detect);
els.handle.addEventListener("keydown", (e) => { if (e.key === "Enter") detect(); });
els.displayName.addEventListener("input", () => { els.coinName.value = els.displayName.value.slice(0, 64); });
els.bio.addEventListener("input", () => { els.hook.value = els.bio.value.split("\n")[0].slice(0, 280); });
els.ticker.addEventListener("input", () => { els.ticker.value = els.ticker.value.toUpperCase().replace(/\s/g, ""); });

// ---------- avatar upload (compressed to fit the on-chain logo field) ----------
els.logoFile.addEventListener("change", async () => {
  const file = els.logoFile.files[0];
  if (!file) return;
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  for (const size of [64, 48, 40, 32, 24]) {
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    for (const q of [0.7, 0.5, 0.3]) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.startsWith("data:image/webp") && url.length <= LOGO_MAX) {
        setLogo(url);
        return toast(`Avatar compressed to ${size}px for on-chain use`);
      }
    }
  }
  toast("Image too detailed to store on-chain — the X avatar URL is kept");
});

// ---------- chain ----------
function readClient() {
  return state.client ?? createPublicClient({ chain: robinhood, transport: http() });
}

async function loadTerms() {
  const c = readClient();
  const read = (functionName, args) => c.readContract({ address: PONS.factory, abi: factoryAbi, functionName, args });
  const [launchFee, launchEnabled, count] = await Promise.all([read("launchFee"), read("launchEnabled"), read("launchConfigCount")]);
  let configId = null, config = null;
  for (let i = 0n; i < count; i++) {
    const cfg = await read("getLaunchConfig", [i]);
    if (cfg.enabled) { configId = i; config = cfg; break; }
  }
  state.terms = { launchFee, launchEnabled, configId, config };
  $("#mFee").textContent = fmtEth(launchFee);
  if (config) {
    $("#mCurveFee").textContent = `${Number(config.curveFeeBps) / 100}%`;
    $("#mGrad").textContent = fmtEth(config.graduationThreshold);
    $("#mSupply").textContent = fmtTokens(config.supply);
  }
  updateEstimate();
  return state.terms;
}

function initialBuyWei() {
  const v = els.initialBuy.value.trim();
  if (!v || Number(v) <= 0) return 0n;
  return parseEther(v);
}

function updateEstimate() {
  const cfg = state.terms?.config;
  let buy;
  try { buy = initialBuyWei(); } catch { buy = 0n; }
  $("#mOut").textContent = cfg && buy > 0n ? `≈ ${fmtTokens(quoteOpeningBuy(cfg, buy))} ${els.ticker.value || ""}` : "—";
}
els.initialBuy.addEventListener("input", updateEstimate);

async function ensureChain(provider) {
  const hex = "0x" + robinhood.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    if (err.code !== 4902 && err?.data?.originalError?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex, chainName: robinhood.name, nativeCurrency: robinhood.nativeCurrency,
        rpcUrls: robinhood.rpcUrls.default.http, blockExplorerUrls: [robinhood.blockExplorers.default.url],
      }],
    });
  }
}

async function connect() {
  const provider = window.ethereum;
  if (!provider) {
    toast("No EVM wallet found — install MetaMask, Rabby or similar");
    return false;
  }
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  await ensureChain(provider);
  state.account = account;
  state.wallet = createWalletClient({ account, chain: robinhood, transport: custom(provider) });
  state.client = createPublicClient({ chain: robinhood, transport: custom(provider) });
  els.connect.textContent = short(account);
  els.launch.textContent = "Launch coin";
  if (!els.feeRecipient.value) els.feeRecipient.placeholder = `${short(account)} (connected wallet)`;
  provider.on?.("accountsChanged", (accs) => {
    state.account = accs[0] ?? null;
    els.connect.textContent = state.account ? short(state.account) : "Connect wallet";
    els.launch.textContent = state.account ? "Launch coin" : "Connect wallet to launch";
  });
  provider.on?.("chainChanged", () => location.reload());
  await loadTerms().catch((e) => toast("Couldn't read Pons terms: " + (e.shortMessage || e.message)));
  return true;
}

els.connect.addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));

// ---------- launch ----------
function collectParams() {
  const name = els.coinName.value.trim();
  const symbol = els.ticker.value.trim();
  if (!name) throw new Error("Coin name is required");
  if (!symbol) throw new Error("Ticker is required");
  if (symbol.length > 16) throw new Error("Ticker must be 16 characters or fewer");
  const logo = state.logo.startsWith("data:image/svg") ? "" : state.logo;
  if (logo.length > LOGO_MAX) throw new Error("Avatar is too large for on-chain storage");
  const recipient = els.feeRecipient.value.trim();
  if (recipient && !isAddress(recipient)) throw new Error("Creator fee recipient must be a valid address");
  return {
    name, symbol, logo,
    description: els.hook.value.trim(),
    socials: { twitter: els.twitter.value.trim(), telegram: "", discord: "", website: els.website.value.trim(), farcaster: "" },
    creatorFeeRecipient: recipient || state.account,
    creatorTaxBps: 0,
    buybackEnabled: els.buyback.checked,
  };
}

async function launch() {
  if (state.busy) return;
  if (!state.account && !(await connect())) return;
  state.busy = true;
  els.launch.disabled = true;
  try {
    const base = collectParams();
    setStatus("Reading live launch terms…");
    const terms = await loadTerms();
    if (!terms.launchEnabled) throw new Error("Pons launches are currently paused");
    if (terms.configId == null) throw new Error("No enabled Pons launch config");
    const canLaunch = await state.client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "canLaunch", args: [state.account] });
    if (!canLaunch) throw new Error("This wallet isn't allowed to launch on Pons right now");

    // Pin the economics we just showed so a re-peg can't land under the tx.
    const expectedEconomics = await state.client.readContract({
      address: PONS.factory, abi: factoryAbi, functionName: "previewLaunchEconomics", args: [terms.configId, zeroAddress],
    });
    const params = { ...base, expectedEconomics, salt: randomSalt() };
    const buy = initialBuyWei();

    let request;
    if (buy > 0n) {
      const minOut = applySlippage(quoteOpeningBuy(terms.config, buy), SLIPPAGE_BPS);
      ({ request } = await state.client.simulateContract({
        account: state.account, address: PONS.forwarder, abi: forwarderAbi, functionName: "launchAndBuy",
        args: [params, terms.configId, zeroAddress, buy, minOut, state.account, []],
        value: terms.launchFee + buy,
      }));
    } else {
      ({ request } = await state.client.simulateContract({
        account: state.account, address: PONS.factory, abi: factoryAbi, functionName: "launchToken",
        args: [params, terms.configId, zeroAddress, []],
        value: terms.launchFee,
      }));
    }

    setStatus("Confirm the transaction in your wallet…");
    const hash = await state.wallet.writeContract(request);
    const txUrl = `${robinhood.blockExplorers.default.url}/tx/${hash}`;
    setStatus(`Launching… <a href="${txUrl}" target="_blank" rel="noopener">view transaction ↗</a>`);
    const receipt = await state.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");

    let launched = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== PONS.factory.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "TokenLaunched") { launched = ev.args; break; }
      } catch {}
    }
    const ex = robinhood.blockExplorers.default.url;
    setStatus(
      launched
        ? `🚀 <b>$${esc(params.symbol)}</b> is live on Pons v2.<br>
           Token: <a href="${ex}/address/${launched.token}" target="_blank" rel="noopener">${short(launched.token)} ↗</a> ·
           Curve: <a href="${ex}/address/${launched.curve}" target="_blank" rel="noopener">${short(launched.curve)} ↗</a><br>
           <a href="https://ponsfamily.com" target="_blank" rel="noopener">Trade on Pons ↗</a> · <a href="${txUrl}" target="_blank" rel="noopener">Transaction ↗</a>`
        : `Launched. <a href="${txUrl}" target="_blank" rel="noopener">View transaction ↗</a>`,
      "ok",
    );
  } catch (err) {
    setStatus(esc(err.shortMessage || err.message || String(err)), "err");
  } finally {
    state.busy = false;
    els.launch.disabled = false;
  }
}
els.launch.addEventListener("click", launch);

// ---------- init ----------
$("#year").textContent = new Date().getFullYear();
setLogo("");
const qs = new URLSearchParams(location.search);
if (qs.get("handle")) {
  els.handle.value = qs.get("handle");
  detect();
}
loadTerms().catch(() => {}); // public RPC may block browser reads until a wallet connects
