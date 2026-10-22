// Pons v2 on Robinhood Chain. Addresses and ABI fragments mirror the
// reviewed Reptilian Pons SDK (ABI revision pons-v2-836f0f97).
import { parseAbi, defineChain } from "./vendor/viem.js";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const PONS = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  forwarder: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
  // First block the factory was live, for log scans.
  startBlock: 26841846n,
};

const structs = [
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
];

export const factoryAbi = parseAbi([
  ...structs,
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function canLaunch(address launcher) view returns (bool)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function feeEscrow() view returns (address)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "event CreatorFeeRecipientUpdated(address indexed token, address indexed previousRecipient, address indexed newRecipient)",
]);

export const curveAbi = parseAbi([
  "function token() view returns (address)",
  "function deployer() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBalance() view returns (uint256)",
  "function buybackQuoteBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint16)",
  "function feeEscrow() view returns (address)",
  "function sweepFees(uint256 minBuybackTokensOut)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
  "function graduationThreshold() view returns (uint256)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduated() view returns (bool)",
  "event SnipeTaxExempted(address indexed account)",
]);

// Pons fee escrow: swept creator fees wait here until the recipient claims.
export const escrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function claim() returns (uint256 amount)",
]);

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const forwarderAbi = parseAbi([
  ...structs,
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)",
  "event Launched(address indexed token, address indexed curve, address indexed recipient, address launcher, uint256 quoteSpent, uint256 tokensReceived)",
]);

const BPS = 10_000n;

// Tokens out for the opening buy on a fresh curve, mirroring
// PonsV2BondingCurve.buy (fee legs on the quote side, capped at the
// sellable allocation).
export function quoteOpeningBuy(config, amountIn, creatorTaxBps = 0n) {
  const reserved = (config.supply * config.phantomQuote) / (config.phantomQuote + config.graduationThreshold);
  return quoteBuy({
    quoteReserve: config.phantomQuote, tokenReserve: config.supply, sellable: config.supply - reserved,
    feeBps: config.curveFeeBps, creatorTaxBps,
  }, amountIn);
}

// Tokens out for a buy on a live curve. Fees and taxes come off the quote
// leg first; extraBps covers a decaying snipe tax early in a launch.
export function quoteBuy({ quoteReserve, tokenReserve, sellable, feeBps, creatorTaxBps = 0n, extraBps = 0n }, amountIn) {
  const net = amountIn - (amountIn * feeBps) / BPS - (amountIn * creatorTaxBps) / BPS - (amountIn * extraBps) / BPS;
  if (net <= 0n) return 0n;
  const out = (net * tokenReserve) / (quoteReserve + net);
  return sellable != null && out > sellable ? sellable : out;
}

// ETH out for a sell on a live curve, after the curve fee and creator tax.
export function quoteSell({ quoteReserve, tokenReserve, feeBps, creatorTaxBps = 0n }, tokensIn) {
  const gross = (tokensIn * quoteReserve) / (tokenReserve + tokensIn);
  return gross - (gross * feeBps) / BPS - (gross * creatorTaxBps) / BPS;
}

// Switches the wallet to Robinhood Chain, adding the network if needed.
export async function ensureChain(provider) {
  const hex = "0x" + robinhood.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    if (err.code !== 4902 && err?.data?.originalError?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex, chainName: robinhood.name, nativeCurrency: robinhood.nativeCurrency,
        rpcUrls: robinhood.rpcUrls.default.http, blockExplorerUrls: [robinhood.blockExplorers.default.url],
      }],
    });
  }
}

export const applySlippage = (amount, bps) => (amount * (BPS - BigInt(bps))) / BPS;

// Every SPIDERPAD launch salt starts with "SPIDERPAD" in ASCII, marking the
// launch in its transaction input. The rest stays random.
export const SALT_PREFIX = "0x535049444552504144";

export function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32 - (SALT_PREFIX.length - 2) / 2));
  return SALT_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Every SPIDERPAD launch adds this address to the curve's snipe-tax exemption
// list. The curve then emits SnipeTaxExempted(marker), which lets Explore find
// all SPIDERPAD coins with a single log query. It is "SPIDERPAD" in ASCII,
// padded with zeros, so no one holds its key.
export const SPIDERPAD_MARKER = "0x5350494445525041440000000000000000000000";
