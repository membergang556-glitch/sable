import { Connection } from "@solana/web3.js";
import { cfg } from "./config.js";

export const conn = new Connection(cfg.RPC_URL, { commitment: "confirmed" });

export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 250 * 2 ** i)); }
  }
  throw last;
}
