import {
  createPublicClient, createWalletClient, custom, http, parseEther, formatEther,
  decodeEventLog, zeroAddress, isAddress,
} from "./vendor/viem.js";
import { robinhood, PONS, factoryAbi, forwarderAbi, quoteOpeningBuy, applySlippage, randomSalt, SPIDERPAD_MARKER, ensureChain } from "./pons.js";
import { CREATOR_TAX_BPS, SPIDERPAD_FEE_VAULT } from "./config.js";
import { SPLITTER_ABI, SPLITTER_BYTECODE } from "./splitter.js";
import { pickWallet, lastWallet, rememberWallet } from "./wallets.js";

const $ = (s) => document.querySelector(s);
const SLIPPAGE_BPS = 300;
const LOGO_MAX = 512;

const els = {
  handle: $("#handle"), detect: $("#detectBtn"), detected: $("#detected"),
  displayName: $("#displayName"), bio: $("#bio"),
  logoPreview: $("#logoPreview"), feeOwner: $("#feeOwner"),
  coinName: $("#coinName"), ticker: $("#ticker"), hook: $("#hook"),
  twitter: $("#twitter"), website: $("#website"),
  initialBuy: $("#initialBuy"), buyback: $("#buyback"),
  connect: $("#connectBtn"), launch: $("#launchBtn"), status: $("#status"),
};

const state = { profile: null, logo: "", account: null, wallet: null, client: null, provider: null, walletInfo: null, terms: null, busy: false };

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

  // Name, ticker, avatar and X link are derived from the profile and locked.
  state.profile = {
    handle: p.handle,
    name: p.name.trim().slice(0, 64) || p.handle,
    symbol: p.handle.toUpperCase(),
    twitter: `https://x.com/${p.handle}`,
  };
  els.displayName.value = state.profile.name;
  els.bio.value = p.bio;
  els.coinName.value = state.profile.name;
  els.ticker.value = state.profile.symbol;
  els.hook.value = p.bio.split("\n")[0].slice(0, 280);
  els.twitter.value = state.profile.twitter;
  els.website.value = p.website || "";
  setLogo(p.avatar.length <= LOGO_MAX ? p.avatar : "");
  renderFeeOwner();

  els.detected.hidden = false;
  els.detected.innerHTML = `<div><b>@${esc(p.handle)}</b> <span class="muted">· x.com` +
    (p.followers != null ? ` · ${compact(p.followers)} followers` : "") + `</span></div>` +
    (p.fallback ? `<div class="muted">Couldn't reach the X profile API — the coin uses the handle as its name.</div>` : "");

  const url = new URL(location.href);
  url.searchParams.set("handle", p.handle);
  url.searchParams.set("source", "x");
  history.replaceState(null, "", url);
  updateEstimate();
}

els.detect.addEventListener("click", detect);
els.handle.addEventListener("keydown", (e) => { if (e.key === "Enter") detect(); });
els.handle.addEventListener("input", () => {
  if (state.profile && cleanHandle(els.handle.value).toLowerCase() !== state.profile.handle.toLowerCase()) {
    els.detect.textContent = "Detect profile";
  }
});

function renderFeeOwner() {
  const who = state.account
    ? `<a href="${robinhood.blockExplorers.default.url}/address/${state.account}" target="_blank" rel="noopener" class="mono">${short(state.account)}</a>`
    : "your connected wallet";
  els.feeOwner.innerHTML = `<span class="fee-ico">◆</span>
    <div><b>You earn creator fees from every trade.</b>
    <div class="muted">Claim them anytime from the coin page to ${who}.</div></div>`;
}

// ---------- chain ----------
function readClient() {
  return state.client ?? createPublicClient({ chain: robinhood, transport: http() });
}

