// GET /api/launches — every coin launched through SPIDERPAD, newest first.
// SPIDERPAD launches exempt SPIDERPAD_MARKER from the snipe tax, so their
// curves emit SnipeTaxExempted(marker); one log query finds them all. Coins
// from earlier versions are found the same way through the fee vaults they
// used (creator fee recipients are exempted at launch), plus LEGACY_TOKENS and
// LEGACY_LAUNCH_TXS.
import { createPublicClient, http, fallback, formatEther, decodeEventLog } from "../vendor/viem.js";
import { robinhood, PONS, factoryAbi, curveAbi, tokenAbi, SPIDERPAD_MARKER } from "../pons.js";
import { PAST_FEE_VAULTS, LEGACY_TOKENS, LEGACY_LAUNCH_TXS } from "../config.js";

export const config = { maxDuration: 60 };

// Tried in order; a failing endpoint falls through to the next. Blockscout's
// JSON-RPC is backed by its indexer, so it serves logs when the public node
// refuses requests from serverless hosts.
const RPC_URLS = [
  process.env.ROBINHOOD_RPC_URL,
  robinhood.rpcUrls.default.http[0],
  "https://robinhoodchain.blockscout.com/api/eth-rpc",
].filter(Boolean);

const httpOptions = {
  timeout: 15_000,
  retryCount: 2,
  retryDelay: 500,
  fetchOptions: { headers: { "user-agent": "SPIDERPAD-explore/1.0" } },
};

const client = createPublicClient({
  chain: robinhood,
  transport: fallback(RPC_URLS.map((url) => http(url, httpOptions))),
});

const exemptedEvent = curveAbi.find((x) => x.type === "event" && x.name === "SnipeTaxExempted");
const launchedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "TokenLaunched");
const MARKERS = [SPIDERPAD_MARKER, ...PAST_FEE_VAULTS];

// No SPIDERPAD coin is older than this, so scans start here instead of at the
// factory's first block (tens of millions of blocks back).
const SPIDERPAD_SINCE = Date.UTC(2026, 9, 20) / 1000;
const WINDOW = 250_000n; // blocks per eth_getLogs request
const PARALLEL = 2;
const TIME_BUDGET_MS = 40_000; // stay well inside maxDuration

// Warm-instance cache of curves already found and the last block scanned.
const cache = { scannedTo: null, curves: new Map(), legacyDone: false };

const addCurve = (curve, blockNumber, txHash) => {
  const key = curve.toLowerCase();
  if (!cache.curves.has(key)) cache.curves.set(key, { curve, blockNumber, txHash });
};

// Estimates the first block at or after SPIDERPAD_SINCE from the chain's
// recent block rate, then steps back until it is safely before that time.
async function firstBlockToScan(latest) {
  const head = await client.getBlock({ blockNumber: latest });
  const probe = latest > 500_000n ? latest - 500_000n : PONS.startBlock;
  const old = await client.getBlock({ blockNumber: probe });
  const perSecond = Number(latest - probe) / Math.max(1, Number(head.timestamp - old.timestamp));
  let guess = latest - BigInt(Math.ceil(perSecond * (Number(head.timestamp) - SPIDERPAD_SINCE) * 1.05));
  for (let i = 0; i < 6 && guess > PONS.startBlock; i++) {
    const b = await client.getBlock({ blockNumber: guess });
    if (Number(b.timestamp) <= SPIDERPAD_SINCE) break;
    guess -= BigInt(Math.ceil(perSecond * (Number(b.timestamp) - SPIDERPAD_SINCE) * 1.2)) + 1000n;
  }
  return guess < PONS.startBlock ? PONS.startBlock : guess;
}

// eth_getLogs over a range, halving it whenever the RPC refuses the size.
async function getLogsAdaptive(params, from, to) {
  try {
    return await client.getLogs({ ...params, fromBlock: from, toBlock: to });
  } catch (err) {
    if (to - from < 2_000n) throw err;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([getLogsAdaptive(params, from, mid), getLogsAdaptive(params, mid + 1n, to)]);
    return a.concat(b);
  }
}

