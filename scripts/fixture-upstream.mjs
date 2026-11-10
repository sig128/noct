#!/usr/bin/env node
/**
 * TEST INFRASTRUCTURE ONLY. A local stand-in for the Jupiter APIs and a
 * Solana RPC, serving responses in the documented shapes (with values taken
 * from live reads on 2026-11-10) so the live code path can be exercised in
 * a sandbox without network access. Never used by the product itself.
 *
 *   node scripts/fixture-upstream.mjs [port]
 *   JUPITER_API_BASE=http://127.0.0.1:4010 SOLANA_RPC_URL_MAINNET=http://127.0.0.1:4010/rpc npm start
 */
import http from "node:http";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

const PORT = Number(process.argv[2] ?? 4010);
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const FAKE_BONK = "BoNKfake11111111111111111111111111111111111";
const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const now = () => new Date().toISOString();

function token(id, symbol, name, decimals, usdPrice, extra = {}) {
  return {
    id,
    name,
    symbol,
    icon: null,
    decimals,
    tokenProgram: SPL,
    createdAt: "2021-01-01T00:00:00Z",
    mintAuthority: null,
    freezeAuthority: null,
    holderCount: 1_200_000,
    usdPrice,
    priceBlockId: 380_000_000,
    liquidity: 80_000_000,
    mcap: 1e9,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 14 },
    organicScore: 92,
    organicScoreLabel: "high",
    isVerified: true,
    tags: ["verified"],
    updatedAt: now(),
    ...extra,
  };
}

