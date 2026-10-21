// GET /api/launches — every coin launched through SPIDERPAD, newest first.
// A SPIDERPAD coin is a Pons v2 launch whose creator fees were routed to one
// of our fee vaults (still, or until its X owner claimed them).
import { createPublicClient, http, formatEther } from "../vendor/viem.js";
import { robinhood, PONS, factoryAbi, curveAbi, tokenAbi } from "../pons.js";
import { XPROF_FEE_VAULT, PAST_FEE_VAULTS } from "../config.js";

const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.ROBINHOOD_RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 20_000 }),
});

const VAULTS = [XPROF_FEE_VAULT, ...PAST_FEE_VAULTS].filter(Boolean).map((a) => a.toLowerCase());
const launchedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "TokenLaunched");
const recipientEvent = factoryAbi.find((x) => x.type === "event" && x.name === "CreatorFeeRecipientUpdated");

// Warm-instance cache: launches already classified and the last block scanned.
const cache = { scannedTo: PONS.startBlock - 1n, launches: new Map(), claimed: new Set() };

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
  if (from > latest) return;

  const [launched, ...handoffs] = await Promise.all([
    getLogsAdaptive({ address: PONS.factory, event: launchedEvent }, from, latest),
    // Coins whose fees already moved from a vault to their X owner.
    ...VAULTS.map((v) => getLogsAdaptive({ address: PONS.factory, event: recipientEvent, args: { previousRecipient: v } }, from, latest)),
  ]);
  for (const log of handoffs.flat()) cache.claimed.add(log.args.token.toLowerCase());

  const fresh = launched.filter((l) => !cache.launches.has(l.args.token.toLowerCase()));
  await inBatches(fresh, 25, async (log) => {
    const token = log.args.token.toLowerCase();
    let recipient = null;
    if (!cache.claimed.has(token)) {
      const info = await client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "getLaunchedToken", args: [log.args.token] });
      recipient = info.creatorFeeRecipient.toLowerCase();
    }
    cache.launches.set(token, { log, ours: cache.claimed.has(token) || VAULTS.includes(recipient) });
  });
  for (const [token, l] of cache.launches) if (cache.claimed.has(token)) l.ours = true;
  cache.scannedTo = latest;
}

async function describe({ log }) {
  const { token, curve, deployer } = log.args;
  const read = (address, abi, functionName) => client.readContract({ address, abi, functionName });
  const [name, symbol, logo, description, socials, supply, reserves, realQuote, graduated, block] = await Promise.all([
    read(token, tokenAbi, "name"),
    read(token, tokenAbi, "symbol"),
    read(token, tokenAbi, "logo").catch(() => ""),
    read(token, tokenAbi, "description").catch(() => ""),
    read(token, tokenAbi, "socials").catch(() => ["", "", "", "", ""]),
    read(token, tokenAbi, "totalSupply"),
    read(curve, curveAbi, "getReserves").catch(() => null),
    read(curve, curveAbi, "realQuoteReserve").catch(() => 0n),
    read(curve, curveAbi, "graduated").catch(() => false),
    client.getBlock({ blockNumber: log.blockNumber }).catch(() => null),
  ]);
  const twitter = socials[0] || "";
  const handle = (twitter.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1] || null;
  const threshold = log.args.graduationThreshold;
  // Spot price on the curve, in ETH per token.
  const priceEth = reserves && reserves[1] > 0n ? Number(formatEther(reserves[0])) / Number(formatEther(reserves[1])) : 0;
  return {
    token, curve, deployer, name, symbol, logo, description, handle, twitter,
    website: socials[3] || "",
    createdAt: block ? Number(block.timestamp) : null,
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash,
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
    const ours = [...cache.launches.values()].filter((l) => l.ours).sort((a, b) => Number(b.log.blockNumber - a.log.blockNumber));
    const launches = await inBatches(ours.slice(0, 200), 20, describe);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    res.status(200).json({ launches, scannedTo: Number(cache.scannedTo) });
  } catch (err) {
    res.status(502).json({ error: err.shortMessage || err.message || "Couldn't read Robinhood Chain" });
  }
}
