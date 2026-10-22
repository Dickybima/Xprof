// GET /api/og?address=0x… — the 1200×630 share card for a coin, shown when
// its /c/<address> link is posted on X, Telegram or Discord.
import fs from "node:fs";
import { ImageResponse } from "@vercel/og";
import { readCoin, getEthUsd } from "./_coin.js";

const font = (file) => fs.readFileSync(new URL(`../fonts/${file}`, import.meta.url));
const FONTS = [
  { name: "Inter", data: font("Inter-SemiBold.otf"), weight: 600, style: "normal" },
  { name: "Inter", data: font("Inter-ExtraBold.otf"), weight: 800, style: "normal" },
];
const LOGO = "data:image/svg+xml;base64," + fs.readFileSync(new URL("../logo.svg", import.meta.url)).toString("base64");

const NEON = "#39ff14";
const X_ICON = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#a1a1aa" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>').toString("base64");
const W = 1200, H = 630;

// The neon web behind the card, as one SVG (same construction as bg.js).
function webSvg() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const cx = 860, cy = 300, SPOKES = 20;
  const spokes = Array.from({ length: SPOKES }, (_, i) => (i / SPOKES) * Math.PI * 2 + (rand() - 0.5) * 0.18);
  const rings = [];
  for (let r = 34; r < 1100; r *= 1.14 + rand() * 0.03) rings.push(spokes.map(() => r * (0.94 + rand() * 0.12)));
  const pt = (k, i) => [cx + Math.cos(spokes[i]) * rings[k][i], cy + Math.sin(spokes[i]) * rings[k][i]];
  let d = "";
  for (let i = 0; i < SPOKES; i++) { const [x, y] = pt(rings.length - 1, i); d += `M${cx} ${cy}L${x.toFixed(1)} ${y.toFixed(1)}`; }
  for (let k = 0; k < rings.length; k++) {
    let [px, py] = pt(k, 0);
    d += `M${px.toFixed(1)} ${py.toFixed(1)}`;
    for (let i = 1; i <= SPOKES; i++) {
      const [x, y] = pt(k, i % SPOKES);
      const mx = (px + x) / 2, my = (py + y) / 2;
      d += `Q${(mx + (cx - mx) * 0.07).toFixed(1)} ${(my + (cy - my) * 0.07).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      px = x; py = y;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="f" cx="${cx}" cy="${cy}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${NEON}" stop-opacity=".55"/><stop offset="1" stop-color="${NEON}" stop-opacity=".07"/></radialGradient><radialGradient id="g" cx="${cx}" cy="${cy}" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${NEON}" stop-opacity=".16"/><stop offset="1" stop-color="${NEON}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="#030503"/><rect width="100%" height="100%" fill="url(#g)"/><path d="${d}" fill="none" stroke="${NEON}" stroke-opacity=".08" stroke-width="5"/><path d="${d}" fill="none" stroke="url(#f)" stroke-width="1.3"/></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
const WEB = webSvg();

const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c !== null && c !== false && c !== undefined) } });
const img = (src, style) => ({ type: "img", props: { src, style } });

const compact = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const SUB = "₀₁₂₃₄₅₆₇₈₉";
function tiny(n) {
  if (!n) return "0";
  if (n >= 0.001) return n.toPrecision(3).replace(/0+$/, "").replace(/\.$/, "");
  const zeros = Math.floor(-Math.log10(n)) - 1;
  return `0.0${String(zeros).split("").map((d) => SUB[d]).join("")}${Math.round(n * 10 ** (zeros + 3))}`;
}
const money = (eth, usd) => (usd ? (eth * usd >= 1 ? "$" + compact(eth * usd) : "$" + tiny(eth * usd)) : `${eth >= 0.01 ? compact(eth) : tiny(eth)} ETH`);

// Fetches the coin's avatar up front so a slow or missing image can't break
// the render; falls back to the SPIDERPAD logo.
async function avatarFor(coin) {
  const url = /^https:\/\//i.test(coin?.logo || "") ? coin.logo : coin?.handle ? `https://unavatar.io/x/${coin.handle}` : null;
  if (!url) return LOGO;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return LOGO;
    return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return LOGO;
  }
}

