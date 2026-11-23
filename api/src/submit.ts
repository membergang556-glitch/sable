import { VersionedTransaction } from "@solana/web3.js";
import { conn, withRetry } from "./rpc.js";
import { cfg } from "./config.js";
import { runtime } from "./admin.js";

export async function submit(b64: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  const raw = Buffer.from(b64, "base64");

  if (runtime.jito) {
    try {
      const r = await fetch("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[b64]] }),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result) return { sig: j.result, via: "jito" as const };
    } catch { }
  }

  const sig = await withRetry(() =>
    conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }),
  );

  const height = await conn.getBlockHeight("confirmed");
  conn.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: height + 150 }, "confirmed")
    .catch(() => {});

  return { sig, via: "rpc" as const };
}
