import { createPublicClient, createWalletClient, custom, parseEther, formatEther, isAddress } from "./vendor/viem.js";
import { robinhood, curveAbi, tokenAbi, escrowAbi, quoteBuy, quoteSell, applySlippage, ensureChain, onRobinhood } from "./pons.js";
import { pickWallet, lastWallet, rememberWallet } from "./wallets.js";
import { SPLITTER_ABI } from "./splitter.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const EXPLORER = robinhood.blockExplorers.default.url;

// token.html?address=0x… or the share link /c/0x…
const address = new URLSearchParams(location.search).get("address")
  || (location.pathname.match(/\/c\/(0x[0-9a-fA-F]{40})/) || [])[1] || "";
const state = {
  data: null, side: "buy", slippageBps: 1000, interval: 300, metric: "price",
  account: null, provider: null, walletInfo: null, wallet: null, client: null,
  ethBalance: null, tokenBalance: null, snipeBps: 0n, busy: false,
};

// ---------- formatting ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const SUB = "₀₁₂₃₄₅₆₇₈₉";
// Small prices as 0.0₅3124 (five zeros after the point).
function tiny(n, digits = 4) {
  if (!n) return "0";
  if (n >= 1) return n.toLocaleString("en", { maximumFractionDigits: 4 });
  if (n >= 0.001) return n.toPrecision(digits).replace(/0+$/, "");
  const zeros = Math.floor(-Math.log10(n)) - 1;
  const sig = Math.round(n * 10 ** (zeros + digits)).toString().replace(/0+$/, "");
  return `0.0${String(zeros).split("").map((d) => SUB[d]).join("")}${sig}`;
}
const eth = (n) => `${n >= 0.01 ? n.toLocaleString("en", { maximumFractionDigits: 4 }) : tiny(n, 3)} ETH`;
const usd = (n) => (n >= 1000 ? "$" + compact(n) : n >= 1 ? "$" + n.toFixed(2) : "$" + tiny(n, 4));
function ago(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.floor(s)}s ago`;
  for (const [unit, sec] of [["d", 86400], ["h", 3600], ["m", 60]]) if (s >= sec) return `${Math.floor(s / sec)}${unit} ago`;
}
function initials(name) {
  const t = (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#0d1f0a'/><text x='50%' y='54%' fill='#39ff14' font-family='Inter,sans-serif' font-size='44' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${t}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27");
}
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function setStatus(html, kind = "") {
  const el = $("#tradeStatus");
  el.hidden = !html;
  el.className = "status " + kind;
  el.innerHTML = html;
}

// ---------- sharing ----------
// /c/<address> serves this page with Open Graph tags, so the link unfurls into
// the coin's share card (/api/og) on X, Telegram and Discord.
const shareUrl = (coin) => `${location.origin}/c/${coin.token}`;
function shareIntent(coin) {
  const who = coin.handle ? `the profile coin of @${coin.handle}` : coin.name;
  const text = `$${coin.symbol}, ${who}, is live on @SpiderpadHQ 🕷️`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl(coin))}`;
}