async function loadTerms() {
  const c = readClient();
  const read = (functionName, args) => c.readContract({ address: PONS.factory, abi: factoryAbi, functionName, args });
  const [launchFee, launchEnabled, count, maxTax] = await Promise.all([
    read("launchFee"), read("launchEnabled"), read("launchConfigCount"), read("maxCreatorTaxBps").catch(() => 0n),
  ]);
  const creatorTaxBps = BigInt(CREATOR_TAX_BPS) < maxTax ? BigInt(CREATOR_TAX_BPS) : maxTax;
  let configId = null, config = null;
  for (let i = 0n; i < count; i++) {
    const cfg = await read("getLaunchConfig", [i]);
    if (cfg.enabled) { configId = i; config = cfg; break; }
  }
  state.terms = { launchFee, launchEnabled, configId, config, creatorTaxBps };
  $("#mFee").textContent = fmtEth(launchFee);
  if (config) {
    $("#mCurveFee").textContent = `${Number(config.curveFeeBps + creatorTaxBps) / 100}%`;
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
  $("#mOut").textContent = cfg && buy > 0n ? `≈ ${fmtTokens(quoteOpeningBuy(cfg, buy, state.terms.creatorTaxBps))} ${els.ticker.value || ""}` : "—";
}
els.initialBuy.addEventListener("input", updateEstimate);

function setConnectedUi() {
  const w = state.walletInfo;
  els.connect.innerHTML = state.account
    ? `${w?.icon ? `<img class="wallet-icon" src="${esc(w.icon)}" alt="" />` : ""}${short(state.account)}`
    : "Connect wallet";
  els.launch.textContent = state.account ? "Launch coin" : "Connect wallet to launch";
}

function disconnect() {
  state.account = state.wallet = state.client = state.provider = state.walletInfo = null;
  rememberWallet(null);
  setConnectedUi();
  renderFeeOwner();
  toast("Wallet disconnected");
}

// Connects a specific wallet. With silent, only reuses an existing approval.
async function useWallet({ info, provider }, { silent = false } = {}) {
  const method = silent ? "eth_accounts" : "eth_requestAccounts";
  const [account] = await provider.request({ method });
  if (!account) return false;
  if (!silent) await ensureChain(provider);
  state.provider = provider;
  state.walletInfo = info;
  state.account = account;
  state.wallet = createWalletClient({ account, chain: robinhood, transport: custom(provider) });
  state.client = createPublicClient({ chain: robinhood, transport: custom(provider) });
  rememberWallet(info.rdns);
  setConnectedUi();
  renderFeeOwner();
  provider.on?.("accountsChanged", (accs) => {
    if (state.provider !== provider) return;
    if (!accs[0]) return disconnect();
    state.account = accs[0];
    state.wallet = createWalletClient({ account: accs[0], chain: robinhood, transport: custom(provider) });
    setConnectedUi();
    renderFeeOwner();
  });
  provider.on?.("chainChanged", () => { if (state.provider === provider) location.reload(); });
  await loadTerms().catch((e) => toast("Couldn't read launch terms: " + (e.shortMessage || e.message)));
  return true;
}

async function connect() {
  const choice = await pickWallet({
    connected: state.account ? { info: state.walletInfo ?? { name: "Wallet" }, account: state.account } : null,
  });
  if (!choice) return false;
  if (choice.disconnect) { disconnect(); return false; }
  return useWallet(choice);
}

els.connect.addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));

// Reconnect quietly to the wallet used last time, without a prompt.
setTimeout(() => {
  const last = lastWallet();
  if (last && !state.account) useWallet(last, { silent: true }).catch(() => {});
}, 300);

// ---------- launch ----------
function collectParams() {
  const p = state.profile;
  if (!p) throw new Error("Detect an X profile first");
  if (cleanHandle(els.handle.value).toLowerCase() !== p.handle.toLowerCase()) {
    throw new Error(`Handle changed — re-detect @${cleanHandle(els.handle.value)} before launching`);
  }
  return {
    name: p.name,
    symbol: p.symbol,
    logo: state.logo.startsWith("data:") ? "" : state.logo,
    description: els.hook.value.trim(),
    socials: { twitter: p.twitter, telegram: "", discord: "", website: els.website.value.trim(), farcaster: "" },
    // Replaced by the launcher's fee splitter right before launching.
    creatorFeeRecipient: state.account,
    creatorTaxBps: Number(state.terms?.creatorTaxBps ?? 0n),
    buybackEnabled: els.buyback.checked,
  };
}

