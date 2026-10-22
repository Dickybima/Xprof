// Fee vaults used by earlier versions, when creator fees were held for the
// X account owner. Coins launched back then still belong in Explore.
export const PAST_FEE_VAULTS = [
  "0xc34DC81B1B17683AE1853880dF552cAB849A85a2",
  "0x2E87D16561ffE0857eAaF5A227Fa046dAe2d3067",
];

// Coins launched on SPIDERPAD before launches carried the Explore marker.
// List them by token address or by launch transaction hash.
export const LEGACY_TOKENS = [];
export const LEGACY_LAUNCH_TXS = [];

// Test launches made before SPIDERPAD went live stay on-chain but are hidden
// from Explore: anything launched before this time (UTC) is left out.
export const EXPLORE_HIDE_BEFORE = "2026-10-21T18:46:00Z";

// Individual coins to hide from Explore, by token address.
export const HIDDEN_TOKENS = [];

// Creator tax charged on top of the Pons curve fee (1%): 200 bps makes the
// total trading fee 3%. Capped on-chain by the factory's maxCreatorTaxBps.
export const CREATOR_TAX_BPS = 200;

// Every launch routes its creator fees through a SpiderpadFeeSplitter
// (contracts/), which pays half to the launcher and half to this vault:
// 1% of each trade to the creator and 1% to SPIDERPAD.
export const SPIDERPAD_FEE_VAULT = "0x2E87D16561ffE0857eAaF5A227Fa046dAe2d3067";

// The $SPIDER token, linked from the $SPIDER button in the nav.
export const SPIDER_TOKEN = "0xB52259330Ec52Ae026B9B6Db25FB3524bad30e96";

// SPIDERPAD's own X account, linked from the X button in the nav.
export const SPIDERPAD_X_URL = "https://x.com/SpiderpadHQ";
