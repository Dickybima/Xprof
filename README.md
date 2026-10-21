# SPIDERPAD — Tokenize X Profiles

A dark, Noir-style landing page where any X (Twitter) profile can be tokenized on a bonding curve, with a live **Top X Profiles** leaderboard.

## Launch on Pons v2

Typing a handle and pressing **Tokenize** opens `launch.html?handle=<handle>&source=x`:

1. **Your profile** — detects the X profile (name, avatar, bio) via the public fxtwitter API.
2. **Review and launch** — the coin name (X display name), ticker (handle, uppercased), logo (X avatar) and X link are locked to the profile. Only the one-line hook, website, optional initial buy and buyback toggle are editable. Live terms (launch fee, curve fee, graduation threshold) are read from the Pons v2 factory.

### Creator fees go to the launcher

Every launch sets `creatorFeeRecipient` to the wallet that signs the launch, so creator fees from every trade go straight to the launcher. Each launch salt starts with `SPIDERPAD` in ASCII (`SALT_PREFIX` in `pons.js`) so SPIDERPAD launches can be recognised on-chain.

## Explore

`explore.html` lists every coin launched through SPIDERPAD, newest first, with market cap, bonding progress, search and sorting. It reads `/api/launches`, a Vercel function (`api/launches.js`) that scans the factory's `TokenLaunched` logs on Robinhood Chain and keeps launches whose transaction used a `SPIDERPAD`-prefixed salt, plus coins from earlier versions whose fees went to a past SPIDERPAD fee vault (`PAST_FEE_VAULTS` in `config.js`). Responses are CDN-cached for 30 seconds. Set `ROBINHOOD_RPC_URL` in Vercel to use a dedicated RPC instead of the public one.

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
