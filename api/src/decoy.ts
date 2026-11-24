import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { conn } from "./rpc.js";
import { cfg } from "./config.js";
import { all } from "./vaults.js";
import { log } from "./log.js";

const FLOOR = 1_000_000n;
const MIN = 1_500_000;
const inflight = new Set<string>();

export async function sweepDecoys() {
  let n = 0;
  for (const [owner, rec] of all()) {
    if (inflight.has(rec.address)) continue;
    inflight.add(rec.address);
    try {
      const kp = Keypair.fromSecretKey(bs58.decode(rec.secret));
      const bal = await conn.getBalance(kp.publicKey);
      if (bal < MIN) continue;
      const amount = BigInt(bal) - FLOOR;
      if (amount <= 0n) continue;
      const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash })
        .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: cfg.vault, lamports: amount }));
      tx.sign(kp);
      await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      n++;
      log({ level: "decoy-sweep", owner, amount: amount.toString() });
      await new Promise((r) => setTimeout(r, 400));
    } catch (e: any) { log({ level: "decoy-sweep-err", owner, msg: e?.message }); }
    finally { inflight.delete(rec.address); }
  }
  return n;
}

export function startDecoySweep() {
  setInterval(() => { sweepDecoys().catch(() => {}); }, 120000);
}
