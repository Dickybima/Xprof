# Xprof — Tokenize X Profiles

A dark, Noir-style landing page where any X (Twitter) profile can be tokenized on a bonding curve, with a live **Top X Profiles** leaderboard.

## Launch on Pons v2

Typing a handle and pressing **Tokenize** opens `launch.html?handle=<handle>&source=x`:

1. **Your profile** — detects the X profile (name, avatar, bio) via the public fxtwitter API; every field stays editable.
2. **Review and launch** — coin name, ticker, hook, socials, creator fee recipient, optional initial buy and buyback toggle. Live terms (launch fee, curve fee, graduation threshold) are read from the Pons v2 factory.

The connected wallet signs one transaction on Robinhood Chain (chain ID 4663):

- no initial buy → `PonsV2LaunchFactory.launchToken` at `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
- with initial buy → `launchAndBuy` on the launch forwarder `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` (3% slippage)

Economics are pinned with `previewLaunchEconomics`, and every launch is simulated before the wallet prompt. Addresses and ABI come from the reviewed [Reptilian Pons SDK](https://github.com/ReptilianHQ/ponsfamily/tree/main/sdk) (ABI revision `pons-v2-836f0f97`). `vendor/viem.js` is a local esbuild bundle of viem 2.38.0.

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

> Leaderboard prices and trades on the homepage are simulated. Launches from `launch.html` are real on-chain transactions.
