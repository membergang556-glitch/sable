import { SystemProgram, Transaction } from "@solana/web3.js";
import { conn } from "./rpc.js";
import { cfg } from "./config.js";
import { log } from "./log.js";

const KEEP = 50_000_000; // 0.05 SOL always left behind for fees

export function startHotSweep() {
  if (!cfg.feePayer) return;
  const feePayer = cfg.feePayer;
  setInterval(async () => {
    try {
      const bal = await conn.getBalance(feePayer.publicKey);
      if (bal <= cfg.HOT_SWEEP_MIN_LAMPORTS + KEEP) return;

      const send = bal - KEEP - 5000;
      const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash })
        .add(SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: cfg.vault, lamports: send }));
      tx.sign(feePayer);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      log({ level: "hot-sweep", sig, lamports: send, kept: KEEP });
    } catch (e: any) { log({ level: "hot-sweep-err", msg: e?.message }); }
  }, 30_000);
}
