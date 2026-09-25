import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { maxUint256, parseUnits } from "viem";

const DEAD = "0x000000000000000000000000000000000000dEaD";

/** Same formula as BlitzPair._getAmountOut, so tests can predict swap results. */
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  const amountInWithFee = amountIn * 9_970n;
  return (amountInWithFee * reserveOut) / (reserveIn * 10_000n + amountInWithFee);
}

describe("BlitzPair", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, alice] = await viem.getWalletClients();

  async function deadline() {
    return BigInt(await networkHelpers.time.latest()) + 3_600n;
  }

  // loadFixture runs this once, snapshots the chain, and rewinds to the snapshot for every test.
  async function deployFixture() {
    const tokenA = await viem.deployContract("BlitzToken", ["Blitz Token", "BLTZ", 1_000_000n]);
    const tokenB = await viem.deployContract("BlitzToken", ["Monad Dollar", "mUSD", 1_000_000n]);
    const pair = await viem.deployContract("BlitzPair", [tokenA.address, tokenB.address]);

    for (const account of [deployer.account, alice.account]) {
      await tokenA.write.approve([pair.address, maxUint256], { account });
      await tokenB.write.approve([pair.address, maxUint256], { account });
    }
    await tokenA.write.transfer([alice.account.address, parseUnits("10000", 18)]);
    await tokenB.write.transfer([alice.account.address, parseUnits("10000", 18)]);

    return { tokenA, tokenB, pair };
  }

  /** Deployer seeds the pool at 1 BLTZ = 2 mUSD. */
  async function seededFixture() {
    const contracts = await deployFixture();
    await contracts.pair.write.addLiquidity([
      parseUnits("1000", 18),
      parseUnits("2000", 18),
      0n,
      0n,
      deployer.account.address,
      await deadline(),
    ]);
    return contracts;
  }

  describe("deployment", function () {
    it("rejects a pair of a token with itself", async function () {
      const { tokenA } = await networkHelpers.loadFixture(deployFixture);
      await assert.rejects(viem.deployContract("BlitzPair", [tokenA.address, tokenA.address]));
    });
  });

  describe("addLiquidity", function () {
    it("first deposit mints sqrt(x * y) LP tokens and locks MINIMUM_LIQUIDITY", async function () {
      const { pair } = await networkHelpers.loadFixture(seededFixture);

      // sqrt(1000e18 * 2000e18) = sqrt(2) * 1000e18, rounded down
      const expectedTotal = 1_414_213_562_373_095_048_801n;
      assert.equal(await pair.read.totalSupply(), expectedTotal);
      assert.equal(await pair.read.balanceOf([DEAD]), 1_000n);
      assert.equal(await pair.read.balanceOf([deployer.account.address]), expectedTotal - 1_000n);
      assert.deepEqual(await pair.read.getReserves(), [parseUnits("1000", 18), parseUnits("2000", 18)]);
    });

    it("later deposits are trimmed to the pool ratio", async function () {
      const { tokenA, tokenB, pair } = await networkHelpers.loadFixture(seededFixture);
      const aBefore = await tokenA.read.balanceOf([alice.account.address]);
      const bBefore = await tokenB.read.balanceOf([alice.account.address]);

      // Alice offers 100 A + 500 B, but the ratio is 1:2, so only 200 B should be taken.
      await pair.write.addLiquidity(
        [parseUnits("100", 18), parseUnits("500", 18), 0n, 0n, alice.account.address, await deadline()],
        { account: alice.account },
      );

      assert.equal(aBefore - (await tokenA.read.balanceOf([alice.account.address])), parseUnits("100", 18));
      assert.equal(bBefore - (await tokenB.read.balanceOf([alice.account.address])), parseUnits("200", 18));

      // She added 10% of the pool, so she should own ~10% of the LP supply before her mint.
      const aliceLp = await pair.read.balanceOf([alice.account.address]);
      const supplyBefore = (await pair.read.totalSupply()) - aliceLp;
      assert.equal(aliceLp, supplyBefore / 10n);
    });

    it("reverts when trimming would go below the minimum", async function () {
      const { pair } = await networkHelpers.loadFixture(seededFixture);
      await viem.assertions.revertWithCustomError(
        pair.write.addLiquidity(
          [
            parseUnits("100", 18),
            parseUnits("500", 18),
            0n,
            parseUnits("300", 18), // demands at least 300 B, but only 200 B fits the ratio
            alice.account.address,
            await deadline(),
          ],
          { account: alice.account },
        ),
        pair,
        "SlippageExceeded",
      );
    });
  });

  describe("swap", function () {
    it("sells token0 for token1 at the x * y = k price minus the fee", async function () {
      const { tokenA, tokenB, pair } = await networkHelpers.loadFixture(seededFixture);
      const amountIn = parseUnits("10", 18);
      const [r0, r1] = await pair.read.getReserves();
      const expectedOut = getAmountOut(amountIn, r0, r1);

      assert.equal(await pair.read.getAmountOut([tokenA.address, amountIn]), expectedOut);

      const bBefore = await tokenB.read.balanceOf([alice.account.address]);
      await viem.assertions.emitWithArgs(
        pair.write.swap([tokenA.address, amountIn, expectedOut, alice.account.address, await deadline()], {
          account: alice.account,
        }),
        pair,
        "Swap",
        [alice.account.address, alice.account.address, tokenA.address, amountIn, expectedOut],
      );

      assert.equal((await tokenB.read.balanceOf([alice.account.address])) - bBefore, expectedOut);
      assert.deepEqual(await pair.read.getReserves(), [r0 + amountIn, r1 - expectedOut]);
    });

    it("sells token1 for token0", async function () {
      const { tokenA, tokenB, pair } = await networkHelpers.loadFixture(seededFixture);
      const amountIn = parseUnits("50", 18);
      const [r0, r1] = await pair.read.getReserves();
      const expectedOut = getAmountOut(amountIn, r1, r0);

      const aBefore = await tokenA.read.balanceOf([alice.account.address]);
      await pair.write.swap([tokenB.address, amountIn, 0n, alice.account.address, await deadline()], {
        account: alice.account,
      });
      assert.equal((await tokenA.read.balanceOf([alice.account.address])) - aBefore, expectedOut);
    });

    it("fees make k grow after every swap", async function () {
      const { tokenA, tokenB, pair } = await networkHelpers.loadFixture(seededFixture);
      const [r0, r1] = await pair.read.getReserves();
      const kBefore = r0 * r1;

      await pair.write.swap([tokenA.address, parseUnits("100", 18), 0n, alice.account.address, await deadline()], {
        account: alice.account,
      });
      await pair.write.swap([tokenB.address, parseUnits("100", 18), 0n, alice.account.address, await deadline()], {
        account: alice.account,
      });

      const [n0, n1] = await pair.read.getReserves();
      assert.ok(n0 * n1 > kBefore);
    });

    it("bigger trades get worse prices (price impact)", async function () {
      const { tokenA, pair } = await networkHelpers.loadFixture(seededFixture);
      const small = await pair.read.getAmountOut([tokenA.address, parseUnits("1", 18)]);
      const large = await pair.read.getAmountOut([tokenA.address, parseUnits("500", 18)]);

      // Per token sold, the large trade receives less.
      assert.ok(large / 500n < small);
    });

    it("reverts if the output is below amountOutMin (slippage protection)", async function () {
      const { tokenA, pair } = await networkHelpers.loadFixture(seededFixture);
      const amountIn = parseUnits("10", 18);
      const quoted = await pair.read.getAmountOut([tokenA.address, amountIn]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        pair.write.swap([tokenA.address, amountIn, quoted + 1n, alice.account.address, await deadline()], {
          account: alice.account,
        }),
        pair,
        "SlippageExceeded",
        [quoted, quoted + 1n],
      );
    });

    it("reverts after the deadline", async function () {
      const { tokenA, pair } = await networkHelpers.loadFixture(seededFixture);
      const past = BigInt(await networkHelpers.time.latest()) - 1n;

      await viem.assertions.revertWithCustomError(
        pair.write.swap([tokenA.address, parseUnits("1", 18), 0n, alice.account.address, past], {
          account: alice.account,
        }),
        pair,
        "Expired",
      );
    });

    it("reverts for a token that is not in the pair", async function () {
      const { pair } = await networkHelpers.loadFixture(seededFixture);
      const other = await viem.deployContract("BlitzToken", ["Other", "OTH", 1_000n]);

      await viem.assertions.revertWithCustomError(
        pair.write.swap([other.address, 1n, 0n, alice.account.address, await deadline()]),
        pair,
        "InvalidToken",
      );
    });

    it("cannot pull tokens the swapper has not approved", async function () {
      const { tokenA, pair } = await networkHelpers.loadFixture(seededFixture);
      await tokenA.write.approve([pair.address, 0n], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        pair.write.swap([tokenA.address, parseUnits("1", 18), 0n, alice.account.address, await deadline()], {
          account: alice.account,
        }),
        tokenA,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("removeLiquidity", function () {
    it("returns the LP's share of the pool, including earned fees", async function () {
      const { tokenA, tokenB, pair } = await networkHelpers.loadFixture(seededFixture);

      // Alice becomes an LP with 100 A + 200 B.
      await pair.write.addLiquidity(
        [parseUnits("100", 18), parseUnits("200", 18), 0n, 0n, alice.account.address, await deadline()],
        { account: alice.account },
      );
      const lp = await pair.read.balanceOf([alice.account.address]);

      // The deployer does round trips (sell A, then sell all the B it got back), paying fees into
      // the pool each way. Round trips leave the price almost where it started; if the price moved
      // a lot instead, impermanent loss could outweigh the fees.
      for (let i = 0; i < 5; i++) {
        const amountIn = parseUnits("200", 18);
        const out = await pair.read.getAmountOut([tokenA.address, amountIn]);
        await pair.write.swap([tokenA.address, amountIn, 0n, deployer.account.address, await deadline()]);
        await pair.write.swap([tokenB.address, out, 0n, deployer.account.address, await deadline()]);
      }

      const [r0, r1] = await pair.read.getReserves();
      const supply = await pair.read.totalSupply();
      const aBefore = await tokenA.read.balanceOf([alice.account.address]);
      const bBefore = await tokenB.read.balanceOf([alice.account.address]);

      await pair.write.removeLiquidity([lp, 0n, 0n, alice.account.address, await deadline()], {
        account: alice.account,
      });

      const gotA = (await tokenA.read.balanceOf([alice.account.address])) - aBefore;
      const gotB = (await tokenB.read.balanceOf([alice.account.address])) - bBefore;
      assert.equal(gotA, (lp * r0) / supply);
      assert.equal(gotB, (lp * r1) / supply);
      assert.equal(await pair.read.balanceOf([alice.account.address]), 0n);

      // Value her position at the pool's final price (in B). It is worth more than she put in.
      const [f0, f1] = await pair.read.getReserves();
      const deposited = parseUnits("100", 18) * f1 / f0 + parseUnits("200", 18);
      const withdrawn = gotA * f1 / f0 + gotB;
      assert.ok(withdrawn > deposited, "LP should earn swap fees");
    });

    it("reverts when burning more LP tokens than you own", async function () {
      const { pair } = await networkHelpers.loadFixture(seededFixture);
      await viem.assertions.revertWithCustomError(
        pair.write.removeLiquidity([1_000_000n, 0n, 0n, alice.account.address, await deadline()], {
          account: alice.account,
        }),
        pair,
        "ERC20InsufficientBalance",
      );
    });
  });
});