// ---------- hero ----------
function renderHero() {
  const { coin, ethUsd } = state.data;
  const logo = /^https:\/\//i.test(coin.logo) || coin.logo.startsWith("data:image/") ? coin.logo : initials(coin.name);
  const stat = (label, main, sub) => `<div class="stat"><span>${label}</span><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  document.title = `${coin.name} ($${coin.symbol}) · SPIDERPAD`;
  $("#hero").innerHTML = `
    <div class="hero-top">
      <img class="hero-logo" src="${esc(logo)}" alt="" data-fallback="${esc(initials(coin.name))}" />
      <div class="hero-id">
        <div class="hero-name"><h1>${esc(coin.name)}</h1><span class="hero-tick">$${esc(coin.symbol)}</span>
          <span class="chain-badge"><span class="chain-dot"></span>Robinhood Chain</span>
          ${coin.graduated ? `<span class="badge-grad">Graduated</span>` : ""}</div>
        <div class="hero-links">
          <button class="copy" data-copy="${coin.token}" title="Copy contract address">CA ${short(coin.token)} ⧉</button>
          ${coin.handle ? `<a href="https://x.com/${esc(coin.handle)}" target="_blank" rel="noopener">𝕏 @${esc(coin.handle)}</a>` : ""}
          <a href="${EXPLORER}/address/${coin.deployer}" target="_blank" rel="noopener">Creator ${short(coin.deployer)}</a>
          <a href="${EXPLORER}/token/${coin.token}" target="_blank" rel="noopener">Blockscout ↗</a>
          ${/^https:\/\//i.test(coin.website) ? `<a href="${esc(coin.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
        </div>
        ${coin.description ? `<p class="hero-desc">${esc(coin.description)}</p>` : ""}
      </div>
      <div class="hero-share">
        <a class="btn btn-primary share-x" href="${esc(shareIntent(coin))}" target="_blank" rel="noopener">Share on 𝕏</a>
        <button class="btn btn-ghost share-copy" type="button">Copy link</button>
      </div>
    </div>
    <div class="hero-stats">
      ${stat("Market cap", ethUsd ? usd(coin.marketCapEth * ethUsd) : eth(coin.marketCapEth), ethUsd ? eth(coin.marketCapEth) : "")}
      ${stat("Price", ethUsd ? usd(coin.priceEth * ethUsd) : eth(coin.priceEth), ethUsd ? `${tiny(coin.priceEth)} ETH` : "")}
      ${stat("In curve", eth(coin.raisedEth), `of ${eth(coin.graduationEth)} to graduate`)}
      ${stat("Bonding curve", `${coin.progress.toFixed(1)}%`, coin.graduated ? "graduated" : "to graduation")}
    </div>
    <div class="hero-bar"><i style="width:${coin.progress.toFixed(2)}%"></i></div>`;
  const img = $(".hero-logo");
  img.addEventListener("error", () => { img.src = img.dataset.fallback; }, { once: true });
  $(".share-copy").addEventListener("click", () => {
    navigator.clipboard?.writeText(shareUrl(coin)).then(() => toast("Share link copied"), () => {});
  });
  $(".copy").addEventListener("click", (e) => {
    navigator.clipboard?.writeText(e.currentTarget.dataset.copy).then(() => toast("Contract address copied"), () => {});
  });
  const totalPct = (Number(coin.curveState.feeBps) + Number(coin.curveState.creatorTaxBps)) / 100;
  $("#creatorNote").innerHTML = `Every trade pays ${totalPct}% in fees. Creator fees go to the wallet that launched this coin, <a href="${EXPLORER}/address/${coin.deployer}" target="_blank" rel="noopener" class="mono">${short(coin.deployer)}</a>. Only that wallet can claim.`;
  renderClaim();
}

// ---------- chart ----------
let chart, series;
function ensureChart() {
  if (chart || !window.LightweightCharts) return;
  const el = $("#chart");
  chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "#8a8a93", fontFamily: "JetBrains Mono, monospace" },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
    rightPriceScale: { borderColor: "#1f1f24" },
    timeScale: { borderColor: "#1f1f24", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    // Pin the locale: an unusual browser locale makes the chart throw.
    localization: { locale: "en-US" },
  });
  series = chart.addCandlestickSeries({
    upColor: "#39ff14", downColor: "#ef4444", borderVisible: false, wickUpColor: "#39ff14", wickDownColor: "#ef4444",
    priceFormat: { type: "custom", minMove: 1e-12, formatter: (v) => (state.metric === "mcap" ? (state.data?.ethUsd ? usd(v) : `${compact(v)} Ξ`) : tiny(v)) },
  });
}

function renderChart() {
  ensureChart();
  if (!series) return;
  const { coin, trades, ethUsd } = state.data;
  const supply = Number(formatEther(BigInt(coin.supply)));
  const scale = state.metric === "mcap" ? supply * (ethUsd || 1) : 1;
  const step = state.interval;
  const candles = [];
  for (const t of trades) {
    if (!t.time || !t.priceEth) continue;
    const bucket = Math.floor(t.time / step) * step;
    const v = t.priceEth * scale;
    const last = candles[candles.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, v);
      last.low = Math.min(last.low, v);
      last.close = v;
    } else {
      const open = last ? last.close : v;
      candles.push({ time: bucket, open, high: Math.max(open, v), low: Math.min(open, v), close: v });
    }
  }
  // Finish on the live curve price.
  const now = Math.floor(Date.now() / 1000 / step) * step;
  const live = coin.priceEth * scale;
  const last = candles[candles.length - 1];
  if (last && last.time === now) { last.close = live; last.high = Math.max(last.high, live); last.low = Math.min(last.low, live); }
  else if (!last || last.time < now) candles.push({ time: now, open: last ? last.close : live, high: Math.max(last ? last.close : live, live), low: Math.min(last ? last.close : live, live), close: live });
  series.setData(candles);
  chart.timeScale().fitContent();
  $("#chartNote").textContent = trades.length ? `${trades.length} curve trades${state.metric === "mcap" ? (ethUsd ? " · market cap in USD" : " · market cap in ETH") : " · price in ETH"}` : "No trades yet — the chart starts at the launch price.";
}

// ---------- trades ----------
function renderTrades() {
  const { trades, ethUsd } = state.data;
  const rows = trades.slice(-50).reverse();
  $("#trades").innerHTML = rows.length
    ? rows.map((t) => `<tr>
        <td class="${t.side === "buy" ? "up" : "down"}">${t.side === "buy" ? "Buy" : "Sell"}</td>
        <td class="num">${tiny(t.eth, 4)}</td>
        <td class="num hide-sm">${compact(t.tokens)}</td>
        <td class="num hide-sm">${ethUsd ? usd(t.priceEth * ethUsd) : tiny(t.priceEth)}</td>
        <td class="num"><a href="${EXPLORER}/address/${t.trader}" target="_blank" rel="noopener">${short(t.trader)}</a></td>
        <td class="num"><a href="${EXPLORER}/tx/${t.txHash}" target="_blank" rel="noopener">${ago(t.time)}</a></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No trades yet. Be the first buyer.</td></tr>`;
}

// ---------- trade panel ----------
function curveState() {
  const c = state.data.coin.curveState;
  return {
    quoteReserve: BigInt(c.quoteReserve), tokenReserve: BigInt(c.tokenReserve), sellable: BigInt(c.sellable),
    feeBps: BigInt(c.feeBps), creatorTaxBps: BigInt(c.creatorTaxBps), extraBps: state.snipeBps,
  };
}

function amountWei() {
  const v = $("#amount").value.trim();
  if (!v || !(Number(v) > 0)) return 0n;
  try { return parseEther(v); } catch { return 0n; }
}

function renderTradePanel() {
  const buy = state.side === "buy";
  const coin = state.data?.coin;
  $$(".trade-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.side === state.side));
  $(".trade-tabs").classList.toggle("selling", !buy);
  $("#amountLabel").textContent = buy ? "You pay" : "You sell";
  $("#amountUnit").textContent = buy ? "ETH" : `$${coin?.symbol ?? ""}`;
  $("#quick").innerHTML = buy
    ? ["0.001", "0.01", "0.05", "0.1"].map((v) => `<button data-v="${v}">${v}</button>`).join("")
    : ["25", "50", "75", "100"].map((p) => `<button data-p="${p}">${p}%</button>`).join("");
  $("#balance").textContent = state.account
    ? buy ? (state.ethBalance != null ? eth(Number(formatEther(state.ethBalance))) : "…") : (state.tokenBalance != null ? `${compact(Number(formatEther(state.tokenBalance)))} $${coin?.symbol}` : "…")
    : "—";
  updateQuote();
}

function updateQuote() {
  const btn = $("#tradeBtn");
  const coin = state.data?.coin;
  if (!coin) return;
  const amt = amountWei();
  let out = 0n;
  if (amt > 0n) out = state.side === "buy" ? quoteBuy(curveState(), amt) : quoteSell(curveState(), amt);
  $("#receive").textContent = amt > 0n
    ? state.side === "buy" ? `${compact(Number(formatEther(out)))} $${coin.symbol}` : eth(Number(formatEther(out)))
    : "—";
  btn.disabled = state.busy;
  if (coin.graduated) { btn.textContent = "Graduated — curve closed"; btn.disabled = true; return; }
  if (!state.account) { btn.textContent = "Connect wallet"; return; }
  btn.textContent = state.side === "buy" ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`;
}

$$(".trade-tabs .seg-btn").forEach((b) => b.addEventListener("click", () => {
  state.side = b.dataset.side;
  $("#amount").value = "";
  renderTradePanel();
}));
$("#amount").addEventListener("input", updateQuote);
$("#quick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.v) $("#amount").value = b.dataset.v;
  if (b.dataset.p) {
    if (state.tokenBalance == null) return toast("Connect a wallet to see your balance");
    const wei = (state.tokenBalance * BigInt(b.dataset.p)) / 100n;
    $("#amount").value = formatEther(wei);
  }
  updateQuote();
});
$("#slippage").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.slippageBps = Number(b.dataset.bps);
  $$("#slippage button").forEach((x) => x.classList.toggle("active", x === b));
});

