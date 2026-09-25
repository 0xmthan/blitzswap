"use client";

import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { useBalance, useChains, useConfig, useConnection, useReadContracts, useWatchAsset } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";

import { TxStatus } from "@/components/TxStatus";
import { blitzTokenAbi } from "@/contracts/generated";
import type { Deployment, TokenInfo } from "@/hooks/useBlitz";
import { useTrackedTx } from "@/hooks/useTrackedTx";
import { formatAmount } from "@/lib/format";
import type { AppChainId } from "@/lib/wagmi";

const FAUCET_COOLDOWN = 60 * 60; // must match BlitzToken.FAUCET_COOLDOWN

type Props = { chainId: AppChainId; deployment: Deployment; wrongNetwork: boolean };

export function FaucetPanel({ chainId, deployment, wrongNetwork }: Props) {
  const config = useConfig();
  const { address, isConnected } = useConnection();
  const chain = useChains().find((c) => c.id === chainId);
  const tx = useTrackedTx(chainId);
  const watchAsset = useWatchAsset();
  const now = useNow();

  const tokens = [deployment.token0, deployment.token1];
  const { data: lastClaims } = useReadContracts({
    contracts: tokens.map((token) => ({
      chainId,
      address: token.address,
      abi: blitzTokenAbi,
      functionName: "lastFaucetAt" as const,
      args: [address ?? zeroAddress] as const,
    })),
    allowFailure: false,
    query: { enabled: isConnected },
  });
  const { data: gas } = useBalance({ chainId, address, query: { enabled: isConnected } });

  if (!isConnected || wrongNetwork) return null;

  function claim(token: TokenInfo) {
    tx.run(`Faucet ${token.symbol}`, async () => {
      const { request } = await simulateContract(config, {
        chainId,
        address: token.address,
        abi: blitzTokenAbi,
        functionName: "faucet",
      });
      return writeContract(config, request);
    });
  }

  return (
    <section className="w-full rounded-3xl border border-white/10 bg-panel p-4">
      <h2 className="font-semibold">Test tokens</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Free BLTZ and mUSD to play with. You still pay gas in {chain?.nativeCurrency.symbol}:{" "}
        <span className="text-zinc-200">
          {formatAmount(gas?.value)} {chain?.nativeCurrency.symbol}
        </span>
      </p>
      {gas?.value === 0n && (
        <p className="mt-2 text-sm text-amber-400">
          {chainId === 31337
            ? `No gas on the local chain yet. In the project folder, run: pnpm fund:local ${address}`
            : "You need testnet MON for gas. Grab some from a Monad testnet faucet."}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {tokens.map((token, i) => {
          const last = lastClaims?.[i] ?? 0n;
          const secondsLeft = last === 0n ? 0 : Number(last) + FAUCET_COOLDOWN - now;
          return (
            <div key={token.address} className="flex flex-col gap-1">
              <button
                onClick={() => claim(token)}
                disabled={tx.busy || secondsLeft > 0}
                className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {secondsLeft > 0 ? `${token.symbol} in ${Math.ceil(secondsLeft / 60)} min` : `Get 1,000 ${token.symbol}`}
              </button>
              {/* Wallets only list tokens they know about; this asks the wallet to track this one. */}
              <button
                onClick={() =>
                  watchAsset.mutate({
                    type: "ERC20",
                    options: { address: token.address, symbol: token.symbol, decimals: 18 },
                  })
                }
                className="text-xs text-zinc-400 hover:text-white"
              >
                Add {token.symbol} to wallet
              </button>
            </div>
          );
        })}
      </div>
      <TxStatus state={tx.state} chainId={chainId} />
    </section>
  );
}

/** Current unix time in seconds, ticking every second (for the cooldown countdown). */
function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
