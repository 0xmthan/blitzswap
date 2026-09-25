import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseUnits } from "viem";

describe("BlitzToken", async function () {
  const { viem, networkHelpers } = await network.create();
  const [deployer, alice, bob] = await viem.getWalletClients();

  async function deployToken() {
    return viem.deployContract("BlitzToken", ["Blitz Token", "BLTZ", 1_000_000n]);
  }

  it("mints the initial supply to the deployer", async function () {
    const token = await deployToken();

    assert.equal(await token.read.name(), "Blitz Token");
    assert.equal(await token.read.symbol(), "BLTZ");
    assert.equal(await token.read.decimals(), 18);
    assert.equal(
      await token.read.balanceOf([deployer.account.address]),
      parseUnits("1000000", 18),
    );
  });

  it("transfers tokens and emits Transfer", async function () {
    const token = await deployToken();
    const amount = parseUnits("250", 18);

    await viem.assertions.emitWithArgs(
      token.write.transfer([alice.account.address, amount]),
      token,
      "Transfer",
      [deployer.account.address, alice.account.address, amount],
    );
    assert.equal(await token.read.balanceOf([alice.account.address]), amount);
  });

  it("lets a spender move tokens only up to its allowance", async function () {
    const token = await deployToken();
    const amount = parseUnits("100", 18);

    await token.write.approve([bob.account.address, amount]);
    await token.write.transferFrom(
      [deployer.account.address, alice.account.address, amount],
      { account: bob.account },
    );
    assert.equal(await token.read.balanceOf([alice.account.address]), amount);

    await viem.assertions.revertWithCustomError(
      token.write.transferFrom(
        [deployer.account.address, alice.account.address, 1n],
        { account: bob.account },
      ),
      token,
      "ERC20InsufficientAllowance",
    );
  });

  it("faucet gives tokens once per cooldown", async function () {
    const token = await deployToken();
    const faucetAmount = parseUnits("1000", 18);

    await token.write.faucet({ account: alice.account });
    assert.equal(await token.read.balanceOf([alice.account.address]), faucetAmount);

    await viem.assertions.revertWithCustomError(
      token.write.faucet({ account: alice.account }),
      token,
      "FaucetCooldown",
    );

    await networkHelpers.time.increase(60 * 60);
    await token.write.faucet({ account: alice.account });
    assert.equal(await token.read.balanceOf([alice.account.address]), faucetAmount * 2n);
  });
});
