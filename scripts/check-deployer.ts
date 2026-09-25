import { network } from "hardhat";
import { formatEther } from "viem";

// Prints which account Hardhat will deploy from, on which chain, and its balance.
// Usage: pnpm hardhat run scripts/check-deployer.ts --network monadTestnet
const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const [chainId, balance, gasPrice] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getBalance({ address: deployer.account.address }),
  publicClient.getGasPrice(),
]);

console.log(`network:  ${networkName} (chain ${chainId})`);
console.log(`deployer: ${deployer.account.address}`);
console.log(`balance:  ${formatEther(balance)} MON`);
console.log(`gasPrice: ${formatEther(gasPrice, "gwei")} gwei`);
