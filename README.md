# Xprof — Tokenize X Profiles

A dark, Noir-style landing page where any X (Twitter) profile can be tokenized on a bonding curve, with a live **Top X Profiles** leaderboard.

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

> Prices and trades are simulated client-side. Wiring real tokens needs an on-chain launch program (e.g. a Solana bonding curve) and the X API for live profile data.
