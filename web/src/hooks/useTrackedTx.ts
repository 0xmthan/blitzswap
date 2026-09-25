"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Hash } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { errorMessage } from "@/lib/format";
import type { AppChainId } from "@/lib/wagmi";

export type TxState =
  | { phase: "idle" }
  | { phase: "signing"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "confirmed"; label: string; hash: Hash; confirmedInMs: number }
  | { phase: "failed"; label: string; error: string };

/**
 * Sends a transaction and follows it: waiting for the wallet signature, then for the
 * receipt. Times how long confirmation takes (Monad's party trick) and refreshes all
 * on-chain reads afterwards so balances update.
 */
export function useTrackedTx(chainId: AppChainId) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  async function run(label: string, send: () => Promise<Hash>) {
    setState({ phase: "signing", label });
    try {
      const hash = await send();
      const sentAt = performance.now();
      setState({ phase: "pending", label, hash });

      const receipt = await waitForTransactionReceipt(config, { chainId, hash, pollingInterval: 100 });
      if (receipt.status === "reverted") throw new Error("The transaction reverted on-chain.");

      setState({ phase: "confirmed", label, hash, confirmedInMs: Math.round(performance.now() - sentAt) });
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setState({ phase: "failed", label, error: errorMessage(error) });
      return false;
    }
  }

  const busy = state.phase === "signing" || state.phase === "pending";
  return { state, run, busy };
}
