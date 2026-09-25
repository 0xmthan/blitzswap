import { createConfig, http } from "wagmi";
import { hardhat, monadTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [monadTestnet, hardhat],
  // `injected` talks to whatever wallet the browser extension injects (window.ethereum), e.g. MetaMask.
  connectors: [injected()],
  // Reads go straight to each chain's RPC, not through the wallet, so they work before connecting.
  transports: {
    [monadTestnet.id]: http(),
    [hardhat.id]: http(),
  },
  // Monad makes a block every ~400ms, so poll often or confirmations would look slower than they are.
  pollingInterval: 500,
  // Render as "disconnected" on the server and reconnect in the browser, so hydration matches.
  ssr: true,
});

export type AppChainId = (typeof config.chains)[number]["id"];

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
