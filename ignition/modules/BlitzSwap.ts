import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { maxUint256, parseUnits } from "viem";

/**
 * Deploys two faucet tokens and a BlitzPair pool for them, then seeds the pool
 * so it has a price from the start (1 BLTZ = 2 mUSD by default).
 *
 * Override any parameter with `--parameters ignition/parameters.json`.
 */
export default buildModule("BlitzSwap", (m) => {
  const initialSupply = m.getParameter("initialSupply", 1_000_000n);
  const seedBltz = m.getParameter("seedBltz", parseUnits("100000", 18));
  const seedMusd = m.getParameter("seedMusd", parseUnits("200000", 18));

  const bltz = m.contract("BlitzToken", ["Blitz Token", "BLTZ", initialSupply], { id: "BLTZ" });
  const musd = m.contract("BlitzToken", ["Monad Dollar", "mUSD", initialSupply], { id: "mUSD" });
  const pair = m.contract("BlitzPair", [bltz, musd]);

  // The pool can only pull tokens it has been approved for, even from its deployer.
  const approveBltz = m.call(bltz, "approve", [pair, seedBltz], { id: "approveBltz" });
  const approveMusd = m.call(musd, "approve", [pair, seedMusd], { id: "approveMusd" });

  // Deadline is maxUint256: this call is sent right after the approvals, and the
  // empty pool has no price to protect with slippage limits yet.
  m.call(pair, "addLiquidity", [seedBltz, seedMusd, 0n, 0n, m.getAccount(0), maxUint256], {
    id: "seedLiquidity",
    after: [approveBltz, approveMusd],
  });

  return { bltz, musd, pair };
});
