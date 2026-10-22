# SPIDERPAD — Tokenize X Profiles

A dark, Noir-style landing page where any X (Twitter) profile can be tokenized on a bonding curve, with a live **Top X Profiles** leaderboard.

## Launch on Pons v2

Typing a handle and pressing **Tokenize** opens `launch.html?handle=<handle>&source=x`:

1. **Your profile** — detects the X profile (name, avatar, bio) via the public fxtwitter API.
2. **Review and launch** — the coin name (X display name), ticker (handle, uppercased), logo (X avatar) and X link are locked to the profile. Only the one-line hook, website, optional initial buy and buyback toggle are editable. Live terms (launch fee, curve fee, graduation threshold) are read from the Pons v2 factory.

### Fees: 3% per trade

Every trade on a SPIDERPAD coin pays 3%: the 1% Pons curve fee plus a 2% creator tax (`CREATOR_TAX_BPS` in `config.js`). The coin's creator fee recipient is a `SpiderpadFeeSplitter` (`contracts/SpiderpadFeeSplitter.sol`, deployed from the launcher's wallet on their first launch and reused after), which pays half of everything it receives to the launcher and half to the SPIDERPAD vault (`SPIDERPAD_FEE_VAULT`): 1% of each trade to the creator and 1% to SPIDERPAD. The launcher claims from the coin page (`sweepFees` on the curve, then `claim()` on the splitter); anyone can trigger a splitter payout, and its recipients are fixed at deployment.

`splitter.js` holds the compiled ABI and bytecode (solc 0.8.26, optimizer 200 runs, evmVersion paris). Each launch salt starts with `SPIDERPAD` in ASCII (`SALT_PREFIX` in `pons.js`).

## Explore

`explore.html` lists every coin launched through SPIDERPAD, newest first, with market cap, bonding progress, search and sorting. It reads `/api/launches`, a Vercel function (`api/launches.js`). Every SPIDERPAD launch exempts `SPIDERPAD_MARKER` (`pons.js`) from the curve's snipe tax, so the curve emits `SnipeTaxExempted(marker)`; one log query over Robinhood Chain finds every SPIDERPAD coin. Coins from earlier versions are found through the fee vaults they used (`PAST_FEE_VAULTS`) or listed by token address in `LEGACY_TOKENS` (`config.js`). Responses are CDN-cached for 30 seconds. Set `ROBINHOOD_RPC_URL` in Vercel to use a dedicated RPC instead of the public one.

## Coin page

Clicking a coin in Explore opens `token.html?address=<token>`: logo, name, ticker, contract address, X handle, creator and explorer links; market cap, price (USD when the ETH price is available), ETH in the curve and bonding progress; a candlestick chart built from the curve's `CurveBuy`/`CurveSell` events (1m–1D, price or market cap); recent trades; and a Buy/Sell panel that trades directly on the coin's bonding curve from the connected wallet (`buy` with ETH, or `approve` + `sell`), with live quotes and 5/10/20% slippage. Data comes from `/api/token` (`api/token.js`). The chart library is vendored in `vendor/lightweight-charts.js` (TradingView Lightweight Charts 4.2.3, Apache-2.0).

## Features
- Paste an X handle (or `x.com/...` URL) to tokenize it — opens a token card with price, market cap, bonding progress and buy/sell.
- Top 3 podium with sparklines and a sortable/searchable leaderboard (market cap, gainers, followers, volume).
- Live trades ticker and simulated price movements.
- Avatars loaded from `unavatar.io`, with initials fallback.

## Run
Static site, no build step:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

> Leaderboard prices on the homepage are simulated; its Tokenize buttons open the launch page. Launches from `launch.html` are real on-chain transactions.
