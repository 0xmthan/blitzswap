import { BaseError, ContractFunctionRevertedError, formatUnits, parseUnits, UserRejectedRequestError } from "viem";

/** Formats a token amount like `12,345.6789`. */
export function formatAmount(value: bigint | undefined, decimals = 18, maxFractionDigits = 4) {
  if (value === undefined) return "–";
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const formatted = BigInt(whole).toLocaleString("en-US") + (trimmed ? `.${trimmed}` : "");
  if (formatted === "0" && value > 0n) return `<0.${"0".repeat(maxFractionDigits - 1)}1`;
  return formatted;
}

/** Parses what the user typed into token base units, or undefined if it isn't a positive number. */
export function parseAmount(input: string, decimals = 18) {
  if (!/^\d*\.?\d*$/.test(input) || input === "" || input === ".") return undefined;
  try {
    const value = parseUnits(input, decimals);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  SlippageExceeded: "The price moved past your slippage tolerance. Try again or raise slippage.",
  FaucetCooldown: "The faucet is on cooldown for this token. Try again later.",
  Expired: "The transaction took too long and expired. Try again.",
  InsufficientOutputAmount: "That amount is too small to swap.",
  ERC20InsufficientBalance: "Not enough tokens in your wallet.",
  ERC20InsufficientAllowance: "The pool isn't approved to spend this token yet.",
};

/** Turns wallet/contract errors into something a person can act on. */
export function errorMessage(error: unknown) {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet.";
    }
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name !== undefined && name in FRIENDLY_ERRORS) return FRIENDLY_ERRORS[name];
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
