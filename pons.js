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
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "event CreatorFeeRecipientUpdated(address indexed token, address indexed previousRecipient, address indexed newRecipient)",
]);

export const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduated() view returns (bool)",
]);

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
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
  const sellable = config.supply - reserved;
  const fee = (amountIn * config.curveFeeBps) / BPS;
  const tax = (amountIn * creatorTaxBps) / BPS;
  const net = amountIn - fee - tax;
  const out = (net * config.supply) / (config.phantomQuote + net);
  return out > sellable ? sellable : out;
}

export const applySlippage = (amount, bps) => (amount * (BPS - BigInt(bps))) / BPS;

export function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
