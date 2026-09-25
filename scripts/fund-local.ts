// Gives an address 100 ETH on the local Hardhat node, so your MetaMask account can pay gas there.
// Usage: pnpm fund:local 0xYourAddress
import { createTestClient, getAddress, http, parseEther } from "viem";
import { hardhat } from "viem/chains";

const address = process.argv[2];
if (address === undefined) {
  console.error("Usage: pnpm fund:local 0xYourAddress");
  process.exit(1);
}

const client = createTestClient({ chain: hardhat, mode: "hardhat", transport: http() });
await client.setBalance({ address: getAddress(address), value: parseEther("100") });
console.log(`Set ${address} balance to 100 ETH on the local chain`);
