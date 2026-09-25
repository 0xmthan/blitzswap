// Same math as BlitzPair.sol, so the UI can quote instantly while you type.
// The contract re-does it on-chain and enforces your minimum, so a stale quote can't hurt you.

export const FEE_BPS = 30n;
const BPS = 10_000n;

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInWithFee = amountIn * (BPS - FEE_BPS);
  return (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
}

/** How much worse than the current pool price a trade executes, ignoring the fee, in bps. */
export function priceImpactBps(amountIn: bigint, reserveIn: bigint) {
  if (amountIn === 0n) return 0n;
  return (amountIn * BPS) / (reserveIn + amountIn);
}

/** The least you'll accept: the quote minus your slippage tolerance. */
export function applySlippage(amountOut: bigint, slippageBps: number) {
  return (amountOut * (BPS - BigInt(slippageBps))) / BPS;
}
