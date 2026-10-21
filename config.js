// Wallet that holds creator fees for every profile coin until the X account
// owner claims them. Set this to the SPIDERPAD fee vault address before deploying.
// Launches are blocked while it is empty.
export const XPROF_FEE_VAULT = "0x2E87D16561ffE0857eAaF5A227Fa046dAe2d3067";

// Earlier vaults. Coins launched while these were active still belong in
// Explore, so keep every past vault address here.
export const PAST_FEE_VAULTS = ["0xc34DC81B1B17683AE1853880dF552cAB849A85a2"];

// SPIDERPAD's own X account, linked from the X button in the nav.
// Replace with the real profile, e.g. "https://x.com/spiderpad".
export const SPIDERPAD_X_URL = "https://x.com";
