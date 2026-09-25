"use client";

import { useReadContracts } from "wagmi";

import { blitzPairAbi } from "@/contracts/generated";
import type { Deployment } from "@/hooks/useBlitz";
import { formatAmount } from "@/lib/format";
import type { AppChainId } from "@/lib/wagmi";

export function PoolStats({ chainId, deployment }: { chainId: AppChainId; deployment: Deployment }) {
  const { data } = useReadContracts({
    contracts: [
      { chainId, address: deployment.pair, abi: blitzPairAbi, functionName: "getReserves" },
      { chainId, address: deployment.pair, abi: blitzPairAbi, functionName: "totalSupply" },
    ],
    allowFailure: false,
    query: { refetchInterval: 3_000 },
  });
  const [[reserve0, reserve1] = [undefined, undefined], lpSupply] = data ?? [];
  const { token0, token1 } = deployment;
  const price = reserve0 && reserve1 ? (reserve1 * 10n ** 18n) / reserve0 : undefined;

  return (
    <section className="w-full rounded-3xl border border-white/10 bg-panel p-4">
      <h2 className="font-semibold">
        Pool: {token0.symbol} / {token1.symbol}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Stat label={`${token0.symbol} in pool`} value={formatAmount(reserve0, 18, 2)} />
        <Stat label={`${token1.symbol} in pool`} value={formatAmount(reserve1, 18, 2)} />
        <Stat label="Pool price" value={`1 ${token0.symbol} = ${formatAmount(price, 18, 4)} ${token1.symbol}`} />
        <Stat label="LP tokens" value={formatAmount(lpSupply, 18, 2)} />
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        Price comes from x · y = k: the pool always keeps {token0.symbol} × {token1.symbol} constant (plus fees).
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/30 p-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="mt-1 font-mono text-zinc-100">{value}</dd>
    </div>
  );
}
