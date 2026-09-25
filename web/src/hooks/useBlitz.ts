"use client";

import type { Address } from "viem";
import { useConnection } from "wagmi";

import { deployments } from "@/contracts/generated";
import type { AppChainId } from "@/lib/wagmi";

export type TokenInfo = { symbol: string; address: Address };
export type Deployment = { pair: Address; token0: TokenInfo; token1: TokenInfo };

const byChain: Partial<Record<number, Deployment>> = deployments;
const supportedChainIds = Object.keys(deployments).map(Number) as AppChainId[];

const envChainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);

/** The chain the app points at when the wallet isn't on a supported one. Prefers Monad testnet. */
export const defaultChainId: AppChainId | undefined = supportedChainIds.includes(envChainId as AppChainId)
  ? (envChainId as AppChainId)
  : supportedChainIds.includes(10143)
    ? 10143
    : supportedChainIds[0];

/** Which chain and contracts the app should use right now. */
export function useBlitz() {
  const { chainId: walletChainId, isConnected } = useConnection();
  const walletOnSupportedChain = walletChainId !== undefined && byChain[walletChainId] !== undefined;

  const chainId = isConnected && walletOnSupportedChain ? (walletChainId as AppChainId) : defaultChainId;
  return {
    chainId,
    deployment: chainId === undefined ? undefined : byChain[chainId],
    wrongNetwork: isConnected && !walletOnSupportedChain,
  };
}
