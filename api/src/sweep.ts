import { SystemProgram, Transaction } from "@solana/web3.js";
import { conn } from "./rpc.js";
import { cfg } from "./config.js";
import { log } from "./log.js";

export function startHotSweep() {
  if (!cfg.feePayer) return;
  const feePayer = cfg.feePayer;
  setInterval(async () => {
    try {
      const bal = await conn.getBalance(feePayer.publicKey);
      if (bal < cfg.HOT_SWEEP_MIN_LAMPORTS) return;

      const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash })
        .add(SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: cfg.vault, lamports: bal - 5000 }));
      tx.sign(feePayer);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      log({ level: "hot-sweep", sig, lamports: bal - 5000 });
    } catch (e: any) { log({ level: "hot-sweep-err", msg: e?.message }); }
  }, 30_000);
}
