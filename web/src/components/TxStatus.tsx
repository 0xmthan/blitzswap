"use client";

import { useChains } from "wagmi";

import type { TxState } from "@/hooks/useTrackedTx";
import type { AppChainId } from "@/lib/wagmi";

export function TxStatus({ state, chainId }: { state: TxState; chainId: AppChainId }) {
  const explorer = useChains().find((c) => c.id === chainId)?.blockExplorers?.default.url;

  if (state.phase === "idle") return null;

  const link =
    "hash" in state && explorer ? (
      <a href={`${explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="underline hover:text-white">
        view
      </a>
    ) : null;

  return (
    <div className="mt-3 rounded-xl bg-black/30 px-3 py-2 text-sm" role="status">
      {state.phase === "signing" && <p className="text-zinc-300">{state.label}: confirm in your wallet…</p>}
      {state.phase === "pending" && (
        <p className="text-zinc-300">
          {state.label}: waiting for the block… {link}
        </p>
      )}
      {state.phase === "confirmed" && (
        <p className="text-emerald-400">
          {state.label}: confirmed in <strong>{state.confirmedInMs.toLocaleString()} ms</strong> {link}
        </p>
      )}
      {state.phase === "failed" && (
        <p className="text-rose-400">
          {state.label} failed: {state.error}
        </p>
      )}
    </div>
  );
}
