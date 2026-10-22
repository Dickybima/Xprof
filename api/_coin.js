// Shared by the share card (/api/og) and the share page (/api/share): reads
// one coin's metadata and live curve state straight from the chain, without
// the trade-log scan /api/token does, so crawlers get an answer fast.
import { createPublicClient, http, formatEther, isAddress } from "../vendor/viem.js";
import { robinhood, PONS, factoryAbi, curveAbi, tokenAbi } from "../pons.js";

export const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.ROBINHOOD_RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 8_000, retryCount: 1 }),
});

let ethUsd = { value: null, at: 0 };
export async function getEthUsd() {
  if (Date.now() - ethUsd.at < 5 * 60_000) return ethUsd.value;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(2500) });
    ethUsd = { value: Number((await res.json())?.ethereum?.usd) || null, at: Date.now() };
  } catch {
    ethUsd = { value: ethUsd.value, at: Date.now() - 4 * 60_000 };
  }
  return ethUsd.value;
}

/** Returns the coin, or null when the address isn't a Pons v2 launch. */
export async function readCoin(address) {
  if (!isAddress(address)) return null;
  const launch = await client.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "getLaunchedToken", args: [address] });
  if (!launch.exists) return null;
  const { token, curve } = launch;
  const read = (a, abi, functionName) => client.readContract({ address: a, abi, functionName });
  const [name, symbol, logo, description, socials, supply, reserves, realQuote, graduated] = await Promise.all([
    read(token, tokenAbi, "name"),
    read(token, tokenAbi, "symbol"),
    read(token, tokenAbi, "logo").catch(() => ""),
    read(token, tokenAbi, "description").catch(() => ""),
    read(token, tokenAbi, "socials").catch(() => ["", "", "", "", ""]),
    read(token, tokenAbi, "totalSupply"),
    read(curve, curveAbi, "getReserves").catch(() => null),
    read(curve, curveAbi, "realQuoteReserve").catch(() => 0n),
    read(curve, curveAbi, "graduated").catch(() => false),
  ]);
  const handle = ((socials[0] || "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1] || null;
  const priceEth = reserves && reserves[1] > 0n ? Number(formatEther(reserves[0])) / Number(formatEther(reserves[1])) : 0;
  const threshold = launch.graduationThreshold;
  return {
    token, curve, name, symbol, logo, description, handle,
    priceEth,
    marketCapEth: priceEth * Number(formatEther(supply)),
    progress: graduated ? 100 : threshold > 0n ? Math.min(100, (Number(realQuote) / Number(threshold)) * 100) : 0,
    graduated,
  };
}