// ---------- wallet ----------
function setConnectedUi() {
  const w = state.walletInfo;
  $("#connectBtn").innerHTML = state.account
    ? `${w?.icon ? `<img class="wallet-icon" src="${esc(w.icon)}" alt="" />` : ""}${short(state.account)}`
    : "Connect wallet";
  renderTradePanel();
  if (state.data) renderClaim();
}

// ---------- creator fee claim ----------
// Coins launched with a fee splitter pay their creator fees to the splitter,
// which forwards half to the launcher and half to the SPIDERPAD vault. Older
// coins pay the launcher's wallet directly.
let owner = null; // { creator, splitter } for the loaded coin
let fees = null; // live fee state, read only for the creator
const isCreator = () => state.account && owner && state.account.toLowerCase() === owner.creator.toLowerCase();

async function resolveOwner() {
  const coin = state.data.coin;
  if (owner?.coin === coin.token) return owner;
  const creator = await state.client.readContract({ address: coin.creatorFeeRecipient, abi: SPLITTER_ABI, functionName: "creator" }).catch(() => null);
  owner = creator
    ? { coin: coin.token, creator, splitter: coin.creatorFeeRecipient }
    : { coin: coin.token, creator: coin.creatorFeeRecipient, splitter: null };
  return owner;
}