// The launcher's fee splitter: half of the coin's creator fees to the launcher,
// half to the SPIDERPAD vault. One splitter serves all of a wallet's coins, so
// it is deployed once and reused on later launches.
async function feeSplitter() {
  const escrow = await state.client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "feeEscrow" });
  const key = `spiderpad:splitter:${state.account.toLowerCase()}`;
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  if (saved && isAddress(saved)) {
    const read = (functionName) => state.client.readContract({ address: saved, abi: SPLITTER_ABI, functionName }).catch(() => null);
    const [creator, vault, esc] = await Promise.all([read("creator"), read("vault"), read("escrow")]);
    if (creator?.toLowerCase() === state.account.toLowerCase() && vault?.toLowerCase() === SPIDERPAD_FEE_VAULT.toLowerCase() && esc?.toLowerCase() === escrow.toLowerCase()) return saved;
  }
  setStatus("Step 1 of 2: confirm creating your fee wallet…");
  const hash = await state.wallet.deployContract({ abi: SPLITTER_ABI, bytecode: SPLITTER_BYTECODE, args: [state.account, SPIDERPAD_FEE_VAULT, escrow] });
  setStatus(`Creating your fee wallet… <a href="${robinhood.blockExplorers.default.url}/tx/${hash}" target="_blank" rel="noopener">view transaction ↗</a>`);
  const receipt = await state.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Couldn't create the fee wallet");
  try { localStorage.setItem(key, receipt.contractAddress); } catch {}
  return receipt.contractAddress;
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
    if (!terms.launchEnabled) throw new Error("Launches are currently paused");
    if (terms.configId == null) throw new Error("No launch config is enabled right now");
    const canLaunch = await state.client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "canLaunch", args: [state.account] });
    if (!canLaunch) throw new Error("This wallet isn't allowed to launch right now");

    // Pin the economics we just showed so a re-peg can't land under the tx.
    const expectedEconomics = await state.client.readContract({
      address: PONS.factory, abi: factoryAbi, functionName: "previewLaunchEconomics", args: [terms.configId, zeroAddress],
    });
    const params = { ...base, creatorTaxBps: Number(terms.creatorTaxBps), expectedEconomics, salt: randomSalt() };
    const buy = initialBuyWei();
    const minOut = buy > 0n ? applySlippage(quoteOpeningBuy(terms.config, buy, terms.creatorTaxBps), SLIPPAGE_BPS) : 0n;
    const simulate = (p) => buy > 0n
      ? state.client.simulateContract({
        account: state.account, address: PONS.forwarder, abi: forwarderAbi, functionName: "launchAndBuy",
        args: [p, terms.configId, zeroAddress, buy, minOut, state.account, [SPIDERPAD_MARKER]],
        value: terms.launchFee + buy,
      })
      : state.client.simulateContract({
        account: state.account, address: PONS.factory, abi: factoryAbi, functionName: "launchToken",
        args: [p, terms.configId, zeroAddress, [SPIDERPAD_MARKER]],
        value: terms.launchFee,
      });

    // Check the launch would go through before asking for any signature.
    await simulate({ ...params, creatorFeeRecipient: state.account });
    params.creatorFeeRecipient = await feeSplitter();
    const { request } = await simulate(params);

    setStatus("Step 2 of 2: confirm the launch in your wallet…");
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
        ? `🚀 <b>$${esc(params.symbol)}</b> is live on Robinhood Chain. Claim your creator fees anytime from the coin page.<br>
           Token: <a href="${ex}/address/${launched.token}" target="_blank" rel="noopener">${short(launched.token)} ↗</a> ·
           Curve: <a href="${ex}/address/${launched.curve}" target="_blank" rel="noopener">${short(launched.curve)} ↗</a><br>
           <a href="token.html?address=${launched.token}">Open coin page →</a> · <a href="explore.html">Explore</a> · <a href="https://ponsfamily.com" target="_blank" rel="noopener">Trade ↗</a> · <a href="${txUrl}" target="_blank" rel="noopener">Transaction ↗</a>`
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
renderFeeOwner();
const qs = new URLSearchParams(location.search);
if (qs.get("handle")) {
  els.handle.value = qs.get("handle");
  detect();
}
loadTerms().catch(() => {}); // public RPC may block browser reads until a wallet connects
