// GET /api/token?address=0x… — one Pons v2 coin: metadata, live curve state
// and its recent curve trades for the chart.
import { createPublicClient, http, formatEther, isAddress } from "../vendor/viem.js";
import { robinhood, PONS, factoryAbi, curveAbi, tokenAbi } from "../pons.js";

export const config = { maxDuration: 60 };

const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.ROBINHOOD_RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 1 }),
});

// No SPIDERPAD coin is older than this; trade scans start here.
const SPIDERPAD_SINCE = Date.UTC(2026, 9, 20) / 1000;
const WINDOW = 250_000n;
const PARALLEL = 2;
const TIME_BUDGET_MS = 30_000;
const MAX_TRADES = 500;

const tradeEvents = curveAbi.filter((x) => x.type === "event" && (x.name === "CurveBuy" || x.name === "CurveSell"));
const launchedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "TokenLaunched");

// Warm-instance caches.
let sinceBlockPromise = null;
const blockTimes = new Map();
const scans = new Map(); // curve -> { scannedTo, trades, launch }
let ethUsd = { value: null, at: 0 };

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

function sinceBlock(latest) {
  if (!sinceBlockPromise) sinceBlockPromise = firstBlockToScan(latest).catch((err) => { sinceBlockPromise = null; throw err; });
  return sinceBlockPromise;
}

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

async function blockTime(blockNumber) {
  const key = blockNumber.toString();
  if (!blockTimes.has(key)) {
    const b = await client.getBlock({ blockNumber });
    blockTimes.set(key, Number(b.timestamp));
  }
  return blockTimes.get(key);
}

function toTrade(log) {
  const buy = log.eventName === "CurveBuy";
  const { quoteIn, tokensOut, tokensIn, quoteOut, fee, tax } = log.args;
  const tokens = buy ? tokensOut : tokensIn;
  // Execution price net of fees, in ETH per token.
  const netQuote = buy ? quoteIn - fee - tax : quoteOut + fee + tax;
  return {
    side: buy ? "buy" : "sell",
    trader: buy ? log.args.recipient : log.args.seller,
    eth: Number(formatEther(buy ? quoteIn : quoteOut)),
    tokens: Number(formatEther(tokens)),
    priceEth: tokens > 0n ? Number(formatEther(netQuote)) / Number(formatEther(tokens)) : 0,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    txHash: log.transactionHash,
  };
}

// Reads new curve trades window by window until done or out of time.
async function scanTrades(token, curve, deadline) {
  const latest = await client.getBlockNumber();
  let s = scans.get(curve);
  if (!s) {
    // Obtained through a call, not a top-level variable: Vercel's build-time
    // tracer statically evaluates expressions and fails on null - 1n.
    const since = await sinceBlock(latest);
    scans.set(curve, (s = { scannedTo: since - 1n, trades: [], launch: null }));
  }
  while (s.scannedTo < latest && Date.now() < deadline) {
    const windows = [];
    for (let from = s.scannedTo + 1n; from <= latest && windows.length < PARALLEL; from += WINDOW) {
      windows.push([from, from + WINDOW - 1n < latest ? from + WINDOW - 1n : latest]);
    }
    const results = await Promise.all(windows.map(async ([f, t]) => {
      const [trades, launches] = await Promise.all([
        getLogsAdaptive({ address: curve, events: tradeEvents }, f, t),
        s.launch ? [] : getLogsAdaptive({ address: PONS.factory, event: launchedEvent, args: { token } }, f, t),
      ]);
      return { trades, launches };
    }));
    for (const r of results) {
      s.trades.push(...r.trades.map(toTrade));
      if (r.launches[0] && !s.launch) s.launch = { blockNumber: r.launches[0].blockNumber, txHash: r.launches[0].transactionHash };
    }
    s.scannedTo = windows[windows.length - 1][1];
  }
  s.trades.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
  if (s.trades.length > MAX_TRADES) s.trades = s.trades.slice(-MAX_TRADES);
  return { ...s, complete: s.scannedTo >= latest };
}

