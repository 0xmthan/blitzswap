"use client";

import { useChains } from "wagmi";

import { ConnectButton } from "@/components/ConnectButton";
import { FaucetPanel } from "@/components/FaucetPanel";
import { PoolStats } from "@/components/PoolStats";
import { SwapCard } from "@/components/SwapCard";
import { useBlitz } from "@/hooks/useBlitz";

export function App() {
  const { chainId, deployment, wrongNetwork } = useBlitz();
  const chain = useChains().find((c) => c.id === chainId);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Blitz<span className="text-monad">Swap</span>
          </h1>
          {chain && <p className="text-xs text-zinc-500">on {chain.name}</p>}
        </div>
        <ConnectButton />
      </header>

      {wrongNetwork && (
        <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Your wallet is on a network BlitzSwap isn&apos;t deployed to. Use the button below to switch to {chain?.name}.
        </p>
      )}

      {chainId === undefined || deployment === undefined ? (
        <section className="rounded-3xl border border-white/10 bg-panel p-4 text-sm text-zinc-300">
          <h2 className="mb-2 font-semibold text-white">No contracts deployed yet</h2>
          <p>
            From the project root, run <code className="text-monad">pnpm node</code> in one terminal and{" "}
            <code className="text-monad">pnpm deploy:local</code> in another, then reload.
          </p>
        </section>
      ) : (
        <>
          <SwapCard chainId={chainId} deployment={deployment} wrongNetwork={wrongNetwork} />
          <FaucetPanel chainId={chainId} deployment={deployment} wrongNetwork={wrongNetwork} />
          <PoolStats chainId={chainId} deployment={deployment} />
        </>
      )}
    </div>
  );
}
