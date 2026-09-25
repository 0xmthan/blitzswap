"use client";

import { useState } from "react";
import { formatUnits, zeroAddress } from "viem";
import { useConfig, useConnection, useReadContracts, useSwitchChain } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";

import { ConnectButton } from "@/components/ConnectButton";
import { TxStatus } from "@/components/TxStatus";
import { blitzPairAbi, blitzTokenAbi } from "@/contracts/generated";
import type { Deployment } from "@/hooks/useBlitz";
import { useTrackedTx } from "@/hooks/useTrackedTx";
import { applySlippage, getAmountOut, priceImpactBps } from "@/lib/amm";
import { formatAmount, parseAmount } from "@/lib/format";
import type { AppChainId } from "@/lib/wagmi";

const SLIPPAGE_OPTIONS = [10, 50, 100]; // bps: 0.1%, 0.5%, 1%
const DEADLINE_SECONDS = 20 * 60;

type Props = { chainId: AppChainId; deployment: Deployment; wrongNetwork: boolean };

export function SwapCard({ chainId, deployment, wrongNetwork }: Props) {
  const config = useConfig();
  const { address, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  const tx = useTrackedTx(chainId);

  const [sellToken0, setSellToken0] = useState(true);
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  const tokenIn = sellToken0 ? deployment.token0 : deployment.token1;
  const tokenOut = sellToken0 ? deployment.token1 : deployment.token0;
  const owner = address ?? zeroAddress;

  // One batched request for everything the card needs. Refetched every few seconds and after each tx.
  const { data } = useReadContracts({
    contracts: [
      { chainId, address: deployment.pair, abi: blitzPairAbi, functionName: "getReserves" },
      { chainId, address: tokenIn.address, abi: blitzTokenAbi, functionName: "balanceOf", args: [owner] },
      { chainId, address: tokenOut.address, abi: blitzTokenAbi, functionName: "balanceOf", args: [owner] },
      { chainId, address: tokenIn.address, abi: blitzTokenAbi, functionName: "allowance", args: [owner, deployment.pair] },
    ],
    allowFailure: false,
    query: { refetchInterval: 3_000 },
  });
  const [reserves, balanceIn, balanceOut, allowance] = data ?? [];
  const [reserveIn, reserveOut] = reserves
    ? sellToken0
      ? [reserves[0], reserves[1]]
      : [reserves[1], reserves[0]]
    : [0n, 0n];

  const amountIn = parseAmount(input);
  const amountOut = amountIn === undefined ? undefined : getAmountOut(amountIn, reserveIn, reserveOut);
  const minOut = amountOut === undefined ? undefined : applySlippage(amountOut, slippageBps);
  const impactBps = amountIn === undefined ? 0n : priceImpactBps(amountIn, reserveIn);

  const needsApproval = amountIn !== undefined && allowance !== undefined && allowance < amountIn;

  function approve() {
    if (amountIn === undefined) return;
    tx.run(`Approve ${tokenIn.symbol}`, async () => {
      // Approve exactly this swap's amount, not "unlimited": if the pool were ever
      // compromised, it could only take what you approved.
      const { request } = await simulateContract(config, {
        chainId,
        address: tokenIn.address,
        abi: blitzTokenAbi,
        functionName: "approve",
        args: [deployment.pair, amountIn],
      });
      return writeContract(config, request);
    });
  }

  async function swap() {
    if (amountIn === undefined || minOut === undefined || address === undefined) return;
    const ok = await tx.run(`Swap ${input} ${tokenIn.symbol}`, async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
      // Simulating first catches reverts (slippage, balance…) before the wallet pops up,
      // and gives us the contract's custom error name for a readable message.
      const { request } = await simulateContract(config, {
        chainId,
        address: deployment.pair,
        abi: blitzPairAbi,
        functionName: "swap",
        args: [tokenIn.address, amountIn, minOut, address, deadline],
      });
      return writeContract(config, request);
    });
    if (ok) setInput("");
  }

  function actionButton() {
    const base =
      "mt-4 w-full rounded-2xl py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
    const primary = `${base} bg-monad text-white hover:bg-monad/90`;
    const muted = `${base} bg-white/10 text-zinc-400`;

    if (!isConnected) return <div className="mt-4 flex justify-center"><ConnectButton /></div>;
    if (wrongNetwork) {
      return (
        <button className={primary} onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
          Switch network
        </button>
      );
    }
    if (tx.busy) {
      return (
        <button className={primary} disabled>
          {tx.state.phase === "signing" ? "Confirm in wallet…" : "Confirming…"}
        </button>
      );
    }
    if (amountIn === undefined) return <button className={muted} disabled>Enter an amount</button>;
    if (balanceIn !== undefined && amountIn > balanceIn) {
      return <button className={muted} disabled>Not enough {tokenIn.symbol}</button>;
    }
    if (amountOut === 0n) return <button className={muted} disabled>Amount too small</button>;
    if (needsApproval) {
      return (
        <button className={primary} onClick={approve}>
          Approve {tokenIn.symbol}
        </button>
      );
    }
    return (
      <button className={primary} onClick={swap}>
        Swap
      </button>
    );
  }

  return (
    <section className="w-full rounded-3xl border border-white/10 bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Swap</h2>
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          <span className="mr-1">Slippage</span>
          {SLIPPAGE_OPTIONS.map((bps) => (
            <button
              key={bps}
              onClick={() => setSlippageBps(bps)}
              className={`rounded-full px-2 py-1 ${bps === slippageBps ? "bg-monad/30 text-white" : "hover:bg-white/10"}`}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      <TokenBox
        label="You pay"
        symbol={tokenIn.symbol}
        balance={isConnected ? balanceIn : undefined}
        onMax={balanceIn ? () => setInput(formatUnits(balanceIn, 18)) : undefined}
      >
        <input
          inputMode="decimal"
          placeholder="0"
          value={input}
          onChange={(e) => {
            const value = e.target.value.replace(",", ".");
            if (/^\d*\.?\d*$/.test(value)) setInput(value);
          }}
          className="w-full bg-transparent text-3xl outline-none placeholder:text-zinc-600"
          aria-label={`Amount of ${tokenIn.symbol} to sell`}
        />
      </TokenBox>

      <div className="relative z-10 -my-3 flex justify-center">
        <button
          onClick={() => {
            setSellToken0(!sellToken0);
            setInput("");
          }}
          className="rounded-xl border-4 border-panel bg-zinc-800 px-3 py-1 text-lg hover:bg-zinc-700"
          aria-label="Flip direction"
        >
          ↓
        </button>
      </div>

      <TokenBox label="You receive" symbol={tokenOut.symbol} balance={isConnected ? balanceOut : undefined}>
        <p className={`text-3xl ${amountOut ? "" : "text-zinc-600"}`}>{amountOut ? formatAmount(amountOut, 18, 6) : "0"}</p>
      </TokenBox>

      {amountIn !== undefined && amountOut !== undefined && amountOut > 0n && (
        <dl className="mt-3 space-y-1 px-1 text-sm text-zinc-400">
          <Row label="Rate">
            1 {tokenIn.symbol} ≈ {formatAmount((amountOut * 10n ** 18n) / amountIn, 18, 6)} {tokenOut.symbol}
          </Row>
          <Row label="Price impact">
            <span className={impactBps > 500n ? "text-rose-400" : impactBps > 100n ? "text-amber-400" : ""}>
              {impactBps < 1n ? "<0.01" : (Number(impactBps) / 100).toFixed(2)}%
            </span>
          </Row>
          <Row label={`Minimum received (${slippageBps / 100}% slippage)`}>
            {formatAmount(minOut, 18, 6)} {tokenOut.symbol}
          </Row>
          <Row label="Fee (to liquidity providers)">0.3%</Row>
        </dl>
      )}

      {actionButton()}
      {needsApproval && isConnected && !wrongNetwork && !tx.busy && (
        <p className="mt-2 text-center text-xs text-zinc-500">
          Step 1 of 2: let the pool move {input} {tokenIn.symbol} from your wallet.
        </p>
      )}
      <TxStatus state={tx.state} chainId={chainId} />
    </section>
  );
}

function TokenBox(props: {
  label: string;
  symbol: string;
  balance: bigint | undefined;
  onMax?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-black/30 p-4">
      <div className="mb-2 flex justify-between text-sm text-zinc-400">
        <span>{props.label}</span>
        {props.balance !== undefined && (
          <span>
            Balance: {formatAmount(props.balance)}
            {props.onMax && (
              <button onClick={props.onMax} className="ml-2 font-semibold text-monad hover:text-white">
                MAX
              </button>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{props.children}</div>
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 font-semibold">{props.symbol}</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right text-zinc-200">{children}</dd>
    </div>
  );
}