async function refreshFees() {
  if (!state.account || !state.data) { fees = null; return renderClaim(); }
  await resolveOwner();
  if (!isCreator()) { fees = null; return renderClaim(); }
  const { curve } = state.data.coin;
  const read = (functionName) => state.client.readContract({ address: curve, abi: curveAbi, functionName });
  const [quoteFee, creatorTax, buyback, protocolShare, escrow] = await Promise.all([
    read("quoteFeeBalance").catch(() => 0n), read("creatorTaxBalance").catch(() => 0n),
    read("buybackQuoteBalance").catch(() => 0n), read("protocolFeeShareBps").catch(() => 0), read("feeEscrow"),
  ]);
  const ready = owner.splitter
    ? await state.client.readContract({ address: owner.splitter, abi: SPLITTER_ABI, functionName: "claimable" }).catch(() => 0n)
    : await state.client.readContract({ address: escrow, abi: escrowAbi, functionName: "balanceOf", args: [state.account] }).catch(() => 0n);
  // The recipient's cut of the pending base fee, minus the buyback earmark, plus the full creator tax.
  let pending = quoteFee - (quoteFee * BigInt(protocolShare)) / 10_000n - buyback;
  if (pending < 0n) pending = 0n;
  pending += creatorTax;
  // With a splitter the launcher's share is half of what the splitter receives.
  const share = (v) => (owner.splitter ? v - v / 2n : v);
  fees = { quoteFee, creatorTax, buyback, escrow, ready, pending, readyShare: share(ready), pendingShare: share(pending) };
  renderClaim();
}

function renderClaim() {
  const box = $("#claimBox");
  box.hidden = !isCreator();
  if (box.hidden) return;
  const coin = state.data.coin;
  $("#feePending").textContent = fees ? eth(Number(formatEther(fees.pendingShare))) : "…";
  $("#feeReady").textContent = fees ? eth(Number(formatEther(fees.readyShare))) : "…";
  const canSweep = fees && !coin.graduated && fees.quoteFee + fees.creatorTax > 0n && fees.buyback === 0n
    && state.account.toLowerCase() === coin.deployer.toLowerCase();
  $("#claimBtn").disabled = state.busy || !fees || (!canSweep && fees.ready === 0n);
  $("#claimNote").textContent = !fees ? ""
    : fees.buyback > 0n ? "Buybacks are on for this coin, so part of the pending fees waits for the Pons fee sweeper before it can be claimed."
    : "Claiming moves pending fees off the curve, then sends your fees to your wallet. \"Ready to claim\" covers all your coins.";
}