function card(coin, usd, avatar) {
  const stat = (label, value) => h("div", { flexDirection: "column", padding: "18px 24px", borderRadius: 18, background: "rgba(8,10,8,.85)", border: "2px solid #23262a", minWidth: 210 },
    h("div", { fontSize: 22, color: "#8a8a93", fontWeight: 600 }, label),
    h("div", { fontSize: 40, color: "#fff", fontWeight: 800, marginTop: 4 }, value));
  return h("div", { width: W, height: H, position: "relative", fontFamily: "Inter", color: "#fff", background: "#030503" },
    img(WEB, { position: "absolute", left: 0, top: 0, width: W, height: H }),
    h("div", { position: "absolute", left: 0, top: 0, width: W, height: H, background: "linear-gradient(90deg, rgba(3,5,3,.96) 0%, rgba(3,5,3,.82) 55%, rgba(3,5,3,.35) 100%)" }),
    h("div", { position: "absolute", left: 64, top: 56, right: 64, bottom: 48, flexDirection: "column" },
      coin
        ? [
          h("div", { alignItems: "center" },
            img(avatar, { width: 168, height: 168, borderRadius: 36, border: `4px solid ${NEON}`, objectFit: "cover", boxShadow: `0 0 40px rgba(57,255,20,.45)` }),
            h("div", { flexDirection: "column", marginLeft: 36, maxWidth: 820 },
              h("div", { fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, coin.name.length > 22 ? coin.name.slice(0, 21) + "…" : coin.name),
              h("div", { alignItems: "center", marginTop: 10, fontSize: 36, fontWeight: 800 },
                h("div", { color: NEON }, `$${coin.symbol}`),
                coin.handle ? h("div", { alignItems: "center", color: "#a1a1aa", fontWeight: 600, marginLeft: 22, fontSize: 32 }, img(X_ICON, { width: 28, height: 28, marginRight: 10 }), `@${coin.handle}`) : null))),
          h("div", { marginTop: 44, gap: 18 },
            stat("Market cap", money(coin.marketCapEth, usd)),
            stat("Price", money(coin.priceEth, usd)),
            stat(coin.graduated ? "Status" : "Bonding curve", coin.graduated ? "Graduated" : `${coin.progress.toFixed(1)}%`)),
          h("div", { marginTop: 22, width: 680, height: 14, borderRadius: 99, background: "#1b1d20" },
            h("div", { width: `${Math.max(2, coin.progress)}%`, height: 14, borderRadius: 99, background: `linear-gradient(90deg, #1a9e05, ${NEON})`, boxShadow: `0 0 18px ${NEON}` })),
        ]
        : [
          h("div", { fontSize: 84, fontWeight: 800, letterSpacing: -2, marginTop: 80 }, "Tokenize any X profile."),
          h("div", { fontSize: 38, color: "#a1a1aa", fontWeight: 600, marginTop: 18 }, "Launch a profile coin on Robinhood Chain."),
        ],
      h("div", { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "space-between" },
        h("div", { alignItems: "center" },
          img(LOGO, { width: 64, height: 64 }),
          h("div", { fontSize: 40, fontWeight: 800, letterSpacing: 3, marginLeft: 14 }, "SPIDER", h("span", { color: NEON }, "PAD"))),
        h("div", { alignItems: "center", fontSize: 26, fontWeight: 600, color: "#d4d4d8", padding: "12px 24px", borderRadius: 999, border: "2px solid #2a2d31", background: "rgba(8,10,8,.85)" },
          h("div", { width: 14, height: 14, borderRadius: 99, background: "#c6f432", marginRight: 12, boxShadow: "0 0 12px #c6f432" }),
          "spiderpad.fun · Robinhood Chain"))));
}

export default async function handler(req, res) {
  const address = new URL(req.url, "http://x").searchParams.get("address") || "";
  const [coin, usd] = await Promise.all([readCoin(address).catch(() => null), getEthUsd()]);
  const image = new ImageResponse(card(coin, usd, await avatarFor(coin)), { width: W, height: H, fonts: FONTS });
  const png = Buffer.from(await image.arrayBuffer());
  res.setHeader("Content-Type", "image/png");
  // Prices move: refresh the card every few minutes, serve stale meanwhile.
  res.setHeader("Cache-Control", coin ? "public, s-maxage=300, stale-while-revalidate=3600" : "public, s-maxage=60");
  res.status(200).send(png);
}
