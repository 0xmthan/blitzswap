import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseUnits } from "viem";

import BlitzSwapModule from "../ignition/modules/BlitzSwap.js";

describe("BlitzSwap Ignition module", async function () {
  const { ignition, viem } = await network.create();

  it("deploys both tokens and a seeded pool", async function () {
    const { bltz, musd, pair } = await ignition.deploy(BlitzSwapModule);

    assert.equal(await bltz.read.symbol(), "BLTZ");
    assert.equal(await musd.read.symbol(), "mUSD");
    assert.equal(await pair.read.token0(), getAddress(bltz.address));
    assert.equal(await pair.read.token1(), getAddress(musd.address));
    assert.deepEqual(await pair.read.getReserves(), [parseUnits("100000", 18), parseUnits("200000", 18)]);

    const [deployer] = await viem.getWalletClients();
    assert.ok((await pair.read.balanceOf([deployer.account.address])) > 0n);
  });
});
