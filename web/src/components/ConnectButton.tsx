"use client";

import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect.mutate()}
        title="Disconnect"
        className="rounded-full bg-white/10 px-4 py-2 font-mono text-sm hover:bg-white/15"
      >
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => connect.mutate({ connector: connectors[0] })}
        disabled={connect.isPending}
        className="rounded-full bg-monad px-4 py-2 text-sm font-semibold text-white hover:bg-monad/90 disabled:opacity-60"
      >
        {connect.isPending ? "Check your wallet…" : "Connect wallet"}
      </button>
      {connect.error && <p className="text-xs text-rose-400">{connectErrorMessage(connect.error)}</p>}
    </div>
  );
}

function connectErrorMessage(error: Error) {
  // The injected connector throws this when no wallet extension is installed.
  if (error.name === "ProviderNotFoundError") return "No wallet found. Install MetaMask first.";
  return error.message.split("\n")[0];
}
