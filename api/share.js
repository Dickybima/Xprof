// GET /c/<address> (rewritten here by vercel.json) — the coin page with Open
// Graph / Twitter Card tags, so links shared on X, Telegram or Discord unfurl
// into the coin's share card. Browsers get the normal coin page.
import fs from "node:fs";
import { isAddress } from "../vendor/viem.js";
import { readCoin } from "./_coin.js";

const PAGE = fs.readFileSync(new URL("../token.html", import.meta.url), "utf8");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async function handler(req, res) {
  const address = new URL(req.url, "http://x").searchParams.get("address") || "";
  const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  // Crawlers give up quickly; don't let a slow RPC hold the page.
  const coin = isAddress(address)
    ? await Promise.race([readCoin(address).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
    : null;

  const title = coin ? `${coin.name} ($${coin.symbol}) on SPIDERPAD` : "SPIDERPAD — Tokenize any X profile";
  const description = coin
    ? `Trade $${coin.symbol}${coin.handle ? `, the profile coin of @${coin.handle},` : ""} on Robinhood Chain.`
    : "Launch a profile coin for any X account on Robinhood Chain.";
  const image = `${origin}/api/og?address=${encodeURIComponent(address)}`;
  const url = `${origin}/c/${encodeURIComponent(address)}`;
  const tags = `<base href="/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SPIDERPAD" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@SpiderpadHQ" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />`;

  const html = PAGE
    .replace(/<meta charset="utf-8" \/>/, (m) => `${m}\n  ${tags}`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", coin ? "public, s-maxage=300, stale-while-revalidate=3600" : "public, s-maxage=60");
  res.status(200).send(html);
}