async function claimFees() {
  if (state.busy || !isCreator()) return;
  const coin = state.data.coin;
  const status = (html, kind = "") => { const el = $("#claimStatus"); el.hidden = !html; el.className = "status " + kind; el.innerHTML = html; };
  const ex = (hash) => `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">view transaction ↗</a>`;
  state.busy = true;
  renderClaim();
  try {
    await ensureChain(state.provider);
    await refreshFees();
    if (!coin.graduated && fees.quoteFee + fees.creatorTax > 0n && fees.buyback === 0n && state.account.toLowerCase() === coin.deployer.toLowerCase()) {
      status("Confirm moving your fees off the curve…");
      const { request } = await state.client.simulateContract({ account: state.account, address: coin.curve, abi: curveAbi, functionName: "sweepFees", args: [0n] });
      const hash = await state.wallet.writeContract(request);
      status(`Moving fees… ${ex(hash)}`);
      await state.client.waitForTransactionReceipt({ hash });
    }
    await refreshFees();
    if (fees.ready === 0n) throw new Error("No fees ready to claim yet");
    const share = fees.readyShare;
    status("Confirm the claim in your wallet…");
    const { request } = owner.splitter
      ? await state.client.simulateContract({ account: state.account, address: owner.splitter, abi: SPLITTER_ABI, functionName: "claim" })
      : await state.client.simulateContract({ account: state.account, address: fees.escrow, abi: escrowAbi, functionName: "claim" });
    const hash = await state.wallet.writeContract(request);
    status(`Claiming… ${ex(hash)}`);
    const receipt = await state.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    status(`Claimed ${eth(Number(formatEther(share)))} to your wallet. ${ex(hash)}`, "ok");
    await Promise.all([refreshFees(), refreshBalances()]);
  } catch (err) {
    status(esc(err.shortMessage || err.message || String(err)), "err");
  } finally {
    state.busy = false;
    renderClaim();
  }
}
$("#claimBtn").addEventListener("click", claimFees);

async function refreshBalances() {
  if (!state.account || !state.data) return;
  // On another network the coin's contracts don't exist; show nothing rather than zeros.
  if (!(await onRobinhood(state.provider))) {
    state.ethBalance = state.tokenBalance = null;
    fees = null;
    renderTradePanel();
    return;
  }
  const { token, curve } = state.data.coin;
  const [ethBal, tokBal, snipe] = await Promise.all([
    state.client.getBalance({ address: state.account }).catch(() => null),
    state.client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [state.account] }).catch(() => null),
    state.client.readContract({ address: curve, abi: curveAbi, functionName: "currentSnipeTaxBps", args: [state.account] }).catch(() => 0n),
  ]);
  state.ethBalance = ethBal;
  state.tokenBalance = tokBal;
  state.snipeBps = snipe ?? 0n;
  renderTradePanel();
  refreshFees().catch(() => {});
}

function disconnect() {
  state.account = state.wallet = state.client = state.provider = state.walletInfo = null;
  state.ethBalance = state.tokenBalance = null;
  fees = null;
  owner = null;
  rememberWallet(null);
  setConnectedUi();
  toast("Wallet disconnected");
}

async function useWallet({ info, provider }, { silent = false } = {}) {
  const [account] = await provider.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
  if (!account) return false;
  if (!silent) await ensureChain(provider);
  Object.assign(state, {
    provider, walletInfo: info, account,
    wallet: createWalletClient({ account, chain: robinhood, transport: custom(provider) }),
    client: createPublicClient({ chain: robinhood, transport: custom(provider) }),
  });
  rememberWallet(info.rdns);
  setConnectedUi();
  provider.on?.("accountsChanged", (accs) => {
    if (state.provider !== provider) return;
    if (!accs[0]) return disconnect();
    state.account = accs[0];
    state.wallet = createWalletClient({ account: accs[0], chain: robinhood, transport: custom(provider) });
    setConnectedUi();
    refreshBalances();
  });
  provider.on?.("chainChanged", () => { if (state.provider === provider) refreshBalances(); });
  refreshBalances();
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
$("#connectBtn").addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));

// ---------- trading ----------
// Re-reads the curve through the wallet's RPC so the quote is current.
async function liveCurve() {
  const { curve } = state.data.coin;
  const read = (functionName, args) => state.client.readContract({ address: curve, abi: curveAbi, functionName, args });
  const [[quoteReserve, tokenReserve], sellable, feeBps, creatorTaxBps, snipe] = await Promise.all([
    read("getReserves"), read("sellableTokens"), read("feeBps"), read("creatorTaxBps"),
    read("currentSnipeTaxBps", [state.account]).catch(() => 0n),
  ]);
  return { quoteReserve, tokenReserve, sellable, feeBps, creatorTaxBps, extraBps: snipe };
}

