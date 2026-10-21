# SPIDERPAD — Tokenize X Profiles

A dark, Noir-style landing page where any X (Twitter) profile can be tokenized on a bonding curve, with a live **Top X Profiles** leaderboard.

## Launch on Pons v2

Typing a handle and pressing **Tokenize** opens `launch.html?handle=<handle>&source=x`:

1. **Your profile** — detects the X profile (name, avatar, bio) via the public fxtwitter API.
2. **Review and launch** — the coin name (X display name), ticker (handle, uppercased), logo (X avatar) and X link are locked to the profile. Only the one-line hook, website, optional initial buy and buyback toggle are editable. Live terms (launch fee, curve fee, graduation threshold) are read from the Pons v2 factory.

### Creator fees go to the X profile owner

Every launch sets `creatorFeeRecipient` to the SPIDERPAD fee vault (`XPROF_FEE_VAULT` in `config.js`); launches are blocked until it is set. The coin's `socials.twitter` stores `https://x.com/<handle>` on-chain, so the vault knows which account each coin belongs to. When the owner proves the account is theirs, the vault:

1. calls `PonsV2LaunchFactory.transferCreatorFeeRecipient(token, ownerWallet)` so future fees go straight to them, and
2. claims the fees already accrued for that token from the Pons fee escrow and forwards them.

The connected wallet signs one transaction on Robinhood Chain (chain ID 4663):

- no initial buy → `PonsV2LaunchFactory.launchToken` at `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
- with initial buy → `launchAndBuy` on the launch forwarder `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` (3% slippage)

Economics are pinned with `previewLaunchEconomics`, and every launch is simulated before the wallet prompt. Addresses and ABI come from the reviewed [Reptilian Pons SDK](https://github.com/ReptilianHQ/ponsfamily/tree/main/sdk) (ABI revision `pons-v2-836f0f97`). `vendor/viem.js` is a local esbuild bundle of viem 2.38.0.

## Explore

`explore.html` lists every coin launched through SPIDERPAD, newest first, with market cap, bonding progress, search and sorting. It reads `/api/launches`, a Vercel function (`api/launches.js`) that scans the factory's `TokenLaunched` logs on Robinhood Chain and keeps launches whose creator fees go to a SPIDERPAD vault (`XPROF_FEE_VAULT` or `PAST_FEE_VAULTS`), including coins whose fees were already handed to their X owner. Responses are CDN-cached for 30 seconds. Set `ROBINHOOD_RPC_URL` in Vercel to use a dedicated RPC instead of the public one.

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
