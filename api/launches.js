// GET /api/launches — every coin launched through SPIDERPAD, newest first.
// SPIDERPAD launches exempt SPIDERPAD_MARKER from the snipe tax, so their
// curves emit SnipeTaxExempted(marker); one log query finds them all. Coins
// from earlier versions are found the same way through the fee vaults they
// used (creator fee recipients are exempted at launch), plus LEGACY_TOKENS and
// LEGACY_LAUNCH_TXS.
import { createPublicClient, http, formatEther, decodeEventLog } from "../vendor/viem.js";
import { robinhood, PONS, factoryAbi, curveAbi, tokenAbi, SPIDERPAD_MARKER } from "../pons.js";
import { PAST_FEE_VAULTS, LEGACY_TOKENS, LEGACY_LAUNCH_TXS } from "../config.js";

export const config = { maxDuration: 60 };

const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.ROBINHOOD_RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 20_000 }),
});

const exemptedEvent = curveAbi.find((x) => x.type === "event" && x.name === "SnipeTaxExempted");
const launchedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "TokenLaunched");
const MARKERS = [SPIDERPAD_MARKER, ...PAST_FEE_VAULTS];

// Warm-instance cache of curves already found and the last block scanned.
const cache = { scannedTo: PONS.startBlock - 1n, curves: new Map(), legacyDone: false };

// eth_getLogs over a range, halving it whenever the RPC refuses the size.
async function getLogsAdaptive(params, from, to) {
  try {
    return await client.getLogs({ ...params, fromBlock: from, toBlock: to });
  } catch (err) {
    if (to - from < 1n) throw err;
    const mid = from + (to - from) / 2n;
    const a = await getLogsAdaptive(params, from, mid);
    const b = await getLogsAdaptive(params, mid + 1n, to);
    return a.concat(b);
  }
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function scan() {
  const latest = await client.getBlockNumber();
  const from = cache.scannedTo + 1n;
  if (from <= latest) {
    const logs = await getLogsAdaptive({ event: exemptedEvent, args: { account: MARKERS } }, from, latest);
    for (const log of logs) {
      const curve = log.address.toLowerCase();
      if (!cache.curves.has(curve)) cache.curves.set(curve, { curve: log.address, blockNumber: log.blockNumber, txHash: log.transactionHash });
    }
    cache.scannedTo = latest;
  }
  if (!cache.legacyDone && LEGACY_TOKENS.length) {
    const logs = await getLogsAdaptive({ address: PONS.factory, event: launchedEvent, args: { token: LEGACY_TOKENS } }, PONS.startBlock, latest);
    for (const log of logs) {
      const curve = log.args.curve.toLowerCase();
      if (!cache.curves.has(curve)) cache.curves.set(curve, { curve: log.args.curve, blockNumber: log.blockNumber, txHash: log.transactionHash });
    }
  }
  if (!cache.legacyDone) {
    let complete = true;
    for (const hash of LEGACY_LAUNCH_TXS) {
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) complete = false;
      for (const log of receipt?.logs ?? []) {
        if (log.address.toLowerCase() !== PONS.factory.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          const curve = ev.eventName === "TokenLaunched" && ev.args.curve.toLowerCase();
          if (curve && !cache.curves.has(curve)) cache.curves.set(curve, { curve: ev.args.curve, blockNumber: log.blockNumber, txHash: hash });
        } catch {}
      }
    }
    // Retry on the next request if a receipt couldn't be read.
    cache.legacyDone = complete;
  }
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

export default async function handler(req, res) {
  try {
    await scan();
    const curves = [...cache.curves.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 200);
    const launches = (await inBatches(curves, 20, (c) => describe(c).catch(() => null))).filter(Boolean);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    res.status(200).json({ launches, scannedTo: Number(cache.scannedTo) });
  } catch (err) {
    res.status(502).json({ error: err.shortMessage || err.message || "Couldn't read Robinhood Chain" });
  }
}