async function getEthUsd() {
  if (Date.now() - ethUsd.at < 5 * 60_000) return ethUsd.value;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    ethUsd = { value: Number(data?.ethereum?.usd) || null, at: Date.now() };
  } catch {
    ethUsd = { value: ethUsd.value, at: Date.now() - 4 * 60_000 }; // retry in a minute
  }
  return ethUsd.value;
}

export default async function handler(req, res) {
  const address = new URL(req.url, "http://x").searchParams.get("address") || "";
  if (!isAddress(address)) return res.status(400).json({ error: "Invalid token address" });
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    const launch = await client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "getLaunchedToken", args: [address] });
    if (!launch.exists) return res.status(404).json({ error: "This token wasn't launched on Pons v2" });
    const { token, curve } = launch;
    const read = (a, abi, functionName, args) => client.readContract({ address: a, abi, functionName, args });
    const [name, symbol, logo, description, socials, supply, reserves, realQuote, graduated, feeBps, creatorTaxBps, sellable, usd, scan] = await Promise.all([
      read(token, tokenAbi, "name"),
      read(token, tokenAbi, "symbol"),
      read(token, tokenAbi, "logo").catch(() => ""),
      read(token, tokenAbi, "description").catch(() => ""),
      read(token, tokenAbi, "socials").catch(() => ["", "", "", "", ""]),
      read(token, tokenAbi, "totalSupply"),
      read(curve, curveAbi, "getReserves"),
      read(curve, curveAbi, "realQuoteReserve").catch(() => 0n),
      read(curve, curveAbi, "graduated").catch(() => false),
      read(curve, curveAbi, "feeBps").catch(() => 100n),
      read(curve, curveAbi, "creatorTaxBps").catch(() => 0n),
      read(curve, curveAbi, "sellableTokens").catch(() => 0n),
      getEthUsd(),
      scanTrades(token, curve, deadline),
    ]);

    const recent = scan.trades.slice(-MAX_TRADES);
    const times = await Promise.all([...new Set(recent.map((t) => t.blockNumber))].map(async (b) => [b, await blockTime(b).catch(() => null)]));
    const timeOf = new Map(times);
    const createdAt = scan.launch ? await blockTime(scan.launch.blockNumber).catch(() => null) : null;

    const twitter = socials[0] || "";
    const handle = (twitter.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1] || null;
    const priceEth = reserves[1] > 0n ? Number(formatEther(reserves[0])) / Number(formatEther(reserves[1])) : 0;
    const threshold = launch.graduationThreshold;

    res.setHeader("Cache-Control", scan.complete ? "s-maxage=10, stale-while-revalidate=60" : "no-store");
    res.status(200).json({
      complete: scan.complete,
      ethUsd: usd,
      coin: {
        token, curve, name, symbol, logo, description, handle, twitter,
        website: socials[3] || "",
        deployer: launch.deployer,
        creatorFeeRecipient: launch.creatorFeeRecipient,
        createdAt,
        launchTx: scan.launch?.txHash ?? null,
        supply: supply.toString(),
        priceEth,
        marketCapEth: priceEth * Number(formatEther(supply)),
        raisedEth: Number(formatEther(realQuote)),
        graduationEth: Number(formatEther(threshold)),
        progress: graduated ? 100 : threshold > 0n ? Math.min(100, (Number(realQuote) / Number(threshold)) * 100) : 0,
        graduated,
        // Raw curve state, so the page can quote trades exactly.
        curveState: {
          quoteReserve: reserves[0].toString(),
          tokenReserve: reserves[1].toString(),
          sellable: sellable.toString(),
          feeBps: feeBps.toString(),
          creatorTaxBps: creatorTaxBps.toString(),
        },
      },
      trades: recent.map((t) => ({ ...t, blockNumber: Number(t.blockNumber), time: timeOf.get(t.blockNumber) ?? null })),
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: err.shortMessage || err.message || "Couldn't read Robinhood Chain" });
  }
}