const TOKENS = [
  token(SOL, "SOL", "Wrapped SOL", 9, 81.80094410),
  token(USDC, "USDC", "USD Coin", 6, 0.99965775, { freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar", mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 31 } }),
  token(USDT, "USDT", "USDT", 6, 0.99896213),
  token(JUP, "JUP", "Jupiter", 6, 0.3127),
  token(BONK, "Bonk", "Bonk", 5, 0.00001083),
  token(WIF, "WIF", "dogwifhat", 6, 0.4218),
  token(JITOSOL, "JitoSOL", "Jito Staked SOL", 9, 101.2),
  token(POPCAT, "POPCAT", "Popcat (SOL)", 9, 0.1931, { isVerified: true, organicScore: 71, organicScoreLabel: "medium", liquidity: 2_100_000, holderCount: 98_000, createdAt: "2023-12-10T00:00:00Z" }),
  token(FAKE_BONK, "BONK", "Bonk", 6, 0.0000002, {
    isVerified: false,
    organicScore: 4,
    organicScoreLabel: "low",
    liquidity: 1_900,
    holderCount: 88,
    createdAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
    freezeAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
    audit: { isSus: true, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 96, devBalancePercentage: 71 },
    tags: [],
  }),
];

const PRICE = Object.fromEntries(TOKENS.map((t) => [t.id, t.usdPrice]));

const b58 = getBase58Decoder();
const b64dec = getBase64Decoder();
const b64enc = getBase64Encoder();

function buildTx(feePayer, programs) {
  const instructions = programs.map((p, i) => ({
    programAddress: address(p),
    accounts: i === 0 ? [] : [{ address: address(feePayer), role: AccountRole.WRITABLE_SIGNER }],
    data: i === 0 ? new Uint8Array([2, 0x40, 0x0d, 0x03, 0x00]) : new Uint8Array([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]),
  }));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 400_000_150n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return b64dec.decode(getTransactionEncoder().encode(compileTransaction(message)));
}

function quote(inputMint, outputMint, amount, taker) {
  const a = TOKENS.find((t) => t.id === inputMint);
  const b = TOKENS.find((t) => t.id === outputMint);
  if (!a || !b) return null;
  // out = in × pa / pb, at 6 significant decimals of price, minus 0.25% impact.
  const pa = BigInt(Math.round(PRICE[inputMint] * 1e12));
  const pb = BigInt(Math.round(PRICE[outputMint] * 1e12));
  const gross = (BigInt(amount) * pa * 10n ** BigInt(b.decimals)) / (pb * 10n ** BigInt(a.decimals));
  const out = (gross * 9975n) / 10000n;
  const min = (out * 9950n) / 10000n;
  return {
    mode: "ultra",
    inputMint,
    outputMint,
    inAmount: String(amount),
    outAmount: out.toString(),
    otherAmountThreshold: min.toString(),
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpact: -0.04,
    priceImpactPct: "-0.0004",
    inUsdValue: Number(amount) / 10 ** a.decimals * PRICE[inputMint],
    routePlan: [
      { swapInfo: { ammKey: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", label: "Raydium CLMM", inputMint, outputMint, inAmount: String((BigInt(amount) * 7n) / 10n), outAmount: ((out * 7n) / 10n).toString() }, percent: 70, bps: 7000 },
      { swapInfo: { ammKey: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", label: "Orca Whirlpool", inputMint, outputMint, inAmount: String(BigInt(amount) - (BigInt(amount) * 7n) / 10n), outAmount: (out - (out * 7n) / 10n).toString() }, percent: 30, bps: 3000 },
    ],
    feeBps: 10,
    feeMint: outputMint,
    platformFee: { amount: ((out * 10n) / 10000n).toString(), feeBps: 10, feeMint: outputMint },
    signatureFeeLamports: 5000,
    signatureFeePayer: taker ?? null,
    prioritizationFeeLamports: 41_200,
    prioritizationFeePayer: taker ?? null,
    rentFeeLamports: 0,
    rentFeePayer: null,
    router: "metis",
    transactionVersion: 0,
    transaction: taker ? buildTx(taker, ["ComputeBudget111111111111111111111111111111", "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]) : null,
    lastValidBlockHeight: "400000150",
    gasless: false,
    requestId: `fixture-${Date.now()}`,
    totalTime: 212,
    taker: taker ?? null,
  };
}

const EARN = [
  { id: 2, address: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", name: "Jupiter Lend USDC", symbol: "jlUSDC", decimals: 6, assetAddress: USDC, asset: { address: USDC, chain_id: "solana", name: "USD Coin", symbol: "USDC", decimals: 6, price: "0.999657751809" }, totalAssets: "476073742453614", totalSupply: "445298611794235", convertToShares: "935356", convertToAssets: "1069111", rewardsRate: "25", supplyRate: "445", totalRate: "470", rebalanceDifference: "0", liquiditySupplyData: { modeWithInterest: true, supply: "474301500850406", withdrawalLimit: "237150750425203", lastUpdateTimestamp: String(Math.floor(Date.now() / 1000) - 140), expandPercent: "5000", expandDuration: "21600", baseWithdrawalLimit: "8388610723880", withdrawableUntilLimit: "237150750425203", withdrawable: "51507634650231" } },
  { id: 3, address: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", name: "Jupiter Lend WSOL", symbol: "jlWSOL", decimals: 9, assetAddress: SOL, asset: { address: SOL, chain_id: "solana", name: "Wrapped SOL", symbol: "WSOL", decimals: 9, price: "81.800944100522" }, totalAssets: "280387586518452", totalSupply: "266968803765014", convertToShares: "952141998", convertToAssets: "1050263513", rewardsRate: "0", supplyRate: "364", totalRate: "364", rebalanceDifference: "0", liquiditySupplyData: { modeWithInterest: true, supply: "280392148592305", withdrawalLimit: "210294111444230", lastUpdateTimestamp: String(Math.floor(Date.now() / 1000) - 700), expandPercent: "2500", expandDuration: "21600", baseWithdrawalLimit: "46841761386701", withdrawableUntilLimit: "70098037148075", withdrawable: "70098037148075" } },
  { id: 9, address: "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk", name: "Jupiter Lend JupUSD", symbol: "jlJupUSD", decimals: 6, assetAddress: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD", asset: { symbol: "JupUSD", decimals: 6, price: "0.99890329755" }, totalAssets: "42243832625456", totalSupply: "40348194453868", convertToShares: "955126", convertToAssets: "1046982", rewardsRate: "150", supplyRate: "402", totalRate: "552", rebalanceDifference: "0", liquiditySupplyData: { withdrawable: "6353982568602", lastUpdateTimestamp: String(Math.floor(Date.now() / 1000) - 60) } },
];

function vaults() {
  const ts = Date.now() - 40_000;
  const v = (id, addr, borrowToken, borrowRate, borrowable, oraclePrice) => ({
    id,
    address: addr,
    supplyToken: { address: SOL, chainId: "solana", name: "Wrapped SOL", symbol: "WSOL", uiSymbol: "SOL", decimals: 9, price: "81.80" },
    borrowToken,
    totalSupply: "0", totalSupplyLiquidity: "0", totalBorrow: "0", totalBorrowLiquidity: "0", absorbedSupply: "0", absorbedBorrow: "0", supplyRateMagnifier: "0", borrowRateMagnifier: "0",
    borrowFee: "0",
    collateralFactor: "800",
    liquidationThreshold: "850",
    liquidationMaxLimit: "900",
    liquidationPenalty: "100",
    withdrawalGap: "0",
    supplyRate: "393",
    supplyRateLiquidity: "0",
    borrowRate,
    borrowRateLiquidity: "0",
    withdrawLimit: "0", withdrawableUntilLimit: "0", withdrawable: "353519396344965", borrowLimit: "0", borrowableUntilLimit: "0",
    borrowable,
    borrowLimitUtilization: "0",
    minimumBorrowing: "1061434",
    totalPositions: 10359,
    oracle: "6uU9EvKL1rSTyw3ZqKz4hMNEB4NBCo3D3rg3n13fymHm",
    oraclePrice,
    oraclePriceOperate: oraclePrice,
    oraclePriceLiquidate: oraclePrice,
    oracleSources: [{ source: "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt", invert: false, multiplier: "1", divisor: "1", sourceType: { chainlink: {} } }],
    oracleTimestamp: ts,
    rewards: [],
    topTick: 0,
    metadata: { maxLeverage: false, multiply: { enabled: false, reduceFactor: 0 }, nativeStake: false, pegged: false },
  });
  return [
    v(1, "nMzVs8GiXMVUENEwkev7JZfDcCENmz18ScheeVRdnb1", { address: USDC, chainId: "solana", name: "USD Coin", symbol: "USDC", uiSymbol: "USDC", decimals: 6, price: "0.9996" }, "654", "17608002774539", "81830000000000000"),
    v(2, "Hkw9798CjV3666pcWiaSbQ6eaAq5geUErn3bnbzpp94y", { address: USDT, chainId: "solana", name: "USDT", symbol: "USDT", uiSymbol: "USDT", decimals: 6, price: "0.9989" }, "499", "2628506211950", "81890000000000000"),
  ];
}

function tokenAccount(owner, mint, amount, decimals, pubkey) {
  return { pubkey, account: { data: { parsed: { info: { mint, owner, state: "initialized", tokenAmount: { amount, decimals, uiAmountString: "" } }, type: "account" }, program: "spl-token", space: 165 }, executable: false, lamports: 2039280, owner: SPL, rentEpoch: 0 } };
}

let blockHeight = 400_000_000;

function rpc(method, params) {
  switch (method) {
    case "getSlot":
      return 381_000_000;
    case "getHealth":
      return "ok";
    case "getBlockHeight":
      blockHeight += 2;
      return blockHeight;
    case "getBalance":
      return { context: { slot: 381_000_000 }, value: 12_480_000_000 };
    case "getEpochInfo":
      return { epoch: 880, slotIndex: 1, slotsInEpoch: 432000, absoluteSlot: 381000000, blockHeight };
    case "getLatestBlockhash":
      return { context: { slot: 381_000_000 }, value: { blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: blockHeight + 150 } };
    case "getTokenAccountsByOwner": {
      const [owner, { programId }] = params;
      if (programId !== SPL) return { context: { slot: 1 }, value: [] };
      return {
        context: { slot: 381_000_000 },
        value: [
          tokenAccount(owner, USDC, "1250400000", 6, "3emsAVdmGKERbHjmGfQ6oZ1e35dkf5iYcS6U4CPKFVaa"),
          tokenAccount(owner, JUP, "845120000", 6, "8fD7zYAntGz7WfJwUQZB1bSFn6NguC5DBbJ4NZV8wNch"),
          tokenAccount(owner, BONK, "2400000000000", 5, "9tXiuRRw7kbejLhZXtxDxYs2REe43uH2e7k1kocgdM9B"),
          tokenAccount(owner, SOL, "2500000000", 9, "B1GNhqHvS2RgpHcTsW7iBgUeq3XDYCBJvdJBfMfXkWbB"),
        ],
      };
    }
    case "getAccountInfo":
    case "getMultipleAccounts":
      return method === "getAccountInfo" ? { context: { slot: 1 }, value: null } : { context: { slot: 1 }, value: params[0].map(() => null) };
    case "simulateTransaction":
      return { context: { slot: 381_000_000 }, value: { err: null, logs: ["Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 success"], unitsConsumed: 182_340, accounts: null, returnData: null } };
    case "sendTransaction": {
      const bytes = new Uint8Array(b64enc.encode(params[0]));
      const tx = getTransactionDecoder().decode(bytes);
      const first = Object.values(tx.signatures)[0];
      return b58.decode(first);
    }
    case "getSignatureStatuses":
      return { context: { slot: 381_000_002 }, value: params[0].map(() => ({ slot: 381_000_001, confirmations: null, err: null, confirmationStatus: "confirmed" })) };
    case "getTransaction":
      return { slot: 381_000_001, meta: { fee: 46_200, err: null }, transaction: null };
    default:
      return null;
  }
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    try {
      if (p === "/rpc" && req.method === "POST") {
        const body = await readBody(req);
        const one = (c) => ({ jsonrpc: "2.0", id: c.id, result: rpc(c.method, c.params ?? []) });
        return send(res, 200, Array.isArray(body) ? body.map(one) : one(body));
      }
      if (p === "/tokens/v2/search") {
        const q = (url.searchParams.get("query") ?? "").trim();
        if (q.includes(",") || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
          const ids = q.split(",");
          return send(res, 200, TOKENS.filter((t) => ids.includes(t.id)));
        }
        const ql = q.toLowerCase();
        return send(res, 200, TOKENS.filter((t) => t.symbol.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql)).slice(0, 20));
      }
      if (p === "/price/v3") {
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        return send(res, 200, Object.fromEntries(ids.filter((i) => PRICE[i]).map((i) => [i, { usdPrice: PRICE[i], blockId: 380000000, decimals: 6, priceChange24h: -1.2, createdAt: "2021-01-01T00:00:00Z", liquidity: 1e8 }])));
      }
      if (p === "/swap/v2/order") {
        const q = quote(url.searchParams.get("inputMint"), url.searchParams.get("outputMint"), url.searchParams.get("amount"), url.searchParams.get("taker"));
        if (!q) return send(res, 400, { error: "No route found for this pair", requestId: "x" });
        return send(res, 200, q);
      }
      if (p === "/swap/v2/execute" && req.method === "POST") {
        const body = await readBody(req);
        const tx = getTransactionDecoder().decode(new Uint8Array(b64enc.encode(body.signedTransaction)));
        const first = Object.values(tx.signatures)[0];
        return send(res, 200, { status: "Success", code: 0, signature: b58.decode(first), slot: "381000001", inputAmountResult: "1250000000", outputAmountResult: "101966140", totalInputAmount: "1250000000", totalOutputAmount: "101966140" });
      }
      if (p === "/lend/v1/earn/tokens") return send(res, 200, EARN);
      if (p === "/lend/v1/earn/positions") return send(res, 200, [{ token: { address: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", assetAddress: USDC }, ownerAddress: url.searchParams.get("users"), shares: "280640000", underlyingAssets: "300000000" }]);
      if (p.startsWith("/lend/v1/earn/") && req.method === "POST") {
        const body = await readBody(req);
        return send(res, 200, { transaction: buildTx(body.signer, ["ComputeBudget111111111111111111111111111111", "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"]) });
      }
      if (p === "/lend/v1/borrow/vaults") return send(res, 200, vaults());
      if (p === "/lend/v1/borrow/positions") return send(res, 200, []);
      if (p === "/lend/v1/borrow/operate" && req.method === "POST") {
        const body = await readBody(req);
        return send(res, 200, { nftId: 7012, transaction: buildTx(body.signer, ["ComputeBudget111111111111111111111111111111", "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi"]) });
      }
      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 500, { error: String(error) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fixture upstream on http://127.0.0.1:${PORT}`));