async function trade() {
  if (state.busy) return;
  if (!state.account && !(await connect())) return;
  const { coin } = state.data;
  const amt = amountWei();
  if (amt <= 0n) return toast("Enter an amount");
  state.busy = true;
  updateQuote();
  const ex = (hash) => `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">view transaction ↗</a>`;
  try {
    await ensureChain(state.provider);
    const live = await liveCurve();
    let hash;
    if (state.side === "buy") {
      if (state.ethBalance != null && amt > state.ethBalance) throw new Error("Not enough ETH");
      const minOut = applySlippage(quoteBuy(live, amt), state.slippageBps);
      setStatus("Confirm the buy in your wallet…");
      const { request } = await state.client.simulateContract({
        account: state.account, address: coin.curve, abi: curveAbi, functionName: "buy",
        args: [amt, minOut, state.account], value: amt,
      });
      hash = await state.wallet.writeContract(request);
    } else {
      if (state.tokenBalance != null && amt > state.tokenBalance) throw new Error(`Not enough $${coin.symbol}`);
      const allowance = await state.client.readContract({ address: coin.token, abi: tokenAbi, functionName: "allowance", args: [state.account, coin.curve] });
      if (allowance < amt) {
        setStatus(`Approve $${esc(coin.symbol)} for selling in your wallet…`);
        const approve = await state.wallet.writeContract({ address: coin.token, abi: tokenAbi, functionName: "approve", args: [coin.curve, amt], chain: robinhood });
        setStatus(`Approving… ${ex(approve)}`);
        await state.client.waitForTransactionReceipt({ hash: approve });
      }
      const minOut = applySlippage(quoteSell(live, amt), state.slippageBps);
      setStatus("Confirm the sell in your wallet…");
      const { request } = await state.client.simulateContract({
        account: state.account, address: coin.curve, abi: curveAbi, functionName: "sell",
        args: [amt, minOut, state.account],
      });
      hash = await state.wallet.writeContract(request);
    }
    setStatus(`Waiting for confirmation… ${ex(hash)}`);
    const receipt = await state.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    setStatus(`${state.side === "buy" ? "Bought" : "Sold"} $${esc(coin.symbol)}. ${ex(hash)}`, "ok");
    $("#amount").value = "";
    await Promise.all([refreshBalances(), load()]);
  } catch (err) {
    setStatus(esc(err.shortMessage || err.message || String(err)), "err");
  } finally {
    state.busy = false;
    updateQuote();
  }
}
$("#tradeBtn").addEventListener("click", trade);

// ---------- chart controls ----------
$("#intervals").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.interval = Number(b.dataset.sec);
  $$("#intervals .tab").forEach((x) => x.classList.toggle("active", x === b));
  if (state.data) renderChart();
});
$("#metric").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.metric = b.dataset.metric;
  $$("#metric .tab").forEach((x) => x.classList.toggle("active", x === b));
  if (state.data) renderChart();
});

// ---------- data ----------
let pollTimer;
async function load() {
  clearTimeout(pollTimer);
  try {
    const res = await fetch(`/api/token?address=${encodeURIComponent(address)}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`server error ${res.status}`); }
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.data = data;
    renderHero();
    renderChart();
    renderTrades();
    renderTradePanel();
    if (state.account && !state.busy) refreshBalances();
    pollTimer = setTimeout(load, data.complete ? 15_000 : 3_000);
  } catch (err) {
    if (!state.data) {
      $("#hero").innerHTML = `<div class="explore-empty">Couldn't load this coin: ${esc(err.message)}. <a href="#" id="retry">Retry</a></div>`;
      $("#retry").addEventListener("click", (e) => { e.preventDefault(); load(); });
    } else {
      pollTimer = setTimeout(load, 15_000);
    }
  }
}

$("#year").textContent = new Date().getFullYear();
if (!isAddress(address)) {
  $("#hero").innerHTML = `<div class="explore-empty">No coin selected. <a href="explore.html">Browse coins in Explore →</a></div>`;
} else {
  load();
  setTimeout(() => {
    const last = lastWallet();
    if (last && !state.account) useWallet(last, { silent: true }).catch(() => {});
  }, 300);
}