async function scanWindow(from, to) {
  const jobs = [getLogsAdaptive({ event: exemptedEvent, args: { account: MARKERS } }, from, to)];
  if (LEGACY_TOKENS.length) jobs.push(getLogsAdaptive({ address: PONS.factory, event: launchedEvent, args: { token: LEGACY_TOKENS } }, from, to));
  const [exempted, legacy = []] = await Promise.all(jobs);
  for (const log of exempted) addCurve(log.address, log.blockNumber, log.transactionHash);
  for (const log of legacy) addCurve(log.args.curve, log.blockNumber, log.transactionHash);
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// Scans new blocks window by window until done or out of time. Returns true
// when the scan reached the chain head.
async function scan(deadline) {
  const latest = await client.getBlockNumber();
  if (cache.scannedTo == null) cache.scannedTo = (await firstBlockToScan(latest)) - 1n;

  if (!cache.legacyDone) {
    let complete = true;
    for (const hash of LEGACY_LAUNCH_TXS) {
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) complete = false;
      for (const log of receipt?.logs ?? []) {
        if (log.address.toLowerCase() !== PONS.factory.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "TokenLaunched") addCurve(ev.args.curve, log.blockNumber, hash);
        } catch {}
      }
    }
    // Retry on the next request if a receipt couldn't be read.
    cache.legacyDone = complete;
  }

  while (cache.scannedTo < latest && Date.now() < deadline) {
    const windows = [];
    for (let from = cache.scannedTo + 1n; from <= latest && windows.length < PARALLEL; from += WINDOW) {
      windows.push([from, from + WINDOW - 1n < latest ? from + WINDOW - 1n : latest]);
    }
    await Promise.all(windows.map(([f, t]) => scanWindow(f, t)));
    cache.scannedTo = windows[windows.length - 1][1];
  }
  return cache.scannedTo >= latest;
}

async function describe({ curve, blockNumber, txHash }) {
  const read = (address, abi, functionName) => client.readContract({ address, abi, functionName });
  const token = await read(curve, curveAbi, "token");
  const [name, symbol, logo, description, socials, supply, reserves, realQuote, threshold, graduated, block] = await Promise.all([
    read(token, tokenAbi, "name"),
    read(token, tokenAbi, "symbol"),
    read(token, tokenAbi, "logo").catch(() => ""),
    read(token, tokenAbi, "description").catch(() => ""),
    read(token, tokenAbi, "socials").catch(() => ["", "", "", "", ""]),
    read(token, tokenAbi, "totalSupply"),
    read(curve, curveAbi, "getReserves").catch(() => null),
    read(curve, curveAbi, "realQuoteReserve").catch(() => 0n),
    read(curve, curveAbi, "graduationThreshold").catch(() => 0n),
    read(curve, curveAbi, "graduated").catch(() => false),
    client.getBlock({ blockNumber }).catch(() => null),
  ]);
  const twitter = socials[0] || "";
  const handle = (twitter.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1] || null;
  // Spot price on the curve, in ETH per token.
  const priceEth = reserves && reserves[1] > 0n ? Number(formatEther(reserves[0])) / Number(formatEther(reserves[1])) : 0;
  return {
    token, curve, name, symbol, logo, description, handle, twitter,
    website: socials[3] || "",
    createdAt: block ? Number(block.timestamp) : null,
    blockNumber: Number(blockNumber),
    txHash,
    priceEth,
    marketCapEth: priceEth * Number(formatEther(supply)),
    raisedEth: Number(formatEther(realQuote)),
    graduationEth: Number(formatEther(threshold)),
    progress: graduated ? 100 : threshold > 0n ? Math.min(100, (Number(realQuote) / Number(threshold)) * 100) : 0,
    graduated,
  };
}

// Flattens a viem error and its causes into one line, keeping the HTTP status,
// endpoint and RPC details that explain why a request failed.
function explain(err) {
  const parts = [];
  for (let e = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    const bits = [e.shortMessage || e.message?.split("\n")[0], e.status && `HTTP ${e.status}`, e.url && `(${e.url.replace(/^https?:\/\//, "").split("/")[0]})`, e.details];
    const line = bits.filter(Boolean).join(" ");
    if (line && !parts.includes(line)) parts.push(line);
  }
  return parts.join(" ← ").slice(0, 400) || "Couldn't read Robinhood Chain";
}

// GET /api/launches?debug=1 reports how each RPC endpoint responds.
async function diagnose() {
  return Promise.all(RPC_URLS.map(async (url) => {
    const c = createPublicClient({ chain: robinhood, transport: http(url, { ...httpOptions, retryCount: 0 }) });
    const host = new URL(url).host;
    try {
      const latest = await c.getBlockNumber();
      const logs = await c.getLogs({ event: exemptedEvent, args: { account: MARKERS }, fromBlock: latest - 50_000n, toBlock: latest })
        .then((l) => `ok (${l.length} logs in last 50k blocks)`, (e) => explain(e));
      return { host, blockNumber: Number(latest), logs };
    } catch (e) {
      return { host, error: explain(e) };
    }
  }));
}

export default async function handler(req, res) {
  if (new URL(req.url, "http://x").searchParams.has("debug")) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ endpoints: await diagnose(), cache: { scannedTo: cache.scannedTo == null ? null : Number(cache.scannedTo), found: cache.curves.size } });
  }
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    const complete = await scan(deadline);
    const curves = [...cache.curves.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 200);
    const launches = (await inBatches(curves, 10, (c) => describe(c).catch(() => null))).filter(Boolean);
    // A partial scan is cached only briefly so the next request continues it.
    res.setHeader("Cache-Control", complete ? "s-maxage=30, stale-while-revalidate=300" : "no-store");
    res.status(200).json({ launches, complete, scannedTo: Number(cache.scannedTo) });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: explain(err) });
  }
}
