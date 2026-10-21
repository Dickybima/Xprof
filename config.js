// Fee vaults used by earlier versions, when creator fees were held for the
// X account owner. Coins launched back then still belong in Explore.
export const PAST_FEE_VAULTS = [
  "0xc34DC81B1B17683AE1853880dF552cAB849A85a2",
  "0x2E87D16561ffE0857eAaF5A227Fa046dAe2d3067",
];

// Coins launched on SPIDERPAD before launches carried the Explore marker.
// List them by token address or by launch transaction hash.
export const LEGACY_TOKENS = [];
export const LEGACY_LAUNCH_TXS = [
  "0x5fc6be672d21fe01ba12b42cb9863a2bd329b9b2b9c9271ea3dd4e494f8c2a81",
];

// Creator tax charged on top of the Pons curve fee (1%), paid entirely to the
// launcher: 200 bps makes the total trading fee 3%. Capped on-chain by the
// factory's maxCreatorTaxBps.
export const CREATOR_TAX_BPS = 200;

// SPIDERPAD's own X account, linked from the X button in the nav.
// Replace with the real profile, e.g. "https://x.com/spiderpad".
export const SPIDERPAD_X_URL = "https://x.com";
